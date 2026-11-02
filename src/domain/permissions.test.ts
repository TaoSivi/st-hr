import { describe, it, expect } from 'vitest';
import { defaultSettings } from './defaults';
import {
  ACTION_ROLES, APPROVAL_SECTIONS, PAGE_ROLES, SECTION_KINDS, approvalAccess, canDo, canViewPage, isManager, isReadOnly,
  type Access, type Action, type ApprovalSection, type ManagerPage
} from './permissions';
import { REQUEST_LABEL, requestBlock, type HRRequest, type RequestKind } from './requests';
import { approvalBlock } from './leave';
import type { LeaveRequest, Role } from './types';

const S = defaultSettings('c1');
const NOW = new Date('2026-11-02T10:00:00');
// column order of every table below
const ROLES = ['employee', 'head', 'accountant', 'owner', 'auditor'] as const;
const rolesOf = (r: (typeof ROLES)[number]): Role[] => (r === 'employee' ? ['employee'] : ['employee', r]);
const col = <T,>(row: T[]) => Object.fromEntries(ROLES.map((r, i) => [r, row[i]])) as Record<(typeof ROLES)[number], T>;

// ---- the specification, written independently of permissions.ts: [employee, head, accountant, owner, auditor] ----
const PAGES_SPEC: Record<ManagerPage, boolean[]> = {
  overview: [false, true, true, true, true],
  review: [false, true, false, true, true],
  approvals: [false, true, true, true, true],
  time: [false, true, true, true, true],
  reports: [false, true, true, true, true],
  map: [false, true, false, true, true],
  leave: [false, true, false, true, true],
  staff: [false, false, true, true, true],
  pay: [false, false, true, true, true],
  settings: [false, false, false, true, true],
  audit: [false, false, false, true, true]
};
const ACTIONS_SPEC: Record<Action, boolean[]> = {
  'scan.review': [false, true, false, true, false],
  'ot.preapprove': [false, true, false, true, false],
  'advance.decide': [false, true, false, true, false],
  'staff.edit': [false, false, true, true, false],
  'staff.change.decide': [false, false, true, true, false],
  'payroll.prepare': [false, false, true, true, false],
  'payroll.lock': [false, false, true, true, false],
  'payroll.confirmLate': [false, false, true, true, false],
  'settings.edit': [false, false, false, true, false]
};
const A: Access[] = ['act'], V: Access[] = ['view'], N: Access[] = ['none'];
const SECTIONS_SPEC: Record<ApprovalSection, Access[]> = {
  scan: [...N, ...A, ...N, ...A, ...V],
  leave: [...N, ...A, ...N, ...A, ...V],
  shift: [...N, ...A, ...N, ...A, ...V],
  schedule: [...N, ...A, ...N, ...A, ...V],
  ot: [...N, ...A, ...N, ...A, ...V],
  expense: [...N, ...A, ...A, ...A, ...V], // accountants reimburse expenses
  certificate: [...N, ...N, ...N, ...A, ...V], // only the owner signs certificates
  leaveCancel: [...N, ...A, ...N, ...A, ...V]
};
const KIND_APPROVERS: Record<RequestKind, boolean[]> = {
  clockFix: [false, true, false, true, false],
  ot: [false, true, false, true, false],
  shiftSwap: [false, true, false, true, false],
  dayOffSwap: [false, true, false, true, false],
  schedule: [false, true, false, true, false],
  expense: [false, true, true, true, false],
  certificate: [false, false, false, true, false],
  leaveCancel: [false, true, false, true, false]
};

describe('page visibility, every role × every back-office page', () => {
  for (const [page, row] of Object.entries(PAGES_SPEC) as [ManagerPage, boolean[]][]) {
    it(`${page}`, () => {
      for (const r of ROLES) expect(canViewPage(rolesOf(r), page, S), `${r} → ${page}`).toBe(col(row)[r]);
    });
  }
  it('the spec covers every page and the code has no extra ones', () => {
    expect(Object.keys(PAGES_SPEC).sort()).toEqual(Object.keys(PAGE_ROLES).sort());
  });
  it('a plain employee sees no back-office page at all, and is not a manager', () => {
    for (const p of Object.keys(PAGE_ROLES) as ManagerPage[]) expect(canViewPage(['employee'], p, S)).toBe(false);
    expect(isManager(['employee'])).toBe(false);
    for (const r of ['head', 'accountant', 'owner', 'auditor'] as const) expect(isManager(rolesOf(r))).toBe(true);
  });
});

describe('actions, every role × every write action', () => {
  for (const [action, row] of Object.entries(ACTIONS_SPEC) as [Action, boolean[]][]) {
    it(`${action}`, () => {
      for (const r of ROLES) expect(canDo(rolesOf(r), action), `${r} → ${action}`).toBe(col(row)[r]);
    });
  }
  it('the spec covers every action', () => {
    expect(Object.keys(ACTIONS_SPEC).sort()).toEqual(Object.keys(ACTION_ROLES).sort());
  });
  it('INVARIANT: an auditor or a plain employee can never perform a write action', () => {
    for (const a of Object.keys(ACTION_ROLES) as Action[]) {
      expect(canDo(['auditor'], a), a).toBe(false);
      expect(canDo(['employee'], a), a).toBe(false);
      expect(canDo(['employee', 'auditor'], a), a).toBe(false);
    }
  });
  it('INVARIANT: only the owner changes settings; nobody else even with several roles', () => {
    for (const roles of [['head'], ['accountant'], ['head', 'accountant'], ['auditor', 'head', 'accountant']] as Role[][]) {
      expect(canDo(roles, 'settings.edit')).toBe(false);
    }
    expect(canDo(['owner'], 'settings.edit')).toBe(true);
  });
  it('read-only mode is for the auditor alone, any other role cancels it', () => {
    expect(isReadOnly(['employee', 'auditor'])).toBe(true);
    expect(isReadOnly(['auditor', 'head'])).toBe(false);
    expect(isReadOnly(['auditor', 'accountant'])).toBe(false);
    expect(isReadOnly(['auditor', 'owner'])).toBe(false);
    expect(isReadOnly(['employee'])).toBe(false);
  });
});

describe('approval sections, every role × every section (default settings)', () => {
  for (const [sec, row] of Object.entries(SECTIONS_SPEC) as [ApprovalSection, Access[]][]) {
    it(`${sec}`, () => {
      for (const r of ROLES) expect(approvalAccess(rolesOf(r), sec, S), `${r} → ${sec}`).toBe(col(row)[r]);
    });
  }
  it('every approval section is covered', () => {
    expect(Object.keys(SECTIONS_SPEC).sort()).toEqual([...APPROVAL_SECTIONS].sort());
  });
  it('INVARIANT: the auditor can look at everything and decide nothing', () => {
    for (const s of APPROVAL_SECTIONS) expect(approvalAccess(['employee', 'auditor'], s, S)).toBe('view');
  });
});

describe('request approval, every role × every request kind', () => {
  const req = (kind: RequestKind, employeeId = 'someone', payload: any = {}): HRRequest => ({
    id: 'r1', companyId: 'c1', kind, employeeId, payload, reason: 'x', createdAt: '2026-11-02T09:00:00', approvals: [], status: 'pending'
  });
  for (const [kind, row] of Object.entries(KIND_APPROVERS) as [RequestKind, boolean[]][]) {
    it(`${kind}`, () => {
      for (const r of ROLES) {
        const block = requestBlock(req(kind), { id: 'u-' + r, roles: rolesOf(r) }, S, NOW);
        expect(block === null, `${r} → ${kind} (${block})`).toBe(col(row)[r]);
      }
    });
  }
  it('every request kind belongs to exactly one approval section, so none is orphaned in the UI', () => {
    const kinds = Object.keys(REQUEST_LABEL).sort();
    const inSections = Object.values(SECTION_KINDS).flat().sort();
    expect(inSections).toEqual(kinds);
  });
  it('INVARIANT: whoever the request engine lets approve also has "act" access to that section', () => {
    for (const sec of APPROVAL_SECTIONS) for (const kind of SECTION_KINDS[sec]) for (const r of ROLES) {
      if (requestBlock(req(kind), { id: 'u', roles: rolesOf(r) }, S, NOW) === null) {
        expect(approvalAccess(rolesOf(r), sec, S), `${r} ${kind}`).toBe('act');
      }
    }
  });
  it('nobody approves their own request, whatever their role', () => {
    for (const kind of Object.keys(KIND_APPROVERS) as RequestKind[]) for (const r of ['head', 'accountant', 'owner'] as const) {
      expect(requestBlock(req(kind, 'me'), { id: 'me', roles: rolesOf(r) }, S, NOW), `${r} ${kind}`).toMatch('ຕົນເອງ');
    }
  });
  it('the swap partner cannot approve the swap, even as head', () => {
    const r = req('shiftSwap', 'a', { date: '2026-11-03', withEmployeeId: 'h' });
    expect(requestBlock(r, { id: 'h', roles: ['head'] }, S, NOW)).toMatch('ຄູ່ສະລັບ');
    expect(requestBlock(r, { id: 'h2', roles: ['head'] }, S, NOW)).toBeNull();
  });
  it('after the escalation window only the owner gains extra reach, nobody else', () => {
    const late = new Date('2026-11-04T10:00:00');
    for (const kind of Object.keys(KIND_APPROVERS) as RequestKind[]) {
      for (const r of ROLES) {
        const now = requestBlock(req(kind), { id: 'u', roles: rolesOf(r) }, S, NOW) === null;
        const later = requestBlock(req(kind), { id: 'u', roles: rolesOf(r) }, S, late) === null;
        expect(later, `${r} ${kind}`).toBe(r === 'owner' ? true : now);
      }
    }
  });
  it('a decided request cannot be decided again by anyone', () => {
    for (const status of ['approved', 'rejected'] as const) {
      expect({ ...req('ot'), status }.status).not.toBe('pending');
      expect(requestBlock({ ...req('ot'), status }, { id: 'o', roles: ['owner'] }, S, NOW)).toMatch('ຕັດສິນແລ້ວ');
    }
  });
});

describe('leave approval follows the Settings roles', () => {
  const leave: LeaveRequest = { id: 'l1', companyId: 'c1', employeeId: 'e1', type: 'annual', from: '2026-11-04', to: '2026-11-05', days: 2,
    reason: 'x', createdAt: '2026-11-02T09:00:00', approvals: [], status: 'pending' };
  const can = (roles: Role[], s = S, now = NOW) => approvalBlock(leave, { id: 'u', roles }, s, now) === null;

  it('default: head and owner only', () => {
    expect(can(['head'])).toBe(true);
    expect(can(['owner'])).toBe(true);
    expect(can(['accountant'])).toBe(false);
    expect(can(['auditor'])).toBe(false);
    expect(can(['employee'])).toBe(false);
  });
  it('Admin makes the accountant an approver → accountant can, the head no longer can', () => {
    const s = { ...S, leaveApproverRoles: ['accountant' as const] };
    expect(can(['accountant'], s)).toBe(true);
    expect(can(['head'], s)).toBe(false);
    expect(approvalAccess(['accountant'], 'leave', s)).toBe('act');
    expect(approvalAccess(['head'], 'leave', s)).toBe('none');
  });
  it('…and the accountant then also gets the leave page in the back office', () => {
    const s = { ...S, leaveApproverRoles: ['accountant' as const] };
    expect(canViewPage(['employee', 'accountant'], 'leave', S)).toBe(false);
    expect(canViewPage(['employee', 'accountant'], 'leave', s)).toBe(true);
    expect(canViewPage(['employee', 'head'], 'leave', s)).toBe(true); // heads keep the static page role
  });
  it('the owner can always rescue a stuck request after the escalation window', () => {
    const s = { ...S, leaveApproverRoles: ['accountant' as const] };
    expect(can(['owner'], s, NOW)).toBe(false); // not yet, per Settings
    expect(can(['owner'], s, new Date('2026-11-03T10:00:00'))).toBe(true);
  });
});
