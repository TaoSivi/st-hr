import { describe, expect, it } from 'vitest';
import { ALL_RIGHTS, EDITABLE_ROLES, ROLE_RIGHTS, hasRight, permProblem, rightsOf, type RightKey } from './rights';
import { ACTION_ROLES, PAGE_ROLES, canDo, canDoIn, canViewPage, isManager, isReadOnly } from './permissions';
import type { Role } from './types';

const person = (roles: Role[], perm?: Partial<Record<RightKey, boolean>>, superAdmin?: boolean) => ({ roles: ['employee', ...roles] as Role[], perm, superAdmin });

describe('rights: defaults equal the old role tables', () => {
  it('every page and action a role had is a right it still has, and nothing more', () => {
    for (const role of ['head', 'accountant', 'auditor', 'owner'] as Role[]) {
      for (const [page, roles] of Object.entries(PAGE_ROLES)) expect(ROLE_RIGHTS[role].includes(`p.${page}` as RightKey)).toBe(roles.includes(role));
      for (const [action, roles] of Object.entries(ACTION_ROLES)) expect(ROLE_RIGHTS[role].includes(action as RightKey)).toBe(roles.includes(role));
    }
  });
  it('the plain employee has no back-office right', () => expect(ROLE_RIGHTS.employee).toEqual([]));
  it('the auditor can look at everything and change nothing', () => {
    expect(ROLE_RIGHTS.auditor).toContain('dataAll');
    expect(ROLE_RIGHTS.auditor).not.toContain('writeAll');
    expect(isReadOnly(person(['auditor']))).toBe(true);
  });
});

describe('rights: ticks on one person', () => {
  it('a tick on grants, a tick off takes away, nothing else changes', () => {
    const acc = person(['accountant'], { 'payroll.lock': false, 'p.map': true });
    expect(hasRight(acc, 'payroll.lock')).toBe(false);
    expect(hasRight(acc, 'payroll.prepare')).toBe(true);
    expect(hasRight(acc, 'p.map')).toBe(true);
  });
  it('the owner and the Super admin cannot be reduced', () => {
    expect(rightsOf(person(['owner'], { 'p.pay': false })).size).toBe(ALL_RIGHTS.length);
    expect(rightsOf(person([], { 'p.pay': false }, true)).size).toBe(ALL_RIGHTS.length);
  });
  it('the page and action checks honour the ticks', () => {
    const head = person(['head'], { 'p.pay': true, 'scan.review': false });
    expect(canViewPage(head, 'pay')).toBe(true);
    expect(canDoIn(head, 'scan.review')).toBe(false);
    expect(canDo(head, 'ot.preapprove')).toBe(true);
  });
  it('a plain employee with one page ticked opens the back office; without it they do not', () => {
    expect(isManager(person([]))).toBe(false);
    expect(isManager(person([], { 'p.reports': true }))).toBe(true);
  });
  it('unknown keys are ignored', () => {
    expect(rightsOf({ roles: ['employee'], perm: { nonsense: true } as never }).size).toBe(0);
  });
});

describe('rights: the Super admin changes a role for the whole company', () => {
  const s = { roleRights: { accountant: ['p.overview', 'p.staff', 'dataAll'] as RightKey[] } };
  it('replaces the default list for that role only', () => {
    expect(hasRight(person(['accountant']), 'p.pay', s)).toBe(false);
    expect(hasRight(person(['accountant']), 'p.staff', s)).toBe(true);
    expect(hasRight(person(['head']), 'p.review', s)).toBe(true);
  });
  it('a person tick still wins over the role', () => {
    expect(hasRight(person(['accountant'], { 'p.pay': true }), 'p.pay', s)).toBe(true);
  });
  it('the owner role is not editable', () => expect(EDITABLE_ROLES).not.toContain('owner'));
});

describe('rights: who may give which tick', () => {
  it('cannot give a right you do not have', () => {
    const acc = person(['accountant']);
    expect(permProblem({ 'p.audit': true }, acc)).not.toBeNull();
    expect(permProblem({ 'p.pay': true }, acc)).toBeNull();
    expect(permProblem({ 'p.audit': false }, acc)).toBeNull(); // taking away is always allowed
  });
  it('rejects unknown keys and non-boolean values', () => {
    expect(permProblem({ nope: true } as never, person(['owner']))).not.toBeNull();
    expect(permProblem({ 'p.pay': 1 } as never, person(['owner']))).not.toBeNull();
  });
});
