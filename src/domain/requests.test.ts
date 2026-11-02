import { describe, it, expect } from 'vitest';
import { defaultSettings } from './defaults';
import { decideRequest, effectiveShift, overridesFor, requestBlock, validateRequest, type HRRequest } from './requests';

const S = defaultSettings('c1');
const now = new Date('2026-11-02T10:00:00');
const head = { id: 'h1', roles: ['head' as const] };
const acc = { id: 'a1', roles: ['accountant' as const] };
const owner = { id: 'o1', roles: ['owner' as const] };
const req = <K extends HRRequest['kind']>(kind: K, payload: any, employeeId = 'e1'): HRRequest<K> =>
  ({ id: 'r1', companyId: 'c1', kind, employeeId, payload, reason: 'x', createdAt: '2026-11-02T09:00:00', approvals: [], status: 'pending' });

describe('request approvals', () => {
  it('uses per-kind approver roles', () => {
    expect(requestBlock(req('expense', {}), acc, S, now)).toBeNull();
    expect(requestBlock(req('ot', {}), acc, S, now)).toMatch('ບໍ່ມີສິດ');
    expect(requestBlock(req('certificate', {}), head, S, now)).toMatch('ບໍ່ມີສິດ');
    expect(requestBlock(req('certificate', {}), owner, S, now)).toBeNull();
  });
  it('blocks self-approval and the swap partner', () => {
    expect(requestBlock(req('ot', {}, 'h1'), head, S, now)).toMatch('ຕົນເອງ');
    expect(requestBlock(req('shiftSwap', { date: '2026-11-03', withEmployeeId: 'h1' }), head, S, now)).toMatch('ຄູ່ສະລັບ');
  });
  it('needs N distinct approvals and a reason to reject', () => {
    const s2 = { ...S, leaveApproversRequired: 2 as const };
    const r1 = decideRequest(req('ot', {}), head, 'approve', s2, now);
    expect(r1.status).toBe('pending');
    expect(() => decideRequest(r1, head, 'approve', s2, now)).toThrow();
    expect(decideRequest(r1, owner, 'approve', s2, now).status).toBe('approved');
    expect(() => decideRequest(req('ot', {}), head, 'reject', S, now)).toThrow();
  });
  it('accountant may act on OT only after escalation? no — escalation only adds owner', () => {
    expect(requestBlock(req('ot', {}), acc, S, new Date('2026-11-04T10:00:00'))).toMatch('ບໍ່ມີສິດ');
  });
});

describe('validateRequest', () => {
  it('rejects bad input per kind', () => {
    expect(validateRequest('clockFix', { date: '2026-11-03', time: '08:00' }, '2026-11-02')).toMatch('ລ່ວງໜ້າ');
    expect(validateRequest('ot', { date: '2026-11-02', minutes: 0 }, '2026-11-02')).toMatch('1–720');
    expect(validateRequest('dayOffSwap', { fromDate: '2026-11-08', toDate: '2026-11-08' }, '')).toMatch('ຕ່າງກັນ');
    expect(validateRequest('expense', { date: '2026-11-02', category: 'ເດີນທາງ', amount: 50000 }, '')).toBeNull();
  });
});

describe('shifts after approvals', () => {
  const a = { id: 'a', shiftId: 'morning', dayOff: [0] };
  const b = { id: 'b', shiftId: 'evening', dayOff: [1] };
  it('default shift, weekly day off', () => {
    expect(effectiveShift(a, '2026-11-02', [])).toBe('morning'); // Monday
    expect(effectiveShift(a, '2026-11-01', [])).toBeNull(); // Sunday
  });
  it('shift swap exchanges both people for that day', () => {
    const o = overridesFor(req('shiftSwap', { date: '2026-11-03', withEmployeeId: 'b' }, 'a'), [a, b], []);
    expect(effectiveShift(a, '2026-11-03', o)).toBe('evening');
    expect(effectiveShift(b, '2026-11-03', o)).toBe('morning');
  });
  it('swapping with someone on their day off gives them my shift and me the day off', () => {
    const o = overridesFor(req('shiftSwap', { date: '2026-11-02', withEmployeeId: 'b' }, 'a'), [a, b], []);
    expect(effectiveShift(a, '2026-11-02', o)).toBeNull();
    expect(effectiveShift(b, '2026-11-02', o)).toBe('morning');
  });
  it('day-off swap: work the Sunday, rest on Wednesday', () => {
    const o = overridesFor(req('dayOffSwap', { fromDate: '2026-11-08', toDate: '2026-11-11' }, 'a'), [a, b], []);
    expect(effectiveShift(a, '2026-11-08', o)).toBe('morning');
    expect(effectiveShift(a, '2026-11-11', o)).toBeNull();
  });
  it('schedule change sets a shift on several dates', () => {
    const o = overridesFor(req('schedule', { dates: ['2026-11-04', '2026-11-05'], shiftId: 'evening' }, 'a'), [a, b], []);
    expect(o.map(x => effectiveShift(a, x.date, o))).toEqual(['evening', 'evening']);
  });
});
