import { describe, expect, it } from 'vitest';
import { lateStartFor, leaveRequestBlock, leaveSpan, partialDays, shiftPaidHours, type LeaveAsk } from './leavePart';
import { compBalance, compDaysFor } from './comp';
import { dayStatus } from './day';
import { buildAttendance, type ReportInput } from './attendanceReport';
import { compBalanceFor, lateStartOn } from '../app/payrun';
import { defaultSettings } from './defaults';
import { branches, employees, shifts } from '../data/seed';
import type { LeaveRequest, ScanRecord } from './types';

const morning = shifts.find(s => s.id === 'morning')!; // 06:00-14:00, break 10:00-10:30 → 7.5 paid hours
const leave = (over: Partial<LeaveRequest> = {}): LeaveRequest => ({ id: 'l' + Math.random(), companyId: 'c1', employeeId: 'e-kl', type: 'annual', from: '2026-11-04', to: '2026-11-04', days: 1, reason: 'x', createdAt: '2026-11-02T09:00:00', approvals: [], status: 'approved', ...over });
const ctx = (existing: LeaveRequest[] = [], over: object = {}) => ({ existing, paidHours: 7.5, weeklyOff: [0], holidays: ['2026-11-05'], annualLeft: 10, compLeft: 1, ...over });
const ask = (over: Partial<LeaveAsk> = {}): LeaveAsk => ({ type: 'annual', from: '2026-11-04', to: '2026-11-04', days: 0.5, part: 'am', ...over });

describe('paid hours and part-day length', () => {
  it('a shift is its length minus the break', () => {
    expect(shiftPaidHours(morning)).toBe(7.5);
    expect(shiftPaidHours({ start: '22:00', end: '06:00', breakStart: '01:00', breakEnd: '01:30' })).toBe(7.5); // across midnight
    expect(shiftPaidHours({ start: '09:00', end: '18:00', breakStart: '12:00', breakEnd: '13:00' })).toBe(8);
  });
  it('half a day is 0.5; hours are a share of the paid day', () => {
    expect(partialDays('am', undefined, 7.5)).toBe(0.5);
    expect(partialDays('pm', undefined, 7.5)).toBe(0.5);
    expect(partialDays('hours', 3, 7.5)).toBe(0.4);
    expect(partialDays('hours', 2, 8)).toBe(0.25);
    expect(partialDays('hours', 1.5, 7.5)).toBe(0.2);
  });
  it('lists show what the leave is', () => {
    expect(leaveSpan({ days: 2 })).toBe('2 ມື້');
    expect(leaveSpan({ days: 0.5, part: 'am' })).toBe('ເຄິ່ງວັນເຊົ້າ');
    expect(leaveSpan({ days: 0.4, part: 'hours', hours: 3 })).toBe('3 ຊົ່ວໂມງ');
  });
});

describe('leaveRequestBlock', () => {
  it('accepts a half day', () => expect(leaveRequestBlock(ask(), ctx())).toBeNull());
  it('part-day leave is one day only', () => expect(leaveRequestBlock(ask({ to: '2026-11-06' }), ctx())).toMatch('ມື້ດຽວ'));
  it('refuses a half day on a weekly day off or a holiday', () => {
    expect(leaveRequestBlock(ask({ from: '2026-11-08', to: '2026-11-08' }), ctx())).toMatch('ວັນພັກ'); // Sunday
    expect(leaveRequestBlock(ask({ from: '2026-11-05', to: '2026-11-05' }), ctx())).toMatch('ວັນພັກ'); // holiday
  });
  it('hours must be positive, whole or half, and less than a full day', () => {
    const h = (hours: number | undefined) => leaveRequestBlock(ask({ part: 'hours', hours, days: 0.4 }), ctx());
    expect(h(3)).toBeNull();
    expect(h(1.5)).toBeNull();
    expect(h(0)).toMatch('ຊົ່ວໂມງ');
    expect(h(undefined)).toMatch('ຊົ່ວໂມງ');
    expect(h(NaN)).toMatch('ຊົ່ວໂມງ');
    expect(h(-1)).toMatch('ຊົ່ວໂມງ');
    expect(h(2.3)).toMatch('ເຄິ່ງຊົ່ວໂມງ');
    expect(h(7.5)).toMatch('ເຕັມວັນ');
    expect(h(8)).toMatch('ເຕັມວັນ');
  });
  it('morning and afternoon of the same day are fine; the same half twice is not', () => {
    expect(leaveRequestBlock(ask({ part: 'pm' }), ctx([leave({ part: 'am', days: 0.5 })]))).toBeNull();
    expect(leaveRequestBlock(ask({ part: 'am' }), ctx([leave({ part: 'am', days: 0.5 })]))).toMatch('ຊ່ວງນີ້');
  });
  it('hours on top of a half day that would exceed one day are refused', () => {
    expect(leaveRequestBlock(ask({ part: 'hours', hours: 5, days: 0.67 }), ctx([leave({ part: 'am', days: 0.5 })]))).toMatch('ເກີນ 1 ມື້');
    expect(leaveRequestBlock(ask({ part: 'hours', hours: 2, days: 0.27 }), ctx([leave({ part: 'am', days: 0.5 })]))).toBeNull();
  });
  it('nothing can be added to a day already taken as a whole day', () => {
    expect(leaveRequestBlock(ask(), ctx([leave()]))).toMatch('ເຕັມວັນຢູ່ແລ້ວ');
  });
  it('a whole-day request that overlaps booked leave is refused, but rejected or cancelled leave does not block', () => {
    const full = ask({ part: undefined, days: 2, from: '2026-11-03', to: '2026-11-04' });
    expect(leaveRequestBlock(full, ctx([leave({ from: '2026-11-04', to: '2026-11-06', status: 'pending' })]))).toMatch('ທັບຊ້ອນ');
    expect(leaveRequestBlock(full, ctx([leave({ status: 'rejected' })]))).toBeNull();
    expect(leaveRequestBlock(full, ctx([leave({ status: 'cancelled' })]))).toBeNull();
    expect(leaveRequestBlock(full, ctx([leave({ from: '2026-11-05', to: '2026-11-06' })]))).toBeNull(); // next to it, not on it
  });
  it('annual leave cannot exceed the balance, including part days; other kinds ignore it', () => {
    expect(leaveRequestBlock(ask({ days: 0.5 }), ctx([], { annualLeft: 0.25 }))).toMatch('ບໍ່ພໍ');
    expect(leaveRequestBlock(ask({ days: 0.5 }), ctx([], { annualLeft: 0.5 }))).toBeNull();
    expect(leaveRequestBlock(ask({ type: 'sick', days: 0.5 }), ctx([], { annualLeft: 0 }))).toBeNull();
  });
  it('compensatory leave is limited by the compensatory balance', () => {
    expect(leaveRequestBlock(ask({ type: 'comp', part: undefined, days: 2, to: '2026-11-06' }), ctx([], { compLeft: 1 }))).toMatch('ພັກຊົດເຊີຍ');
    expect(leaveRequestBlock(ask({ type: 'comp', part: undefined, days: 1 }), ctx([], { compLeft: 1 }))).toBeNull();
  });
  it('bad dates and zero days are refused', () => {
    expect(leaveRequestBlock(ask({ from: '', part: undefined }), ctx())).toMatch('ວັນທີ');
    expect(leaveRequestBlock(ask({ part: undefined, days: 0 }), ctx())).toMatch('ວັນທີ');
    expect(leaveRequestBlock(ask({ part: undefined, from: '2026-11-06', to: '2026-11-04', days: 1 }), ctx())).toMatch('ວັນທີ');
  });
});

describe('lateness after a morning leave', () => {
  it('measured from after the break when the morning is approved leave; otherwise from the shift start', () => {
    expect(lateStartFor(morning, [{ part: 'am', status: 'approved' }])).toBe('10:30');
    expect(lateStartFor(morning, [{ part: 'am', status: 'pending' }])).toBe('06:00');
    expect(lateStartFor(morning, [{ part: 'pm', status: 'approved' }])).toBe('06:00');
    expect(lateStartFor(morning, [{ part: 'hours', status: 'approved' }])).toBe('06:00');
    expect(lateStartFor(morning, [])).toBe('06:00');
  });
});

describe('a part-day leave does not make the whole day a leave day', () => {
  const base = { date: '2026-11-04', today: '2026-11-06', startDate: '2026-01-01', shiftStart: '06:00', graceMinutes: 5, dayOff: [0], holidays: [], scans: [] };
  it('whole-day leave still wins; part-day leave leaves the day to the scans', () => {
    expect(dayStatus({ ...base, leaves: [{ from: '2026-11-04', to: '2026-11-04', status: 'approved' }] })).toBe('leave');
    expect(dayStatus({ ...base, leaves: [{ from: '2026-11-04', to: '2026-11-04', status: 'approved', part: 'am' }] })).toBe('absent'); // no scans at all
  });
});

describe('compensatory days earned and used', () => {
  it('earned in halves by the time worked on the holiday, at most one', () => {
    expect(compDaysFor(450, 450)).toBe(1);
    expect(compDaysFor(300, 450)).toBe(0.5); // 0.67 of a day rounds to 0.5
    expect(compDaysFor(200, 450)).toBe(0.5);
    expect(compDaysFor(60, 450)).toBe(0);
    expect(compDaysFor(900, 450)).toBe(1);
    expect(compDaysFor(0, 450)).toBe(0);
    expect(compDaysFor(100, 0)).toBe(0);
  });
  const earned = [{ date: '2026-08-01', days: 1 }, { date: '2026-10-01', days: 0.5 }];
  it('adds up, with nothing used', () => expect(compBalance({ earned, used: [], asOf: '2026-10-15', expiryDays: 90 })).toEqual({ earned: 1.5, used: 0, expired: 0, left: 1.5 }));
  it('days expire after the set period, and leave uses the oldest days first', () => {
    // 1 Aug + 90 = 30 Oct: gone by 2 Nov; the October day is still valid
    expect(compBalance({ earned, used: [], asOf: '2026-11-02', expiryDays: 90 })).toEqual({ earned: 1.5, used: 0, expired: 1, left: 0.5 });
    const used = compBalance({ earned, used: [{ from: '2026-10-10', days: 1 }], asOf: '2026-11-02', expiryDays: 90 });
    expect(used).toMatchObject({ used: 1, expired: 0, left: 0.5 }); // the August day was used before it expired
  });
  it('leave cannot use days earned after it, or days already expired when it started', () => {
    expect(compBalance({ earned, used: [{ from: '2026-09-01', days: 1 }], asOf: '2026-09-02', expiryDays: 90 }).used).toBe(1);
    expect(compBalance({ earned: [{ date: '2026-10-01', days: 1 }], used: [{ from: '2026-09-01', days: 1 }], asOf: '2026-10-02', expiryDays: 90 })).toMatchObject({ used: 0, left: 1 });
    expect(compBalance({ earned: [{ date: '2026-01-01', days: 1 }], used: [{ from: '2026-06-01', days: 1 }], asOf: '2026-06-02', expiryDays: 90 })).toMatchObject({ used: 0, expired: 1, left: 0 });
  });
  it('0 means never expires; days earned in the future are not counted as available', () => {
    expect(compBalance({ earned: [{ date: '2020-01-01', days: 2 }], used: [], asOf: '2026-11-02', expiryDays: 0 }).left).toBe(2);
    expect(compBalance({ earned: [{ date: '2026-12-01', days: 1 }], used: [], asOf: '2026-11-02', expiryDays: 90 }).left).toBe(0);
  });
});

describe('the whole picture from stored data', () => {
  const S = { ...defaultSettings('c1'), holidays: ['2026-11-03'] };
  const kl = employees.find(e => e.id === 'e-kl')!;
  let n = 0;
  const scan = (kind: ScanRecord['kind'], d: Date): ScanRecord => ({ id: 'x' + n++, companyId: 'c1', employeeId: 'e-kl', kind, deviceTime: d.toISOString(), serverTime: d.toISOString(), branchId: branches[0].id, status: 'ok', reasons: [], offline: false });
  const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m);
  const data = (scans: ScanRecord[], leaves: LeaveRequest[] = []) => ({ employees, branches, scans, leaves, ots: [], advances: [], payrollRuns: [], requests: [], overrides: [], shifts, notifications: [], settings: S }) as any;

  it('working a whole shift on a holiday earns a day; working little earns none; leave takes it back', () => {
    const worked = [scan('in', at(3, 6)), scan('breakStart', at(3, 10)), scan('breakEnd', at(3, 10, 30)), scan('out', at(3, 14))];
    expect(compBalanceFor(data(worked), kl, '2026-11-10')).toMatchObject({ earned: 1, left: 1 });
    expect(compBalanceFor(data([scan('in', at(3, 6)), scan('out', at(3, 7))]), kl, '2026-11-10').earned).toBe(0);
    expect(compBalanceFor(data([]), kl, '2026-11-10').earned).toBe(0);
    const taken = leave({ type: 'comp', from: '2026-11-06', to: '2026-11-06', days: 1, status: 'pending' });
    expect(compBalanceFor(data(worked, [taken]), kl, '2026-11-10')).toMatchObject({ used: 1, left: 0 });
    expect(compBalanceFor(data(worked, [{ ...taken, status: 'rejected' }]), kl, '2026-11-10').left).toBe(1);
  });
  it('an unconfirmed offline scan does not earn a day', () => {
    const pendingSync = [{ ...scan('in', at(3, 6)), offline: true, serverTime: undefined }, { ...scan('out', at(3, 14)), offline: true, serverTime: undefined }] as ScanRecord[];
    expect(compBalanceFor(data(pendingSync), kl, '2026-11-10').earned).toBe(0);
  });
  it('lateness on a morning-leave day is judged from 10:30', () => {
    const am = leave({ part: 'am', days: 0.5, from: '2026-11-04', to: '2026-11-04' });
    expect(lateStartOn(data([], [am]), kl, '2026-11-04')).toBe('10:30');
    expect(lateStartOn(data([]), kl, '2026-11-04')).toBe('06:00');
    expect(lateStartOn(data([]), kl, '2026-11-08')).toBeNull(); // Sunday off
  });
  it('the report shows a half day as a note and a fractional leave total, and does not mark the person late', () => {
    const am = leave({ part: 'am', days: 0.5, from: '2026-11-04', to: '2026-11-04' });
    const inp: ReportInput = { employees: [{ ...kl, startDate: '2026-10-01' }], scans: [scan('in', at(4, 10, 32)), scan('out', at(4, 14, 2))], leaves: [am], ots: [], overrides: [], shifts, branches, settings: S, year: 2026, month: 10, today: '2026-11-06' };
    const r = buildAttendance(inp);
    const row = r.days.find(d => d.date === '2026-11-04')!;
    expect(row.status).toBe('ok');
    expect(row.lateMin).toBe(0);
    expect(row.note).toMatch('ເຄິ່ງວັນເຊົ້າ');
    expect(r.summary[0].leaveDays).toBe(0.5);
    expect(r.summary[0].workedDays).toBeGreaterThanOrEqual(1);
    const late = buildAttendance({ ...inp, scans: [scan('in', at(4, 10, 50)), scan('out', at(4, 14, 2))] });
    expect(late.days.find(d => d.date === '2026-11-04')!.lateMin).toBe(20);
  });
});
