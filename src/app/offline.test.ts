import { beforeEach, describe, expect, it } from 'vitest';
import { LocalStore } from '../data/store';
import { branches as seedBranches, employees as seedEmployees, shifts } from '../data/seed';
import { defaultSettings } from '../domain/defaults';
import { evaluateScan, isSettled, reevaluateOfflineScan } from '../domain/attendance';
import { syncOfflineScans } from './offlineSync';
import { summarize } from './payrun';
import type { HRData } from './state';
import type { AuditEntry, ScanRecord } from '../domain/types';

// ---- a browser-like localStorage with an optional size limit and per-key failure, to rehearse a full phone ----
class FakeStorage {
  private m = new Map<string, string>();
  limit = Infinity;
  failKeys = new Set<string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) {
    if (this.failKeys.has(k)) throw Object.assign(new Error('x'), { name: 'QuotaExceededError' });
    const size = [...this.m].reduce((a, [kk, vv]) => a + (kk === k ? 0 : kk.length + vv.length), 0) + k.length + v.length;
    if (size > this.limit) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    this.m.set(k, v);
  }
  removeItem(k: string) { this.m.delete(k); }
  keys() { return [...this.m.keys()]; }
}
let ls: FakeStorage;
beforeEach(() => {
  ls = new FakeStorage();
  (globalThis as any).localStorage = new Proxy(ls, { ownKeys: t => t.keys(), getOwnPropertyDescriptor: (t, k) => (typeof k === 'string' && t.getItem(k) !== null ? { enumerable: true, configurable: true, value: t.getItem(k) } : undefined) });
});

const S = defaultSettings('c1');
const front = seedBranches[0];
const at = (iso: string) => new Date(iso);
const scan = (id: string, over: Partial<ScanRecord> = {}): ScanRecord => ({
  id, companyId: 'c1', employeeId: 'e-kl', kind: 'in', deviceTime: '2026-11-02T06:01:00.000Z', branchId: front.id, lat: front.lat, lng: front.lng,
  distanceM: 5, faceScore: 92, status: 'ok', reasons: [], offline: true, ...over
});
const auditOf = async (store: LocalStore, action: string) => (await store.audit()).filter((a: AuditEntry) => a.action === action);

describe('clock check for scans saved offline', () => {
  const synced = (s: ScanRecord, serverNow: string, deviceNow = serverNow) => reevaluateOfflineScan(s, seedBranches, S, { serverNow: at(serverNow), deviceNow: at(deviceNow) });

  it('REGRESSION: comparing the old scan time with the sync time would flag every scan that merely waited', () => {
    const wrong = evaluateScan({ gps: { lat: front.lat, lng: front.lng }, faceScore: 92, deviceTime: at('2026-11-02T06:01:00Z'), serverTime: at('2026-11-02T09:01:00Z') }, seedBranches, S);
    expect(wrong.ok).toBe(false); // what the old code did after a 3 hour wait
    expect(wrong.reasons.join()).toMatch('ໂມງໂທລະສັບຕ່າງ');
  });
  it('a good scan that waited 3 hours for a connection is accepted', () => {
    const v = synced(scan('a'), '2026-11-02T09:01:00Z');
    expect(v.ok).toBe(true);
    expect(v.reasons).toEqual([]);
  });
  it('a waited scan is also fine after days offline', () => {
    expect(synced(scan('a'), '2026-11-09T09:00:00Z').ok).toBe(true);
  });
  it('flags a phone whose clock is wrong at sync time, by exactly the limit', () => {
    expect(synced(scan('a'), '2026-11-02T09:00:00Z', '2026-11-02T09:02:00Z').ok).toBe(true); // 2 min = allowed limit
    const bad = synced(scan('a'), '2026-11-02T09:00:00Z', '2026-11-02T09:03:00Z');
    expect(bad.ok).toBe(false);
    expect(bad.reasons.join()).toMatch('ໂມງໂທລະສັບຕ່າງ 3');
  });
  it('a scan stamped in the future cannot be genuine', () => {
    const v = synced(scan('a', { deviceTime: '2026-11-02T10:00:00Z' }), '2026-11-02T09:00:00Z');
    expect(v.ok).toBe(false);
    expect(v.reasons.join()).toMatch('ອະນາຄົດ 60');
  });
  it('a scan stamped slightly ahead, within the limit, is tolerated', () => {
    expect(synced(scan('a', { deviceTime: '2026-11-02T09:01:30Z' }), '2026-11-02T09:00:00Z').ok).toBe(true);
  });
  it('keeps every other reason: no face, no GPS, far away, low score', () => {
    expect(synced(scan('a', { faceScore: undefined }), '2026-11-02T09:00:00Z').reasons).toContain('ບໍ່ພົບໃບໜ້າ');
    expect(synced(scan('a', { lat: undefined, lng: undefined }), '2026-11-02T09:00:00Z').reasons).toContain('ບໍ່ມີ GPS');
    expect(synced(scan('a', { lat: front.lat + 0.01 }), '2026-11-02T09:00:00Z').reasons.join()).toMatch('ຢູ່ໄກຮ້ານ');
    expect(synced(scan('a', { faceScore: 50 }), '2026-11-02T09:00:00Z').reasons.join()).toMatch('ໜ້າກົງກັນຕ່ຳ 50');
  });
  it('a hand-picked branch stays flagged after sync instead of turning into a clean scan', () => {
    const v = synced(scan('a', { manual: true, branchId: seedBranches[1].id }), '2026-11-02T09:00:00Z');
    expect(v.ok).toBe(false);
    expect(v.reasons.join()).toMatch('ເລືອກສາຂາເອງ');
    expect(v.branchId).toBe(seedBranches[1].id);
  });
  it('the face and clock limits follow Settings', () => {
    const strict = { ...S, faceMinScore: 95, maxClockSkewMin: 0 };
    expect(reevaluateOfflineScan(scan('a'), seedBranches, strict, { serverNow: at('2026-11-02T09:00:00Z'), deviceNow: at('2026-11-02T09:00:00Z') }).reasons.join()).toMatch('ໜ້າກົງກັນຕ່ຳ 92');
  });
  it('isSettled: offline scans count only after the server has stamped them', () => {
    expect(isSettled({ offline: true, serverTime: undefined })).toBe(false);
    expect(isSettled({ offline: true, serverTime: '2026-11-02T09:00:00Z' })).toBe(true);
    expect(isSettled({ offline: false, serverTime: undefined })).toBe(true);
    expect(isSettled({ offline: undefined, serverTime: undefined })).toBe(true);
  });
});

describe('syncing the offline queue into the real store', () => {
  const setup = async (...scans: ScanRecord[]) => {
    const store = new LocalStore('c1');
    for (const s of scans) await store.put('scans', s, s.employeeId, 'clock-in');
    return store;
  };
  const clock = (serverNow = '2026-11-02T09:00:00Z') => () => ({ serverNow: at(serverNow), deviceNow: at(serverNow) });

  it('settles every queued scan, each with its own verdict', async () => {
    const store = await setup(scan('good'), scan('nofaceBad', { faceScore: undefined, status: 'pending', reasons: ['ບໍ່ພົບໃບໜ້າ'] }));
    expect(await syncOfflineScans(store, seedBranches, S, clock())).toBe(2);
    const rows = await store.list<ScanRecord>('scans');
    expect(rows.every(r => r.serverTime === '2026-11-02T09:00:00.000Z')).toBe(true);
    expect(rows.find(r => r.id === 'good')).toMatchObject({ status: 'ok', reasons: [] });
    expect(rows.find(r => r.id === 'nofaceBad')).toMatchObject({ status: 'pending' });
  });
  it('is idempotent: a second run settles nothing and adds no audit entries', async () => {
    const store = await setup(scan('a'), scan('b'));
    await syncOfflineScans(store, seedBranches, S, clock());
    const before = (await auditOf(store, 'sync-offline-scan')).length;
    expect(before).toBe(2);
    expect(await syncOfflineScans(store, seedBranches, S, clock('2026-11-02T10:00:00Z'))).toBe(0);
    expect((await auditOf(store, 'sync-offline-scan')).length).toBe(2);
  });
  it('two triggers at the same moment (online event + data reload) still settle each scan once', async () => {
    const store = await setup(scan('a'), scan('b'), scan('c'));
    const [x, y] = await Promise.all([syncOfflineScans(store, seedBranches, S, clock()), syncOfflineScans(store, seedBranches, S, clock())]);
    expect(x).toBe(3);
    expect(y).toBe(3); // the second caller shares the first run
    expect((await auditOf(store, 'sync-offline-scan')).length).toBe(3);
  });
  it('never overwrites a reviewer who already approved or rejected the scan', async () => {
    const store = await setup(scan('appr', { status: 'approved', reviewedBy: 'e-head', faceScore: undefined }), scan('rej', { status: 'rejected', reviewedBy: 'e-head', reviewNote: 'ບໍ່ແມ່ນຄົນນີ້' }));
    await syncOfflineScans(store, seedBranches, S, clock());
    const rows = await store.list<ScanRecord>('scans');
    expect(rows.find(r => r.id === 'appr')).toMatchObject({ status: 'approved', reviewedBy: 'e-head' });
    expect(rows.find(r => r.id === 'rej')).toMatchObject({ status: 'rejected', reviewNote: 'ບໍ່ແມ່ນຄົນນີ້' });
    expect(rows.every(r => !!r.serverTime)).toBe(true);
  });
  it('leaves online scans alone', async () => {
    const store = await setup(scan('online', { offline: false, serverTime: '2026-11-02T06:01:00.000Z' }));
    expect(await syncOfflineScans(store, seedBranches, S, clock())).toBe(0);
  });
  it('a failed write keeps the scan queued and the next run completes it (no data loss, no half-written audit)', async () => {
    const store = await setup(scan('a'));
    ls.failKeys.add('sthr:scans');
    await expect(syncOfflineScans(store, seedBranches, S, clock())).rejects.toThrow();
    ls.failKeys.clear();
    expect((await store.list<ScanRecord>('scans'))[0].serverTime).toBeUndefined();
    expect(await auditOf(store, 'sync-offline-scan')).toHaveLength(0);
    expect(await syncOfflineScans(store, seedBranches, S, clock())).toBe(1);
    expect((await store.list<ScanRecord>('scans'))[0].serverTime).toBeDefined();
  });
  it('queued scans survive an app restart (a new store over the same storage still sees them)', async () => {
    await setup(scan('a'));
    const reopened = new LocalStore('c1');
    expect(await syncOfflineScans(reopened, seedBranches, S, clock())).toBe(1);
  });
});

describe('saving while the phone is nearly full', () => {
  it('audit entries do not store the photo, so many scans do not fill the storage twice over', async () => {
    const store = new LocalStore('c1');
    const photo = 'data:image/jpeg;base64,' + 'A'.repeat(12000);
    await store.put('scans', scan('p', { photo }), 'e-kl', 'clock-in');
    const log = await store.audit();
    expect(JSON.stringify(log)).not.toContain('AAAAAAAAAA');
    expect((await store.list<ScanRecord>('scans'))[0].photo).toBe(photo);
  });
  it('a full storage throws a readable error and leaves data and audit exactly as they were', async () => {
    const store = new LocalStore('c1');
    await store.put('scans', scan('first', { offline: false }), 'e-kl', 'clock-in');
    const used = ls.keys().reduce((a, k) => a + k.length + ls.getItem(k)!.length, 0);
    ls.limit = used + 40; // room for almost nothing
    await expect(store.put('scans', scan('second'), 'e-kl', 'clock-in')).rejects.toThrow('ໜ່ວຍຄວາມຈຳ');
    ls.limit = Infinity;
    expect((await store.list<ScanRecord>('scans')).map(s => s.id)).toEqual(['first']);
    expect((await store.audit()).filter(a => a.entityId === 'second')).toHaveLength(0);
  });
  it('when only the audit write fails, the data write is undone: a change never exists without its audit entry', async () => {
    const store = new LocalStore('c1');
    ls.failKeys.add('sthr:audit');
    await expect(store.put('scans', scan('x'), 'e-kl', 'clock-in')).rejects.toThrow();
    ls.failKeys.clear();
    expect(await store.list('scans')).toHaveLength(0);
  });
  it('unreadable stored data is backed up instead of being silently overwritten', async () => {
    ls.setItem('sthr:scans', '{broken json');
    const store = new LocalStore('c1');
    expect(await store.list('scans')).toEqual([]);
    expect(ls.getItem('sthr:scans:corrupt')).toBe('{broken json');
  });
});

describe('pay does not count an unchecked offline scan', () => {
  const emp = seedEmployees.find(e => e.id === 'e-kl')!; // morning shift, starts 06:00
  const data = (scans: ScanRecord[]): HRData => ({
    employees: seedEmployees, branches: seedBranches, scans, leaves: [], ots: [], advances: [], payrollRuns: [], requests: [], overrides: [], notifications: [], payItems: [], shifts, settings: S
  });
  const lateScan = (over: Partial<ScanRecord>) => scan('late', { deviceTime: '2026-11-03T06:30:00', ...over });

  it('an offline late scan adds no late minutes until the server settles it, then adds them', () => {
    expect(summarize(data([lateScan({ offline: true })]), emp, '2026-11', true).lateMin).toBe(0);
    expect(summarize(data([lateScan({ offline: true, serverTime: '2026-11-03T09:00:00Z' })]), emp, '2026-11', true).lateMin).toBe(30);
  });
  it('an online late scan counts at once', () => {
    expect(summarize(data([lateScan({ offline: false })]), emp, '2026-11', true).lateMin).toBe(30);
  });
});

describe('pay: late minutes come from the first clock-in of each day', () => {
  const emp = seedEmployees.find(e => e.id === 'e-kl')!; // morning shift, starts 06:00, grace 5
  const data = (scans: ScanRecord[]): HRData => ({
    employees: seedEmployees, branches: seedBranches, scans, leaves: [], ots: [], advances: [], payrollRuns: [], requests: [], overrides: [], notifications: [], payItems: [], shifts, settings: S
  });
  const at = (id: string, kind: ScanRecord['kind'], time: string, over: Partial<ScanRecord> = {}) => scan(id, { kind, deviceTime: `2026-11-03T${time}:00`, offline: false, ...over });

  it('on time in, out for a while, back in later: nobody is late', () => {
    const rows = [at('a', 'in', '06:00'), at('b', 'out', '10:00'), at('c', 'in', '12:00'), at('d', 'out', '14:00')];
    expect(summarize(data(rows), emp, '2026-11', true)).toMatchObject({ lateMin: 0, lateCount: 0 });
  });
  it('late on the first clock-in counts once, however many times they come back', () => {
    const rows = [at('a', 'in', '06:30'), at('b', 'out', '10:00'), at('c', 'in', '12:00'), at('d', 'out', '14:00')];
    expect(summarize(data(rows), emp, '2026-11', true)).toMatchObject({ lateMin: 30, lateCount: 1 });
  });
  it('each day has its own first clock-in', () => {
    const next = (id: string, kind: ScanRecord['kind'], time: string) => scan(id, { kind, deviceTime: `2026-11-04T${time}:00`, offline: false });
    const rows = [at('a', 'in', '06:20'), at('b', 'in', '13:00'), next('c', 'in', '06:10'), next('d', 'in', '11:00')];
    expect(summarize(data(rows), emp, '2026-11', true)).toMatchObject({ lateMin: 30, lateCount: 2 });
  });
  it('a rejected first clock-in is ignored; a waiting one is not skipped for a later one', () => {
    expect(summarize(data([at('a', 'in', '06:40', { status: 'rejected' }), at('b', 'in', '06:10')]), emp, '2026-11', true).lateMin).toBe(10);
    expect(summarize(data([at('a', 'in', '06:00', { status: 'pending' }), at('b', 'in', '07:00')]), emp, '2026-11', true).lateMin).toBe(0);
  });
});
