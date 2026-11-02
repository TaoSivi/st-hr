import { describe, it, expect } from 'vitest';
import { allowedActions, dayStatus, monthGrid, type DayInput } from './day';

const k = (...kinds: string[]) => kinds.map(kind => ({ kind: kind as any, status: 'ok' as const }));

describe('allowedActions', () => {
  it('starts with clock-in only', () => {
    expect(allowedActions([])).toEqual({ in: true, breakStart: false, breakEnd: false, out: false });
  });
  it('after clock-in: break or clock-out', () => {
    expect(allowedActions(k('in'))).toEqual({ in: false, breakStart: true, breakEnd: false, out: true });
  });
  it('during break only end-break; one break per day', () => {
    expect(allowedActions(k('in', 'breakStart'))).toEqual({ in: false, breakStart: false, breakEnd: true, out: false });
    expect(allowedActions(k('in', 'breakStart', 'breakEnd'))).toEqual({ in: false, breakStart: false, breakEnd: false, out: true });
  });
  it('a rejected scan does not count', () => {
    expect(allowedActions([{ kind: 'in', status: 'rejected' }]).in).toBe(true);
  });
  it('after clock-out a new clock-in is allowed (split shift)', () => {
    expect(allowedActions(k('in', 'out')).in).toBe(true);
  });
});

describe('dayStatus', () => {
  const base: DayInput = { date: '2026-11-03', today: '2026-11-05', startDate: '2026-01-01', shiftStart: '08:00', graceMinutes: 5,
    dayOff: [0], holidays: [], scans: [], leaves: [] };
  const scan = (t: string, status: any = 'ok') => ({ kind: 'in' as const, status, deviceTime: `2026-11-03T${t}:00` });
  it('on time, late and pending', () => {
    expect(dayStatus({ ...base, scans: [scan('08:05')] })).toBe('ok');
    expect(dayStatus({ ...base, scans: [scan('08:06')] })).toBe('late');
    expect(dayStatus({ ...base, scans: [scan('08:00', 'pending')] })).toBe('pending');
  });
  it('no scan in the past is absent, but day off and today are not', () => {
    expect(dayStatus(base)).toBe('absent');
    expect(dayStatus({ ...base, date: '2026-11-01' })).toBe('dayoff'); // Sunday
    expect(dayStatus({ ...base, date: '2026-11-05' })).toBe('future');
  });
  it('approved leave and holidays override', () => {
    expect(dayStatus({ ...base, leaves: [{ from: '2026-11-02', to: '2026-11-04', status: 'approved' }] })).toBe('leave');
    expect(dayStatus({ ...base, leaves: [{ from: '2026-11-03', to: '2026-11-03', status: 'pending' }] })).toBe('absent');
    expect(dayStatus({ ...base, holidays: ['2026-11-03'] })).toBe('holiday');
  });
  it('before hire date', () => {
    expect(dayStatus({ ...base, startDate: '2026-11-04' })).toBe('before-hire');
  });
});

describe('monthGrid', () => {
  it('Nov 2026 starts on Sunday 1 Nov and fills 42 cells', () => {
    const g = monthGrid(2026, 10);
    expect(g).toHaveLength(42);
    expect(g[0]).toEqual({ date: '2026-11-01', inMonth: true });
    expect(g[29].date).toBe('2026-11-30');
    expect(g[30]).toEqual({ date: '2026-12-01', inMonth: false });
  });
});
