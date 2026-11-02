import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Advance, Branch, Employee, LeaveRequest, OtRequest, ScanRecord, Settings } from '../domain/types';
import type { HRRequest, ShiftOverride } from '../domain/requests';

export interface Notification {
  id: string;
  companyId: string;
  userId: string;
  text: string;
  at: string;
  read: boolean;
  link?: string; // page id to open
}
import { LocalStore, uid } from '../data/store';
import { COMPANY, seed, shifts } from '../data/seed';
import { purgeExpiredPhotos } from '../domain/attendance';
import { syncOfflineScans } from './offlineSync';

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
  notifications: Notification[];
  settings: Settings;
}

interface Ctx extends HRData {
  notify: (userIds: string[], text: string, link?: string) => Promise<void>;
  ready: boolean;
  me: Employee | null;
  setMe: (id: string | null) => void;
  save: <T extends { id: string }>(collection: string, item: T, action: string) => Promise<void>;
  store: LocalStore;
  shifts: typeof shifts;
  resetDemo: () => void;
}

const HRContext = createContext<Ctx | null>(null);
export const useHR = () => {
  const c = useContext(HRContext);
  if (!c) throw new Error('useHR outside provider');
  return c;
};

export function HRProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => new LocalStore(COMPANY), []);
  const [data, setData] = useState<HRData | null>(null);
  const [meId, setMeId] = useState<string | null>(() => {
    try { return localStorage.getItem('sthr-me'); } catch { return null; }
  });

  const load = useCallback(async () => {
    const [employees, branches, scans, leaves, ots, advances, payrollRuns, requests, overrides, notifications, settingsRows] = await Promise.all([
      store.list<Employee>('employees'), store.list<Branch>('branches'), store.list<ScanRecord>('scans'),
      store.list<LeaveRequest>('leaves'), store.list<OtRequest>('ots'), store.list<Advance>('advances'),
      store.list<PayrollRun>('payrollRuns'), store.list<HRRequest>('requests'), store.list<ShiftOverride>('overrides'),
      store.list<Notification>('notifications'), store.list<Settings & { id: string }>('settings')
    ]);
    const settings = { ...settingsRows[0], holidays: settingsRows[0].holidays ?? [] };
    setData({ employees, branches, scans, leaves, ots, advances, payrollRuns, requests, overrides, notifications, settings });
  }, [store]);

  useEffect(() => { seed(store).then(load); }, [store, load]);

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

  const me = data?.employees.find(e => e.id === meId) ?? null;
  const by = me?.id ?? 'anonymous';

  const value: Ctx | null = data && {
    ...data,
    ready: true,
    me,
    setMe: id => {
      setMeId(id);
      try { id ? localStorage.setItem('sthr-me', id) : localStorage.removeItem('sthr-me'); } catch { /* private mode */ }
    },
    save: async (collection, item, action) => { await store.put(collection, item, by, action); await load(); },
    notify: async (userIds, text, link) => {
      for (const userId of new Set(userIds)) {
        await store.put<Notification>('notifications', { id: uid(), companyId: COMPANY, userId, text, at: new Date().toISOString(), read: false, link }, by, 'notify');
      }
      await load();
    },
    store,
    shifts,
    resetDemo: () => { store.reset(); seed(store).then(load); }
  };

  if (!value) return <div className="empty">ກຳລັງໂຫຼດ…</div>;
  return <HRContext.Provider value={value}>{children}</HRContext.Provider>;
}
