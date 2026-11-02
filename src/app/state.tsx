import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Advance, Branch, Employee, LeaveRequest, OtRequest, ScanRecord, Settings } from '../domain/types';
import { LocalStore } from '../data/store';
import { COMPANY, seed, shifts } from '../data/seed';
import { evaluateScan } from '../domain/attendance';

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
  settings: Settings;
}

interface Ctx extends HRData {
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
    const [employees, branches, scans, leaves, ots, advances, payrollRuns, settingsRows] = await Promise.all([
      store.list<Employee>('employees'), store.list<Branch>('branches'), store.list<ScanRecord>('scans'),
      store.list<LeaveRequest>('leaves'), store.list<OtRequest>('ots'), store.list<Advance>('advances'),
      store.list<PayrollRun>('payrollRuns'), store.list<Settings & { id: string }>('settings')
    ]);
    setData({ employees, branches, scans, leaves, ots, advances, payrollRuns, settings: settingsRows[0] });
  }, [store]);

  useEffect(() => { seed(store).then(load); }, [store, load]);

  // Offline scans get their server time (and the clock-skew check) once the phone is back online.
  useEffect(() => {
    if (!data) return;
    const sync = async () => {
      const waiting = data.scans.filter(s => s.offline && !s.serverTime);
      for (const s of waiting) {
        const serverTime = new Date();
        const v = evaluateScan({ gps: s.lat != null ? { lat: s.lat, lng: s.lng! } : null, faceScore: s.faceScore ?? null,
          deviceTime: new Date(s.deviceTime), serverTime }, data.branches, data.settings);
        await store.put('scans', { ...s, serverTime: serverTime.toISOString(), status: v.ok ? 'ok' : 'pending', reasons: v.reasons }, s.employeeId, 'sync-offline-scan');
      }
      if (waiting.length) load();
    };
    if (navigator.onLine) sync();
    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
  }, [data, store, load]);

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
    store,
    shifts,
    resetDemo: () => { store.reset(); seed(store).then(load); }
  };

  if (!value) return <div className="empty">ກຳລັງໂຫຼດ…</div>;
  return <HRContext.Provider value={value}>{children}</HRContext.Provider>;
}
