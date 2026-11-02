import type { DataStore } from '../data/store';
import { reevaluateOfflineScan } from '../domain/attendance';
import type { Branch, ScanRecord, Settings } from '../domain/types';

let running: Promise<number> | null = null;

/**
 * Settle every scan that was saved offline: stamp the server time and repeat the checks with a fresh clock comparison.
 * - Concurrent calls share one run, so a scan is never synced (or audited) twice.
 * - A reviewer's decision (approved / rejected) is never overwritten.
 * - If a write fails the scan stays unsettled and the next call retries it.
 * Returns how many scans were settled.
 */
export function syncOfflineScans(store: DataStore, branches: Branch[], settings: Settings, clock: () => { serverNow: Date; deviceNow: Date } = () => ({ serverNow: new Date(), deviceNow: new Date() })): Promise<number> {
  if (running) return running;
  running = (async () => {
    const all = await store.list<ScanRecord>('scans');
    let settled = 0;
    for (const s of all.filter(x => x.offline && !x.serverTime)) {
      const fresh = await store.get<ScanRecord>('scans', s.id); // a reviewer may have acted since the list was read
      if (!fresh || fresh.serverTime) continue;
      const ctx = clock();
      const v = reevaluateOfflineScan(fresh, branches, settings, ctx);
      const decided = fresh.status === 'approved' || fresh.status === 'rejected';
      await store.put<ScanRecord>('scans', { ...fresh, serverTime: ctx.serverNow.toISOString(), reasons: v.reasons, status: decided ? fresh.status : v.ok ? 'ok' : 'pending' }, fresh.employeeId, 'sync-offline-scan');
      settled++;
    }
    return settled;
  })().finally(() => { running = null; });
  return running;
}
