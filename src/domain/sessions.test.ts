import { describe, expect, it } from 'vitest';
import { actionsNow, activeSession, scansOn, SESSION_TAIL_MIN, toSessions, type SessionScan } from './sessions';
import { closesAtFor, missedClockOutDates } from './missedOut';
import { validateShifts } from './settingsCheck';
import { buildAttendance, type ReportInput } from './attendanceReport';
import { defaultSettings } from './defaults';
import { branches, employees, shifts as seedShifts } from '../data/seed';
import type { Shift, ScanRecord } from './types';

const night = { start: '22:00', end: '06:00' };
const day = { start: '06:00', end: '14:00' };
const d = (m: number, dd: number, h: number, mi = 0) => new Date(2026, m - 1, dd, h, mi);
const sc = (kind: SessionScan['kind'], when: Date, status: SessionScan['status'] = 'ok'): SessionScan => ({ kind, status, deviceTime: when.toISOString() });
const nightCloses = (date: string) => closesAtFor(date, night);

describe('closesAtFor', () => {
  it('a day shift closes the same day, a night shift the next day, no shift at the end of the day', () => {
    expect(closesAtFor('2026-11-02', day)).toEqual(d(11, 2, 14));
    expect(closesAtFor('2026-11-02', night)).toEqual(d(11, 3, 6));
    expect(closesAtFor('2026-11-30', night)).toEqual(d(12, 1, 6)); // across a month end
    expect(closesAtFor('2026-12-31', night)).toEqual(new Date(2027, 0, 1, 6)); // ...and a year end
    expect(closesAtFor('2026-11-02').getHours()).toBe(23);
  });
});

describe('toSessions', () => {
  it('a night shift is one session of the day it started, even though the out is after midnight', () => {
    const ss = toSessions([sc('in', d(11, 2, 21, 55)), sc('breakStart', d(11, 3, 2)), sc('breakEnd', d(11, 3, 2, 30)), sc('out', d(11, 3, 6, 5))], nightCloses);
    expect(ss).toHaveLength(1);
    expect(ss[0]).toMatchObject({ workDate: '2026-11-02', closed: true });
    expect(ss[0].scans.map(s => s.kind)).toEqual(['in', 'breakStart', 'breakEnd', 'out']);
  });
  it('the next night is a separate session', () => {
    const ss = toSessions([sc('in', d(11, 2, 22)), sc('out', d(11, 3, 6)), sc('in', d(11, 3, 22)), sc('out', d(11, 4, 6))], nightCloses);
    expect(ss.map(s => s.workDate)).toEqual(['2026-11-02', '2026-11-03']);
  });
  it('a clock-out after the allowed tail does not join the session: it stands alone on its own day', () => {
    const late = new Date(d(11, 3, 6).getTime() + (SESSION_TAIL_MIN + 1) * 60000);
    const ss = toSessions([sc('in', d(11, 2, 22)), sc('out', late)], nightCloses);
    expect(ss).toHaveLength(2);
    expect(ss[0]).toMatchObject({ workDate: '2026-11-02', closed: false });
    expect(ss[1]).toMatchObject({ workDate: '2026-11-03', closed: true });
  });
  it('the tail covers overtime: a day-shift clock-out up to 4 h late still closes that day', () => {
    expect(toSessions([sc('in', d(11, 2, 6)), sc('out', d(11, 2, 18))], date => closesAtFor(date, day))[0].closed).toBe(true);
    expect(toSessions([sc('in', d(11, 2, 6)), sc('out', d(11, 2, 18, 1))], date => closesAtFor(date, day))[0].closed).toBe(false);
  });
  it('a new clock-in always starts a new session, leaving the forgotten one open', () => {
    const ss = toSessions([sc('in', d(11, 2, 6)), sc('in', d(11, 3, 6)), sc('out', d(11, 3, 14))], date => closesAtFor(date, day));
    expect(ss.map(s => [s.workDate, s.closed])).toEqual([['2026-11-02', false], ['2026-11-03', true]]);
  });
  it('rejected scans are ignored, and input order does not matter', () => {
    const ss = toSessions([sc('out', d(11, 3, 6)), sc('in', d(11, 2, 22)), sc('out', d(11, 2, 23), 'rejected')], nightCloses);
    expect(ss).toHaveLength(1);
    expect(ss[0].scans.map(s => s.kind)).toEqual(['in', 'out']);
  });
  it('scansOn returns the scans of that work date only', () => {
    const ss = toSessions([sc('in', d(11, 2, 22)), sc('out', d(11, 3, 6)), sc('in', d(11, 3, 22))], nightCloses);
    expect(scansOn(ss, '2026-11-02').map(s => s.kind)).toEqual(['in', 'out']);
    expect(scansOn(ss, '2026-11-03').map(s => s.kind)).toEqual(['in']);
    expect(scansOn(ss, '2026-11-04')).toEqual([]);
  });
});

describe('what the buttons allow, right now', () => {
  const scans = [sc('in', d(11, 2, 22))];
  it('after midnight the night-shift worker can still take a break or clock out, but not clock in again', () => {
    const a = actionsNow(scans, d(11, 3, 3), nightCloses);
    expect(a).toEqual({ in: false, breakStart: true, breakEnd: false, out: true });
  });
  it('once the session is closed, only a new clock-in is possible', () => {
    expect(actionsNow([...scans, sc('out', d(11, 3, 6))], d(11, 3, 7), nightCloses)).toEqual({ in: true, breakStart: false, breakEnd: false, out: false });
  });
  it('a forgotten session does not lock the next shift: far past its tail the person can clock in', () => {
    expect(actionsNow([sc('in', d(11, 2, 6))], d(11, 3, 6), date => closesAtFor(date, day)).in).toBe(true);
    expect(actionsNow([sc('in', d(11, 2, 6))], d(11, 3, 6), date => closesAtFor(date, day)).out).toBe(false);
  });
  it('an evening shift forgotten overnight does not block the 06:00 clock-in', () => {
    const evening = { start: '14:00', end: '22:00' };
    expect(actionsNow([sc('in', d(11, 2, 14))], d(11, 3, 5, 30), date => closesAtFor(date, evening)).in).toBe(true);
  });
  it('nothing yet today: clock in only', () => expect(actionsNow([], d(11, 2, 8), nightCloses)).toEqual({ in: true, breakStart: false, breakEnd: false, out: false }));
  it('activeSession is null when the only session is closed', () => expect(activeSession(toSessions([sc('in', d(11, 2, 22)), sc('out', d(11, 3, 6))], nightCloses), d(11, 3, 7), nightCloses)).toBeNull());
});

describe('forgotten clock-out on a night shift', () => {
  const run = (scans: SessionScan[], now: Date) => missedClockOutDates({ scans, from: '2026-11-01', to: '2026-11-10', now, closesAt: nightCloses });
  it('a clock-out after midnight is not a missed day', () => {
    expect(run([sc('in', d(11, 2, 22)), sc('out', d(11, 3, 6))], d(11, 4, 12))).toEqual([]);
  });
  it('not missed while the shift is still running, even though the calendar day has changed', () => {
    expect(run([sc('in', d(11, 2, 22))], d(11, 3, 3))).toEqual([]);
    expect(run([sc('in', d(11, 2, 22))], d(11, 3, 6, 59))).toEqual([]);
  });
  it('missed one hour after the shift ends, and reported on the day it started', () => {
    expect(run([sc('in', d(11, 2, 22))], d(11, 3, 7))).toEqual(['2026-11-02']);
  });
});

describe('validateShifts with night shifts', () => {
  const ok = { id: 'n', name: 'ກະກາງຄືນ', start: '22:00', end: '06:00', breakStart: '01:00', breakEnd: '01:30' };
  it('accepts an overnight shift with the break after midnight', () => expect(validateShifts([ok])).toEqual([]));
  it('accepts an overnight shift with the break before midnight', () => expect(validateShifts([{ ...ok, breakStart: '23:00', breakEnd: '23:30' }])).toEqual([]));
  it('refuses a break outside the night shift', () => {
    expect(validateShifts([{ ...ok, breakStart: '12:00', breakEnd: '12:30' }]).join()).toMatch('ເວລາພັກ');
    expect(validateShifts([{ ...ok, breakStart: '05:50', breakEnd: '06:30' }]).join()).toMatch('ເວລາພັກ');
    expect(validateShifts([{ ...ok, breakStart: '01:30', breakEnd: '01:00' }]).join()).toMatch('ເວລາພັກ');
  });
  it('refuses a zero-length shift and one longer than 16 hours', () => {
    expect(validateShifts([{ ...ok, end: '22:00' }]).join()).toMatch('ບໍ່ເທົ່າກັນ');
    expect(validateShifts([{ ...ok, start: '06:00', end: '23:00', breakStart: '10:00', breakEnd: '10:30' }]).join()).toMatch('16');
    expect(validateShifts([{ ...ok, start: '06:00', end: '22:00', breakStart: '10:00', breakEnd: '10:30' }])).toEqual([]); // exactly 16 h is allowed
  });
  it('a day shift is unchanged', () => expect(validateShifts([{ id: 'm', name: 'ເຊົ້າ', start: '06:00', end: '14:00', breakStart: '10:00', breakEnd: '10:30' }])).toEqual([]));
});

describe('night shift in the attendance report', () => {
  const nightShift: Shift = { id: 'night', companyId: 'c1', name: 'ກາງຄືນ', start: '22:00', end: '06:00', breakStart: '01:00', breakEnd: '01:30' } as Shift;
  const e = { ...employees.find(x => x.id === 'e-kl')!, shiftId: 'night', startDate: '2026-10-01', dayOff: [0] };
  let n = 0;
  const scan = (kind: ScanRecord['kind'], when: Date): ScanRecord => ({ id: 'n' + n++, companyId: 'c1', employeeId: e.id, kind, deviceTime: when.toISOString(), serverTime: when.toISOString(), branchId: branches[0].id, status: 'ok', reasons: [], offline: false });
  const input = (scans: ScanRecord[], over: Partial<ReportInput> = {}): ReportInput => ({ employees: [e], scans, leaves: [], ots: [], overrides: [], shifts: [...seedShifts, nightShift], branches, settings: defaultSettings('c1'), year: 2026, month: 10, today: '2026-11-06', ...over });
  const row = (r: ReturnType<typeof buildAttendance>, date: string) => r.days.find(x => x.date === date)!;

  it('Mon night 22:05 → Tue 06:10 is one worked day on Monday, hours across midnight, out marked +1', () => {
    const r = buildAttendance(input([scan('in', d(11, 2, 22, 5)), scan('breakStart', d(11, 3, 1)), scan('breakEnd', d(11, 3, 1, 30)), scan('out', d(11, 3, 6, 10))]));
    expect(row(r, '2026-11-02')).toMatchObject({ in: '22:05', out: '06:10 (+1)', workedMin: 485 - 30, status: 'ok', shiftTime: '22:00–06:00' });
    expect(row(r, '2026-11-02').note).not.toMatch('ລືມ');
  });
  it('Tuesday is not made absent or given a stray row by the after-midnight scans', () => {
    const r = buildAttendance(input([scan('in', d(11, 2, 22)), scan('out', d(11, 3, 6)), scan('in', d(11, 3, 22)), scan('out', d(11, 4, 6))]));
    expect(row(r, '2026-11-03')).toMatchObject({ in: '22:00', out: '06:00 (+1)', status: 'ok' });
    expect(r.summary[0].workedDays).toBe(2 + 0); // Nov 2 and Nov 3; the days with no scans are absent, not worked
    expect(row(r, '2026-11-04').status).toBe('absent');
  });
  it('lateness is measured against 22:00 on the day the shift began', () => {
    const r = buildAttendance(input([scan('in', d(11, 2, 22, 20)), scan('out', d(11, 3, 6))]));
    expect(row(r, '2026-11-02')).toMatchObject({ lateMin: 20, status: 'late' });
  });
  it('an unclosed night session is flagged only after the shift ended, and on the start date', () => {
    const open = [scan('in', d(11, 5, 22))];
    const during = buildAttendance(input(open, { today: '2026-11-06', now: d(11, 6, 5) }));
    expect(row(during, '2026-11-05').note).not.toMatch('ລືມ');
    const after = buildAttendance(input(open, { today: '2026-11-06', now: d(11, 6, 8) }));
    expect(row(after, '2026-11-05').note).toMatch('ລືມ');
    expect(after.summary[0].missedOutDays).toBe(1);
  });
});
