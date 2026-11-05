import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Advance, Branch, Employee, LeaveRequest, OtRequest, ScanRecord, Settings, Shift } from '../domain/types';
import type { HRRequest, ShiftOverride } from '../domain/requests';
import type { PayItem } from '../domain/payItems';

export interface Notification {
  id: string;
  companyId: string;
  userId: string;
  text: string;
  at: string;
  read: boolean;
  link?: string; // page id to open
}
import { LocalStore, uid, type DataStore } from '../data/store';
import { seed, shifts } from '../data/seed';
import { DEMO_COMPANY_ID, getCompany, meKey, storePrefix } from '../data/companies';
import { ownerSelfOk } from '../domain/permissions';
import type { Company } from '../domain/company';
import { purgeExpiredPhotos } from '../domain/attendance';
import { defaultSettings } from '../domain/defaults';
import { syncOfflineScans } from './offlineSync';
import { missedOutNotices } from './missedOut';

export interface PayrollRun {
  id: string; // YYYY-MM
  companyId: string;
  status: 'draft' | 'prepared' | 'locked';
  preparedBy?: string;
  approvedBy?: string;
  lateConfirmed: string[]; // employee ids whose late deduction HR confirmed
  slips?: Record<string, number>; // employeeId → net, frozen on lock
}

export interface HRData {
  employees: Employee[];
  branches: Branch[];
  scans: ScanRecord[];
  leaves: LeaveRequest[];
  ots: OtRequest[];
  advances: Advance[];
  payrollRuns: PayrollRun[];
  requests: HRRequest[];
  overrides: ShiftOverride[];
  shifts: Shift[];
  notifications: Notification[];
  payItems: PayItem[];
  settings: Settings;
}

interface Ctx extends HRData {
  companyId: string;
  company: Company;
  notify: (userIds: string[], text: string, link?: string) => Promise<void>;
  ready: boolean;
  me: Employee | null;
  /** `me` plus whether they may approve their own requests; pass this, not `me`, to the approval rules. */
  approver: (Employee & { selfOk: boolean }) | null;
  setMe: (id: string | null) => void;
  save: <T extends { id: string }>(collection: string, item: T, action: string, asId?: string) => Promise<void>;
  remove: (collection: string, id: string, action: string) => Promise<void>;
  store: DataStore;
  resetDemo: () => void;
  /** Set when the company lives on the online database: sign-in accounts and the phone set-up link. */
  online?: OnlineApi;
}

export interface OnlineApi {
  logins: Set<string>; // employee ids that already have a login (only the owner can read the list)
  refreshLogins: () => Promise<void>;
  createLogin: (e: Employee, pin: string) => Promise<void>;
  resetPin: (e: Employee, pin: string) => Promise<void>;
  changeOwnPin: (pin: string) => Promise<void>;
  /** Admin and Super admin look up a person's PIN (Google Sheet only). Resolves to null when it is not known yet. */
  revealPin?: (e: Employee) => Promise<string | null>;
  joinLink: () => string;
  /** Approving with a colleague's PIN (Google Sheet only): check the PIN, then run the action with the approval attached. */
  approve?: (code: string, pin: string) => Promise<{ approval: string; approverId: string; approverName: string }>;
  runApproved?: <T>(approval: string, run: () => Promise<T>) => Promise<T>;
}

/** What the app is given when the company is online: its store, the company record, who signed in, and how to sign out. */
export interface OnlineSession { store: DataStore & { flush?: () => Promise<number> }; company: Company; meId: string; onSignOut: () => void; api: OnlineApi; pollMs?: number }

const HRContext = createContext<Ctx | null>(null);
export const useHR = () => {
  const c = useContext(HRContext);
  if (!c) throw new Error('useHR outside provider');
  return c;
};

export function HRProvider({ companyId, children, online }: { companyId: string; children: ReactNode; online?: OnlineSession }) {
  const store = useMemo<DataStore>(() => (online ? online.store : new LocalStore(companyId, storePrefix(companyId))), [companyId, online?.store]); // eslint-disable-line react-hooks/exhaustive-deps
  const company = online ? online.company : getCompany(companyId);
  const [data, setData] = useState<HRData | null>(null);
  const [meId, setMeId] = useState<string | null>(() => {
    if (online) return online.meId;
    try { return localStorage.getItem(meKey(companyId)); } catch { return null; }
  });

  const load = useCallback(async () => {
    const [employees, branches, scans, leaves, ots, advances, payrollRuns, requests, overrides, notifications, shiftRows, settingsRows, payItems] = await Promise.all([
      store.list<Employee>('employees'), store.list<Branch>('branches'), store.list<ScanRecord>('scans'),
      store.list<LeaveRequest>('leaves'), store.list<OtRequest>('ots'), store.list<Advance>('advances'),
      store.list<PayrollRun>('payrollRuns'), store.list<HRRequest>('requests'), store.list<ShiftOverride>('overrides'),
      store.list<Notification>('notifications'), store.list<Shift>('shifts'), store.list<Settings & { id: string }>('settings'),
      store.list<PayItem>('payItems')
    ]);
    // defaults first, so settings saved before a new field existed still get a valid value for it
    const settings = { ...defaultSettings(companyId), ...settingsRows[0], holidays: settingsRows[0].holidays ?? [] };
    setData({ employees, branches, scans, leaves, ots, advances, payrollRuns, requests, overrides, notifications, payItems, shifts: shiftRows.length ? shiftRows : shifts, settings });
  }, [store]);

  // only the demo company is seeded with sample people here; every other company was seeded when it was created
  useEffect(() => { (companyId === DEMO_COMPANY_ID && !online ? seed(store as LocalStore) : Promise.resolve()).then(load); }, [store, load, companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Online: send what was saved with no signal, and look for other people's changes every so often.
  useEffect(() => {
    if (!online) return;
    const tick = () => { if (document.visibilityState === 'hidden') return; (online.store.flush?.() ?? Promise.resolve(0)).catch(() => { /* kept for the next try */ }).then(() => load()).catch(() => { /* offline: keep showing what we have */ }); };
    const t = setInterval(tick, online.pollMs ?? 20_000);
    window.addEventListener('online', tick);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(t); window.removeEventListener('online', tick); document.removeEventListener('visibilitychange', tick); };
  }, [online, load]);

  // Offline scans get their server time and a fresh clock check once the phone reaches the server.
  useEffect(() => {
    if (!data) return;
    const sync = () => {
      if (!data.scans.some(s => s.offline && !s.serverTime)) return;
      syncOfflineScans(store, data.branches, data.settings).then(n => { if (n) load(); }).catch(() => { /* stays queued, retried on the next trigger */ });
    };
    if (navigator.onLine) sync();
    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
  }, [data, store, load]);

  // Photos are deleted once they pass the retention period set by Admin (one pass per load, one audit entry each).
  useEffect(() => {
    if (!data) return;
    const { scans, purged } = purgeExpiredPhotos(data.scans, data.settings.photoRetentionDays, new Date());
    if (!purged) return;
    const changed = scans.filter((s, i) => s !== data.scans[i]);
    Promise.all(changed.map(s => store.put('scans', s, 'system', 'photo-purge'))).then(load);
  }, [data?.settings.photoRetentionDays, data?.scans.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Forgotten clock-outs: tell the employee and their head, once per person per day (deterministic ids).
  // In the demo this runs on whichever device is open; with a real server it becomes a scheduled job.
  const noticed = useRef(new Set<string>());
  useEffect(() => {
    if (!data) return;
    const fresh = missedOutNotices(data, new Date(), companyId).filter(n => !noticed.current.has(n.id));
    if (!fresh.length) return;
    fresh.forEach(n => noticed.current.add(n.id));
    Promise.all(fresh.map(n => store.put<Notification>('notifications', n, 'system', 'missed-clock-out'))).then(load);
  }, [data?.scans, data?.employees, data?.shifts, data?.overrides]); // eslint-disable-line react-hooks/exhaustive-deps

  const me = data?.employees.find(e => e.id === meId) ?? null;
  const by = me?.id ?? 'anonymous';

  const value: Ctx | null = data && {
    ...data,
    companyId,
    company: company!,
    ready: true,
    me,
    approver: me ? { ...me, selfOk: ownerSelfOk(me, data.settings, data.employees) } : null,
    setMe: id => {
      if (online) { if (id === null) online.onSignOut(); return; } // online, who you are is whoever signed in
      setMeId(id);
      try { id ? localStorage.setItem(meKey(companyId), id) : localStorage.removeItem(meKey(companyId)); } catch { /* private mode */ }
    },
    save: async (collection, item, action, asId) => { await store.put(collection, item, asId ?? by, action); await load(); },
    remove: async (collection, id, action) => { await store.remove(collection, id, by, action); await load(); },
    notify: async (userIds, text, link) => {
      for (const userId of new Set(userIds)) {
        await store.put<Notification>('notifications', { id: uid(), companyId, userId, text, at: new Date().toISOString(), read: false, link }, by, 'notify');
      }
      await load();
    },
    store,
    // wipes only this company's own keys; refused for any company but the demo, whose sample people it re-creates
    resetDemo: () => { if (companyId !== DEMO_COMPANY_ID || online) return; (store as LocalStore).reset(); seed(store as LocalStore).then(load); },
    online: online?.api
  };

  if (!company) return <div className="empty">ບໍ່ພົບບໍລິສັດນີ້</div>;
  if (!value) return <div className="empty">ກຳລັງໂຫຼດຂໍ້ມູນ… <div className="small muted">ລໍສັກຄູ່ ກຳລັງດຶງຂໍ້ມູນຈາກເຊີບເວີ</div></div>;
  return <HRContext.Provider value={value}>{children}</HRContext.Provider>;
}
