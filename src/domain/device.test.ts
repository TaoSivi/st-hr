import { describe, expect, it } from 'vitest';
import { DEVICE_REASON, deviceChangeBlock, deviceVerdict, isDeviceReason } from './device';
import { evaluateScan, reevaluateOfflineScan } from './attendance';
import { decideRequest, requestBlock, validateRequest, type HRRequest } from './requests';
import { approvalAccess } from './permissions';
import { decideAndApply } from '../app/workflow';
import { defaultSettings } from './defaults';
import { branches, employees } from '../data/seed';
import type { Employee, ScanRecord } from './types';

const S = defaultSettings('c1');
const here = { lat: branches[0].lat, lng: branches[0].lng };
const t = new Date('2026-11-02T08:00:00');
const scan = (device?: { bound?: string; current: string }) => evaluateScan({ gps: here, faceScore: 95, deviceTime: t, serverTime: t, device }, branches, S);

describe('deviceVerdict', () => {
  it('the first phone binds itself, the bound phone passes, any other goes to review', () => {
    expect(deviceVerdict(undefined, 'd1')).toEqual({ ok: true, bind: true });
    expect(deviceVerdict('d1', 'd1')).toEqual({ ok: true, bind: false });
    expect(deviceVerdict('d1', 'd2')).toEqual({ ok: false, bind: false, reason: DEVICE_REASON });
  });
  it('an unreadable phone id is never trusted, and never binds', () => expect(deviceVerdict(undefined, '')).toMatchObject({ ok: false, bind: false }));
  it('the reason is recognised by its prefix', () => {
    expect(isDeviceReason(DEVICE_REASON)).toBe(true);
    expect(isDeviceReason('ບໍ່ມີ GPS')).toBe(false);
  });
  it('a change request cannot name the phone that is already bound, or an empty one', () => {
    expect(deviceChangeBlock('d1', 'd1')).toMatch('ຜູກໄວ້');
    expect(deviceChangeBlock('d1', '')).toMatch('ລະຫັດເຄື່ອງ');
    expect(deviceChangeBlock('d1', 'd2')).toBeNull();
    expect(deviceChangeBlock(undefined, 'd2')).toBeNull();
  });
});

describe('a scan from another phone', () => {
  it('is saved for review with the phone reason, never refused', () => {
    const v = scan({ bound: 'd1', current: 'd2' });
    expect(v.ok).toBe(false);
    expect(v.reasons).toEqual([DEVICE_REASON]);
  });
  it('passes on the bound phone, on the first phone, and when no device check is asked for', () => {
    expect(scan({ bound: 'd1', current: 'd1' }).ok).toBe(true);
    expect(scan({ bound: undefined, current: 'd1' }).ok).toBe(true);
    expect(scan(undefined).ok).toBe(true);
  });
  it('adds to the other reasons instead of replacing them', () => {
    const v = evaluateScan({ gps: null, faceScore: 40, deviceTime: t, serverTime: t, device: { bound: 'd1', current: 'd2' } }, branches, S);
    expect(v.reasons).toContain(DEVICE_REASON);
    expect(v.reasons.length).toBeGreaterThanOrEqual(3);
  });
  it('the server re-check of an offline scan does not drop the phone reason', async () => {
    const { syncOfflineScans } = await import('../app/offlineSync');
    const { LocalStore } = await import('../data/store');
    const mem = new Map<string, string>();
    (globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    const store = new LocalStore('c1', 'dev:');
    const base: ScanRecord = { id: 's1', companyId: 'c1', employeeId: 'e-kl', kind: 'in', deviceTime: t.toISOString(), branchId: branches[0].id, lat: here.lat, lng: here.lng, faceScore: 95, status: 'pending', reasons: [DEVICE_REASON], offline: true, deviceId: 'd2' };
    await store.put('scans', base, 'e-kl', 'test');
    await store.put('scans', { ...base, id: 's2', status: 'ok', reasons: [], deviceId: 'd1' }, 'e-kl', 'test');
    await syncOfflineScans(store, branches, S, () => ({ serverNow: t, deviceNow: t }));
    const [a, b] = await Promise.all([store.get<ScanRecord>('scans', 's1'), store.get<ScanRecord>('scans', 's2')]);
    expect(a).toMatchObject({ status: 'pending', reasons: [DEVICE_REASON] });
    expect(a!.serverTime).toBeTruthy();
    expect(b).toMatchObject({ status: 'ok', reasons: [] }); // a clean scan still settles clean
    // and a plain re-evaluation by itself knows nothing about the phone, which is why the sync carries it over
    expect(reevaluateOfflineScan(base, branches, S, { serverNow: t, deviceNow: t }).reasons).toEqual([]);
  });
});

describe('moving an account to another phone', () => {
  const kl = employees.find(e => e.id === 'e-kl')!;
  const owner = employees.find(e => e.id === 'e-owner')!;
  const head = employees.find(e => e.id === 'e-head')!;
  const req = (over: Partial<HRRequest<'deviceChange'>> = {}): HRRequest<'deviceChange'> => ({
    id: 'r1', companyId: 'c1', kind: 'deviceChange', employeeId: 'e-kl', payload: { newDeviceId: 'd2', label: 'Android · Chrome' }, reason: 'ເຮັດໂທລະສັບເສຍ', createdAt: '2026-11-02T09:00:00', approvals: [], status: 'pending', ...over
  });
  const NOW = new Date('2026-11-02T10:00:00');

  it('needs a phone id', () => {
    expect(validateRequest('deviceChange', { newDeviceId: 'd2' }, '2026-11-02')).toBeNull();
    expect(validateRequest('deviceChange', { newDeviceId: '' }, '2026-11-02')).toMatch('ລະຫັດເຄື່ອງ');
  });
  it('only the owner may decide it: not the head, the accountant, the auditor, or the person themself', () => {
    expect(requestBlock(req(), owner, S, NOW)).toBeNull();
    for (const id of ['e-head', 'e-acc', 'e-aud']) expect(requestBlock(req(), employees.find(e => e.id === id)!, S, NOW), id).not.toBeNull();
    expect(requestBlock(req({ employeeId: 'e-owner' }), owner, S, NOW)).toMatch('ຕົນເອງ');
    expect(requestBlock(req(), kl, S, NOW)).not.toBeNull();
  });
  it('after the escalation window the owner still decides it (nothing widens to heads)', () => {
    const late = new Date('2026-11-05T10:00:00');
    expect(requestBlock(req(), head, S, late)).not.toBeNull();
  });
  it('shows up for the owner to act on and the auditor to read, and for nobody else', () => {
    expect(approvalAccess(owner.roles, 'device', S)).toBe('act');
    expect(approvalAccess(employees.find(e => e.id === 'e-aud')!.roles, 'device', S)).toBe('view');
    for (const id of ['e-kl', 'e-head', 'e-acc']) expect(approvalAccess(employees.find(e => e.id === id)!.roles, 'device', S), id).toBe('none');
  });
  it('approving it binds the new phone and clears the face, once', async () => {
    const saved: { collection: string; item: any; action: string }[] = [];
    const bound: Employee = { ...kl, deviceId: 'd1', faceEnrolled: [0.1, 0.2] };
    const hr: any = {
      me: owner, settings: S, employees: [owner, bound], overrides: [], leaves: [],
      save: async (collection: string, item: any, action: string) => { saved.push({ collection, item, action }); },
      notify: async () => {}
    };
    await decideAndApply(hr, req(), 'approve');
    const emp = saved.find(s => s.collection === 'employees')!;
    expect(emp.action).toBe('device-change-apply');
    expect(emp.item).toMatchObject({ id: 'e-kl', deviceId: 'd2' });
    expect(emp.item.faceEnrolled).toBeUndefined();
    expect(emp.item.deviceBoundAt).toBeTruthy();
    expect(saved.filter(s => s.collection === 'employees')).toHaveLength(1);
    expect(saved.find(s => s.collection === 'requests')!.item).toMatchObject({ status: 'approved' });
  });
  it('rejecting it changes nothing about the account but needs a reason', async () => {
    const saved: { collection: string }[] = [];
    const hr: any = { me: owner, settings: S, employees: [owner, kl], overrides: [], leaves: [], save: async (collection: string) => { saved.push({ collection }); }, notify: async () => {} };
    await expect(decideAndApply(hr, req(), 'reject')).rejects.toThrow();
    await decideAndApply(hr, req(), 'reject', 'ບໍ່ແນ່ໃຈວ່າແມ່ນຕົວຈິງ');
    expect(saved.some(s => s.collection === 'employees')).toBe(false);
  });
  it('decideRequest alone approves with one approver (the company default)', () => {
    expect(decideRequest(req(), owner, 'approve', S, NOW).status).toBe('approved');
  });
});
