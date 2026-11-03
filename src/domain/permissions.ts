import type { Role, Settings } from './types';
import { APPROVER_ROLES, type RequestKind } from './requests';

/** Single source of truth for who may see and do what. UI and tests both read this. */

export type ManagerPage = 'overview' | 'review' | 'approvals' | 'time' | 'reports' | 'map' | 'leave' | 'staff' | 'pay' | 'settings' | 'audit';

export const PAGE_ROLES: Record<ManagerPage, Role[]> = {
  overview: ['head', 'accountant', 'owner', 'auditor'],
  review: ['head', 'owner', 'auditor'],
  approvals: ['head', 'owner', 'accountant', 'auditor'],
  time: ['head', 'owner', 'accountant', 'auditor'],
  reports: ['head', 'owner', 'accountant', 'auditor'],
  map: ['head', 'owner', 'auditor'],
  leave: ['head', 'owner', 'auditor'],
  staff: ['owner', 'accountant', 'auditor'],
  pay: ['owner', 'accountant', 'auditor'],
  settings: ['owner', 'auditor'],
  audit: ['owner', 'auditor']
};

export type Action =
  | 'scan.review' | 'ot.preapprove' | 'advance.decide'
  | 'staff.edit' | 'staff.change.decide'
  | 'payroll.prepare' | 'payroll.lock' | 'payroll.confirmLate' | 'payroll.items' | 'payroll.items.decide'
  | 'settings.edit';

/** Every write-type action. The auditor and the plain employee must never appear here. */
export const ACTION_ROLES: Record<Action, Role[]> = {
  'scan.review': ['head', 'owner'],
  'ot.preapprove': ['head', 'owner'],
  'advance.decide': ['head', 'owner'],
  'staff.edit': ['owner', 'accountant'],
  'staff.change.decide': ['owner', 'accountant'],
  'payroll.prepare': ['owner', 'accountant'],
  'payroll.lock': ['owner', 'accountant'],
  'payroll.confirmLate': ['owner', 'accountant'],
  'payroll.items': ['owner', 'accountant'],
  'payroll.items.decide': ['owner', 'accountant'],
  'settings.edit': ['owner']
};

const intersects = (a: Role[], b: Role[]) => a.some(r => b.includes(r));

/** The leave page also opens for whoever Admin made a leave approver in Settings. */
export const canViewPage = (roles: Role[], page: ManagerPage, s?: Pick<Settings, 'leaveApproverRoles'>) =>
  intersects(roles, PAGE_ROLES[page]) || (page === 'leave' && !!s && intersects(roles, s.leaveApproverRoles));
export const canDo = (roles: Role[], action: Action) => intersects(roles, ACTION_ROLES[action]);
/** True for someone who can look at the back office but change nothing in it. */
export const isReadOnly = (roles: Role[]) => roles.includes('auditor') && !intersects(roles, ['owner', 'head', 'accountant']);
export const isManager = (roles: Role[]) => roles.some(r => r !== 'employee');

export type ApprovalSection = 'scan' | 'leave' | 'shift' | 'schedule' | 'ot' | 'expense' | 'certificate' | 'leaveCancel' | 'device' | 'face';
export const APPROVAL_SECTIONS: ApprovalSection[] = ['scan', 'leave', 'shift', 'schedule', 'ot', 'expense', 'certificate', 'leaveCancel', 'device', 'face'];

export const SECTION_KINDS: Record<ApprovalSection, RequestKind[]> = {
  scan: ['clockFix'], leave: [], shift: ['shiftSwap', 'dayOffSwap'], schedule: ['schedule'], ot: ['ot'],
  expense: ['expense'], certificate: ['certificate'], leaveCancel: ['leaveCancel'], device: ['deviceChange'], face: ['faceReset']
};

export function sectionActRoles(section: ApprovalSection, s: Pick<Settings, 'leaveApproverRoles'>): Role[] {
  if (section === 'scan') return ACTION_ROLES['scan.review'];
  if (section === 'leave') return s.leaveApproverRoles;
  return [...new Set(SECTION_KINDS[section].flatMap(k => APPROVER_ROLES[k]))];
}

export type Access = 'act' | 'view' | 'none';

/**
 * act  = may decide items in this section (each item still checks self-approval etc.)
 * view = read-only (auditor)
 * The owner always gets 'act': after the escalation window the owner may decide anything.
 */
export function approvalAccess(roles: Role[], section: ApprovalSection, s: Pick<Settings, 'leaveApproverRoles'>): Access {
  if (roles.includes('owner') || intersects(roles, sectionActRoles(section, s))) return 'act';
  return roles.includes('auditor') ? 'view' : 'none';
}

export const ALL_ROLES: Role[] = ['employee', 'head', 'accountant', 'owner', 'auditor'];

/** Who may grant roles at all: only the owner. Kept out of ACTION_ROLES' maker-checker flow on purpose (see roleChangeBlock). */
export const canGrantRoles = (roles: Role[]) => roles.includes('owner');

/**
 * Why a role change is not allowed, or null.
 * - nobody edits their own roles (no self-promotion, no accidental lock-out)
 * - everyone keeps the plain employee role
 * - the last owner cannot be demoted
 * - an auditor must stay independent: no head / accountant / owner powers on the same person
 */
export function roleChangeBlock(employees: { id: string; roles: Role[]; endDate?: string }[], targetId: string, next: Role[], actorId: string): string | null {
  const target = employees.find(e => e.id === targetId);
  if (!target) return 'ບໍ່ພົບພະນັກງານ';
  if (targetId === actorId) return 'ແກ້ບົດບາດຂອງຕົນເອງບໍ່ໄດ້';
  if (next.some(r => !ALL_ROLES.includes(r))) return 'ບົດບາດບໍ່ຖືກຕ້ອງ';
  if (!next.includes('employee')) return 'ທຸກຄົນຕ້ອງມີບົດບາດພະນັກງານ';
  if (next.includes('auditor') && next.some(r => r === 'head' || r === 'accountant' || r === 'owner')) return 'ຜູ້ກວດສອບຕ້ອງເປັນອິດສະຫຼະ ໃຫ້ບົດບາດອື່ນພ້ອມກັນບໍ່ໄດ້';
  const owners = employees.filter(e => e.roles.includes('owner') && !e.endDate).length;
  if (target.roles.includes('owner') && !next.includes('owner') && owners <= 1) return 'ຕ້ອງມີເຈົ້າຂອງຢ່າງໜ້ອຍ 1 ຄົນ';
  return null;
}

export { scopeBlock, type ScopedPerson } from './scope';
