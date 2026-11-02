import { describe, expect, it } from 'vitest';
import { lateStartFor, leaveRequestBlock, partialDays, shiftPaidHours, shiftRange } from './leavePart';
import { closesAtFor, missedClockOutDates } from './missedOut';
import { validateShifts } from './settingsCheck';
import { dayStatus } from './day';
import { buildAttendance, type ReportInput } from './attendanceReport';
import { lateStartOn, summarize } from '../app/payrun';
import { missedDatesFor } from '../app/missedOut';
import { defaultSettings } from './defaults';
import { branches, employees, shifts as seedShifts } from '../data/seed';
import type { ScanRecord, Shift } from './types';

const flex: Shift = { id: 'flex', name: 'ຢືດຢຸ່ນ', start: '08:00', end: '17:00', breakStart: '12:00', breakEnd: '13:00', flexible: true, dailyHours: 8 };
const S = defaultSettings('c1');
const office = { ...employees.find(e => e.id === 'e-acc')!, shiftId: 'flex', startDate: '2026-10-01', dayOff: [0, 6] };
let n = 0;
const scan = (kind: ScanRecord['kind'], d: Date): ScanRecord => ({ id: 'f' + n++, companyId: 'c1', employeeId: office.id, kind, deviceTime: d.toISOString(), serverTime: d.toISOString(), branchId: branches[0].id, status: 'ok', reasons: [], offline: false });
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m);
const data = (scans: ScanRecord[], leaves: any[] = []) => ({ employees: [office], branches, scans, leaves, ots: [], advances: [], payrollRuns: [], requests: [], overrides: [], shifts: [...seedShifts, flex], notifications: [], payItems: [], settings: S }) as any;

describe('flexible shift basics', () => {
  it('reads as flexible hours in lists, not as clock times', () => {
    expect(shiftRange(flex)).toBe('ຢືດຢຸ່ນ 8 ຊມ');
    expect(shiftRange(seedShifts[0])).toBe('06:00–14:00');
  });
  it('paid hours come from the setting, not from the placeholder times', () => {
    expect(shiftPaidHours(flex)).toBe(8);
    expect(shiftPaidHours({ ...flex, dailyHours: 7.5 })).toBe(7.5);
    expect(shiftPaidHours({ ...flex, dailyHours: undefined })).toBe(8);
  });
  it('nobody is late: there is no start to be late for', () => {
    expect(lateStartFor(flex, [])).toBeNull();
    expect(lateStartFor(flex, [{ part: 'am', status: 'approved' }])).toBeNull();
    expect(dayStatus({ date: '2026-11-03', today: '2026-11-05', startDate: '2026-01-01', shiftStart: null, graceMinutes: 5, dayOff: [], holidays: [], leaves: [], scans: [{ kind: 'in', status: 'ok', deviceTime: at(3, 14).toISOString() }] })).toBe('ok');
    expect(dayStatus({ date: '2026-11-03', today: '2026-11-05', startDate: '2026-01-01', shiftStart: '08:00', graceMinutes: 5, dayOff: [], holidays: [], leaves: [], scans: [{ kind: 'in', status: 'ok', deviceTime: at(3, 14).toISOString() }] })).toBe('late');
  });
  it('the day ends at midnight for missed-clock-out purposes', () => {
    expect(closesAtFor('2026-11-03', flex)).toEqual(new Date('2026-11-03T23:59:59'));
  });
});

describe('validating a flexible shift', () => {
  const base = { id: 'x', name: 'ອອຟຟິດ', start: '08:00', end: '17:00', breakStart: '12:00', breakEnd: '13:00' };
  it('needs only sensible daily hours; the placeholder times are not checked', () => {
    expect(validateShifts([{ ...base, flexible: true, dailyHours: 8 }])).toEqual([]);
    expect(validateShifts([{ ...base, start: '', end: '', breakStart: '', breakEnd: '', flexible: true, dailyHours: 8 }])).toEqual([]);
    for (const dailyHours of [0, 0.5, 17, NaN, 7.3]) expect(validateShifts([{ ...base, flexible: true, dailyHours }]).join(), String(dailyHours)).toMatch('ຊົ່ວໂມງຕໍ່ມື້');
    expect(validateShifts([{ ...base, flexible: true, dailyHours: undefined }]).join()).toMatch('ຊົ່ວໂມງຕໍ່ມື້');
  });
  it('the same times are still checked for a fixed shift', () => expect(validateShifts([{ ...base, start: '25:00' }]).join()).toMatch('ເວລາບໍ່ຖືກຕ້ອງ'));
  it('a flexible shift still needs a name, a unique one, and a sane allowance', () => {
    expect(validateShifts([{ ...base, name: ' ', flexible: true, dailyHours: 8 }]).join()).toMatch('ຕ້ອງມີຊື່');
    expect(validateShifts([{ ...base, flexible: true, dailyHours: 8 }, { ...base, id: 'y', flexible: true, dailyHours: 8 }]).join()).toMatch('ຊ້ຳ');
    expect(validateShifts([{ ...base, flexible: true, dailyHours: 8, allowance: -5 }]).join()).toMatch('ເບ້ຍລ້ຽງ');
  });
  it('the default shifts offered to a new company include a valid flexible one', () => {
    expect(validateShifts(seedShifts)).toEqual([]);
    expect(seedShifts.some(s => s.flexible)).toBe(true);
  });
});

describe('part-day leave on flexible hours', () => {
  it('counts against the daily hours', () => {
    expect(partialDays('hours', 2, shiftPaidHours(flex))).toBe(0.25);
    expect(partialDays('am', undefined, shiftPaidHours(flex))).toBe(0.5);
  });
  it('hours must stay under the flexible day', () => {
    const ctx = { existing: [], paidHours: 8, weeklyOff: [0, 6], holidays: [], annualLeft: 10, compLeft: 0 };
    expect(leaveRequestBlock({ type: 'annual', from: '2026-11-04', to: '2026-11-04', days: 0.5, part: 'hours', hours: 4 }, ctx)).toBeNull();
    expect(leaveRequestBlock({ type: 'annual', from: '2026-11-04', to: '2026-11-04', days: 1, part: 'hours', hours: 8 }, ctx)).toMatch('ເຕັມວັນ');
    expect(leaveRequestBlock({ type: 'annual', from: '2026-11-07', to: '2026-11-07', days: 0.5, part: 'am' }, ctx)).toMatch('ວັນພັກ'); // Saturday off
  });
});

describe('an office employee through the app', () => {
  it('arriving at any hour is never late, in the report, the pay and the live views', () => {
    const scans = [scan('in', at(3, 10, 40)), scan('out', at(3, 18, 45)), scan('in', at(4, 7, 5)), scan('out', at(4, 15, 30))];
    const inp: ReportInput = { employees: [office], scans, leaves: [], ots: [], overrides: [], shifts: [...seedShifts, flex], branches, settings: S, year: 2026, month: 10, today: '2026-11-06' };
    const r = buildAttendance(inp);
    const d3 = r.days.find(d => d.date === '2026-11-03')!, d4 = r.days.find(d => d.date === '2026-11-04')!;
    expect(d3).toMatchObject({ status: 'ok', lateMin: 0, shiftTime: 'ຢືດຢຸ່ນ 8 ຊມ', in: '10:40', out: '18:45' });
    expect(d4).toMatchObject({ status: 'ok', lateMin: 0 });
    expect(r.summary[0].lateDays).toBe(0);
    expect(summarize(data(scans), office, '2026-11', true).lateMin).toBe(0);
    expect(lateStartOn(data(scans), office, '2026-11-03')).toBeNull();
  });
  it('weekly days off still apply: Saturday is a day off, a weekday is not', () => {
    const r = buildAttendance({ employees: [office], scans: [], leaves: [], ots: [], overrides: [], shifts: [...seedShifts, flex], branches, settings: S, year: 2026, month: 10, today: '2026-11-10' });
    const st = (d: string) => r.days.find(x => x.date === d)?.status;
    expect(st('2026-11-07')).toBe('dayoff'); // Saturday
    expect(st('2026-11-09')).toBe('absent'); // Monday, nobody came
  });
  it('a short day is noted but costs nothing; a full day is not noted', () => {
    const scans = [scan('in', at(3, 9)), scan('out', at(3, 13)), scan('in', at(4, 9)), scan('out', at(4, 17, 30))];
    const r = buildAttendance({ employees: [office], scans, leaves: [], ots: [], overrides: [], shifts: [...seedShifts, flex], branches, settings: S, year: 2026, month: 10, today: '2026-11-06' });
    expect(r.days.find(d => d.date === '2026-11-03')!.note).toMatch('ຕ່ຳກວ່າ 8 ຊມ');
    expect(r.days.find(d => d.date === '2026-11-04')!.note).not.toMatch('ຕ່ຳກວ່າ');
    expect(summarize(data(scans), office, '2026-11', true).slip.lateDeduction).toBe(0);
  });
  it('a forgotten clock-out is flagged only after the day is over, not at an arbitrary "shift end"', () => {
    const open = [scan('in', at(3, 10))];
    const run = (now: Date) => missedClockOutDates({ scans: open, from: '2026-11-01', to: '2026-11-10', now, closesAt: d => closesAtFor(d, flex) });
    expect(run(at(3, 19))).toEqual([]); // still a normal working evening for flexible hours
    expect(run(at(3, 23, 30))).toEqual([]);
    expect(run(at(4, 1, 0))).toEqual(['2026-11-03']);
    expect(missedDatesFor(data(open), office, at(4, 9))).toEqual(['2026-11-03']);
    expect(missedDatesFor(data(open), office, at(3, 15))).toEqual([]);
  });
  it('a morning-leave day is not late either', () => {
    const am = { id: 'l', companyId: 'c1', employeeId: office.id, type: 'annual', from: '2026-11-04', to: '2026-11-04', days: 0.5, part: 'am', reason: 'x', createdAt: '2026-11-01T09:00:00', approvals: [], status: 'approved' };
    expect(lateStartOn(data([], [am]), office, '2026-11-04')).toBeNull();
  });
});
