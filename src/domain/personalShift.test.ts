import { describe, expect, it } from 'vitest';
import { bulkTargets, makePersonalShift, personalShiftId, personalShiftProblems, sharedShifts, shiftDeleteBlock, shiftsFor } from './personalShift';
import type { HRRequest } from './requests';
import { lateStartFor } from './leavePart';
import { employees, shifts } from '../data/seed';
import type { Employee } from './types';

const kl = employees.find(e => e.id === 'e-kl')!;
const mine = makePersonalShift(kl, { start: '09:30', end: '18:30', breakStart: '12:30', breakEnd: '13:30' });

describe('hours for one person', () => {
  it('are a shift that belongs to that person', () => {
    expect(mine).toMatchObject({ id: personalShiftId(kl.id), personal: kl.id, start: '09:30', name: `ສະເພາະ ${kl.code}` });
  });
  it('stay out of the shared lists, but the person sees their own', () => {
    const all = [...shifts, mine, makePersonalShift({ id: 'x', code: 'ST-099' }, { start: '07:00', end: '15:00', breakStart: '11:00', breakEnd: '12:00' })];
    expect(sharedShifts(all)).toEqual(shifts);
    expect(shiftsFor(all, kl.id).map(s => s.id)).toEqual([...shifts.map(s => s.id), mine.id]);
  });
  it('count lateness from the person\'s own start', () => {
    expect(lateStartFor(mine, [])).toBe('09:30');
  });
  it('are checked like any shift: bad times, overnight, flexible', () => {
    expect(personalShiftProblems(mine, shifts)).toEqual([]);
    expect(personalShiftProblems({ ...mine, start: '25:00' }, shifts).join()).toMatch('ເວລາບໍ່ຖືກຕ້ອງ');
    expect(personalShiftProblems({ ...mine, start: '22:00', end: '06:00', breakStart: '01:00', breakEnd: '01:30' }, shifts)).toEqual([]);
    expect(personalShiftProblems({ ...mine, flexible: true, dailyHours: 8 }, shifts)).toEqual([]);
  });
  it('changing them again replaces the old ones instead of clashing with them', () => {
    expect(personalShiftProblems({ ...mine, start: '10:00' }, [...shifts, mine])).toEqual([]);
  });
});

describe('the same hours for everyone', () => {
  const left: Employee = { ...kl, id: 'gone', endDate: '2026-10-31' };
  it('moves only people still working, in one department or all', () => {
    const all = [...employees, left];
    expect(bulkTargets(all, '*', '2026-11-03').some(e => e.id === 'gone')).toBe(false);
    expect(bulkTargets(all, '*', '2026-11-03').length).toBe(employees.filter(e => !e.endDate || e.endDate >= '2026-11-03').length);
    expect(bulkTargets(all, kl.dept, '2026-11-03').every(e => e.dept === kl.dept)).toBe(true);
  });
});

describe('deleting a shared shift', () => {
  const extra = { id: 'x1', name: '455', start: '22:00', end: '06:00', breakStart: '01:00', breakEnd: '01:30' };
  const all = [...shifts, extra];
  const ctx = (over: Partial<Parameters<typeof shiftDeleteBlock>[1]> = {}) => ({ shifts: all, employees: employees.filter(e => e.shiftId !== 'x1'), overrides: [], requests: [], ...over });
  it('an unused shift can go', () => expect(shiftDeleteBlock(extra, ctx())).toBeNull());
  it('not while people use it, and it says how many', () => {
    const users = [{ shiftId: 'x1' }, { shiftId: 'x1' }];
    expect(shiftDeleteBlock(extra, ctx({ employees: users }))).toMatch('ມີ 2 ຄົນ');
  });
  it('not while a booked schedule change or a waiting request points at it', () => {
    expect(shiftDeleteBlock(extra, ctx({ overrides: [{ shiftId: 'x1' }] }))).toMatch('ການປ່ຽນຕາຕະລາງ 1');
    const waiting = { id: 'r', companyId: 'c', kind: 'schedule', employeeId: 'e', payload: { dates: ['2026-11-10'], shiftId: 'x1' }, reason: 'x', createdAt: '2026-11-02T09:00:00', approvals: [], status: 'pending' } as HRRequest;
    expect(shiftDeleteBlock(extra, ctx({ requests: [waiting] }))).toMatch('ລໍອະນຸມັດ');
    expect(shiftDeleteBlock(extra, ctx({ requests: [{ ...waiting, status: 'rejected' }] }))).toBeNull(); // a finished request no longer needs it
  });
  it('the last shared shift stays, and one person\'s own hours are not deleted this way', () => {
    expect(shiftDeleteBlock(extra, ctx({ shifts: [extra] }))).toMatch('ຢ່າງໜ້ອຍ 1 ກະ');
    expect(shiftDeleteBlock(mine, ctx({ shifts: [...all, mine] }))).toMatch('ສະເພາະຄົນ');
  });
});
