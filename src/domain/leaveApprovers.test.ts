import { describe, expect, it } from 'vitest';
import { capBalance, leaveApprovers, usedInYear } from './leave';
import type { Employee, LeaveRequest } from './types';

const emp = (id: string, dept: string, roles: Employee['roles'], over: Partial<Employee> = {}) => ({ id, name: id, dept, roles, ...over }) as Employee;
const S = { leaveApproverRoles: ['head', 'owner'] as Employee['roles'] };
const people = [
  emp('staff', 'ຄົວ', ['employee']),
  emp('headKitchen', 'ຄົວ', ['employee', 'head']),
  emp('headFront', 'ໜ້າຮ້ານ', ['employee', 'head']),
  emp('boss', 'ບໍລິຫານ', ['employee', 'owner']),
  emp('gone', 'ຄົວ', ['employee', 'head'], { endDate: '2026-01-01' }),
  emp('acct', 'ບັນຊີ', ['employee', 'accountant'])
];

describe('who a leave request can be sent to', () => {
  it('the head of the department first, then the owner; never another department head, a leaver, or someone without the right', () => {
    expect(leaveApprovers(people, S, 'staff').map(e => e.id)).toEqual(['headKitchen', 'boss']);
  });
  it('a head asking is not offered themself, only the owner', () => {
    expect(leaveApprovers(people, S, 'headKitchen').map(e => e.id)).toEqual(['boss']);
  });
  it('a head who manages several departments is offered for all of them', () => {
    const multi = [...people, emp('area', 'ບໍລິຫານ', ['employee', 'head'], { headOf: ['ຄົວ', 'ໜ້າຮ້ານ'] })];
    expect(leaveApprovers(multi, S, 'staff').map(e => e.id)).toContain('area');
  });
  it('follows the roles Settings allows', () => {
    expect(leaveApprovers(people, { leaveApproverRoles: ['accountant', 'owner'] }, 'staff').map(e => e.id).sort()).toEqual(['acct', 'boss']);
  });
  it('an unknown person has nobody', () => expect(leaveApprovers(people, S, 'nobody')).toEqual([]));
});

const NONE = { sickDaysPerYear: 0, personalDaysPerYear: 0, specialDaysPerYear: 0, unpaidDaysPerYear: 0 };

describe('sick and personal leave left this year', () => {
  const l = (over: Partial<LeaveRequest>): LeaveRequest => ({ id: Math.random().toString(), companyId: 'c', employeeId: 'e1', type: 'sick', from: '2026-03-02', to: '2026-03-03', days: 2, reason: '', createdAt: '', approvals: [], status: 'approved', ...over });
  const leaves = [l({}), l({ status: 'pending', days: 1 }), l({ status: 'rejected', days: 9 }), l({ from: '2025-12-30', days: 5 }), l({ employeeId: 'e2', days: 7 }), l({ type: 'personal', days: 1 })];
  it('counts approved and waiting days of that kind, this year, this person', () => expect(usedInYear(leaves, 'e1', 'sick', 2026)).toBe(3));
  it('with an allowance it shows what is left; without, it is unlimited', () => {
    expect(capBalance('sick', leaves, 'e1', 2026, { ...NONE, sickDaysPerYear: 30 })).toEqual({ type: 'sick', quota: 30, used: 3, left: 27 });
    expect(capBalance('sick', leaves, 'e1', 2026, NONE)).toEqual({ type: 'sick', quota: null, used: 3, left: null });
    expect(capBalance('personal', leaves, 'e1', 2026, { ...NONE, personalDaysPerYear: 3 }).left).toBe(2);
  });
  it('special and unpaid leave have their own allowances (0 = no limit)', () => {
    const rows = [l({ type: 'special', days: 6 }), l({ type: 'unpaid', days: 4 })];
    expect(capBalance('special', rows, 'e1', 2026, { ...NONE, specialDaysPerYear: 30 })).toMatchObject({ quota: 30, used: 6, left: 24 });
    expect(capBalance('unpaid', rows, 'e1', 2026, { ...NONE, unpaidDaysPerYear: 30 })).toMatchObject({ quota: 30, used: 4, left: 26 });
    expect(capBalance('unpaid', rows, 'e1', 2026, NONE)).toMatchObject({ quota: null, used: 4, left: null });
  });
});
