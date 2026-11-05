import type { Role, SelfMenu, Settings } from './types';
import { requestApprovers, withOwner, type RequestKind } from './requests';
import { ACTION_ROLES, PAGE_ROLES, hasAllRights, rightsOf, type Action, type ManagerPage, type PersonRights, type RightsPerson } from './rights';

/** Single source of truth for who may see and do what. UI and tests both read this. The tables themselves live in rights.ts. */
export { ACTION_ROLES, PAGE_ROLES, type Action, type ManagerPage };

const intersects = (a: Role[], b: Role[]) => a.some(r => b.includes(r));

type ApproverSettings = Partial<Pick<Settings, 'leaveApproverRoles' | 'approverRoles' | 'roleRights'>>;
/** Roles for an action. Reviewing scans and deciding salary advances follow the company's choice when it made one. */
export function actionRoles(action: Action, s?: ApproverSettings): Role[] {
  if (action === 'scan.review' || action === 'advance.decide') { const o = s?.approverRoles?.[action]; if (o && o.length) return withOwner(o); }
  return ACTION_ROLES[action];
}
/**
 * Whether this person may approve their own requests. Only an owner can, and only when the company turned the two-person check off
 * or there is no other manager (head, accountant or owner) who could take it, so a one-person shop is never stuck. It is still audited: the
 * decision carries their own name next to their own request.
 */
export function ownerSelfOk(me: { id: string; roles: Role[] }, s: Pick<Settings, 'makerChecker'>, employees: { id: string; roles: Role[]; endDate?: string }[]): boolean {
  if (!me.roles.includes('owner')) return false;
  if (!s.makerChecker) return true;
  return !employees.some(e => e.id !== me.id && !e.endDate && e.roles.some(r => r === 'head' || r === 'accountant' || r === 'owner'));
}

/** A list of roles (the plain check) or a whole person (roles plus the rights the Super admin and Admin gave them). */
export type Who = Role[] | (RightsPerson & { perm?: PersonRights });
const asPerson = (w: Who): RightsPerson => (Array.isArray(w) ? { roles: w } : w);
/** True when the company changed what one of this person's roles gives, so the default tables no longer apply to them. */
const customRole = (p: RightsPerson, s?: ApproverSettings) => !!s?.roleRights && p.roles.some(r => r !== 'owner' && s.roleRights![r]);

export function canDoIn(who: Who, action: Action, s?: ApproverSettings): boolean {
  const p = asPerson(who);
  if (hasAllRights(p)) return true;
  const ticked = p.perm?.[action];
  if (ticked !== undefined) return ticked;
  if (customRole(p, s)) return rightsOf({ roles: p.roles }, s).has(action);
  return intersects(p.roles, actionRoles(action, s));
}
/** Self-service menus, in drawer order, and whether the company uses each (on unless switched off). */
export const SELF_MENUS: SelfMenu[] = ['directory', 'reports', 'clockFix', 'shift', 'schedule', 'ot', 'expense', 'certificate', 'pay', 'advance'];
export const menuOn = (m: SelfMenu, s?: Partial<Pick<Settings, 'employeeMenus'>>, roles?: Role[]) => roles?.includes('owner') || s?.employeeMenus?.[m] !== false; // the owner is never shut out of a menu

/** The leave page also opens for whoever Admin made a leave approver in Settings. */
export function canViewPage(who: Who, page: ManagerPage, s?: ApproverSettings): boolean {
  const p = asPerson(who);
  if (hasAllRights(p)) return true;
  const ticked = p.perm?.[`p.${page}`];
  if (ticked !== undefined) return ticked;
  if (customRole(p, s)) return rightsOf({ roles: p.roles }, s).has(`p.${page}`);
  return intersects(p.roles, PAGE_ROLES[page])
    || (page === 'leave' && !!s && (intersects(p.roles, s.leaveApproverRoles ?? []) || canDoIn(who, 'advance.decide', s)))
    || (page === 'review' && !!s && canDoIn(who, 'scan.review', s));
}
export const canDo = (who: Who, action: Action, s?: ApproverSettings) => canDoIn(who, action, s);
/** True for someone who can look at the back office but change nothing in it. */
export function isReadOnly(who: Who, s?: ApproverSettings): boolean {
  const p = asPerson(who);
  if (!Array.isArray(who)) {
    const mine = rightsOf(p, s);
    return !mine.has('writeAll') && !(['scan.review', 'ot.preapprove', 'advance.decide', 'staff.edit', 'staff.change.decide', 'payroll.prepare', 'payroll.lock', 'payroll.confirmLate', 'payroll.items', 'payroll.items.decide', 'settings.edit'] as Action[]).some(a => mine.has(a));
  }
  return p.roles.includes('auditor') && !intersects(p.roles, ['owner', 'head', 'accountant']);
}
/** A back-office role, or at least one back-office page ticked for them. */
export function isManager(who: Who, s?: ApproverSettings): boolean {
  const p = asPerson(who);
  if (p.roles.some(r => r !== 'employee')) return true;
  return !Array.isArray(who) && [...rightsOf(p, s)].some(k => k.startsWith('p.'));
}
/** On a computer-sized screen anyone with a back-office role opens straight into it; on a phone everyone opens on the clock screen. */
export const landsInBackOffice = (who: Who, wideScreen: boolean, s?: ApproverSettings) => wideScreen && isManager(who, s);

export type ApprovalSection = 'scan' | 'leave' | 'shift' | 'schedule' | 'ot' | 'expense' | 'certificate' | 'leaveCancel' | 'device' | 'face';
export const APPROVAL_SECTIONS: ApprovalSection[] = ['scan', 'leave', 'shift', 'schedule', 'ot', 'expense', 'certificate', 'leaveCancel', 'device', 'face'];

export const SECTION_KINDS: Record<ApprovalSection, RequestKind[]> = {
  scan: ['clockFix'], leave: [], shift: ['shiftSwap', 'dayOffSwap'], schedule: ['schedule'], ot: ['ot'],
  expense: ['expense'], certificate: ['certificate'], leaveCancel: ['leaveCancel'], device: ['deviceChange'], face: ['faceReset']
};

export function sectionActRoles(section: ApprovalSection, s: ApproverSettings): Role[] {
  if (section === 'scan') return [...new Set([...actionRoles('scan.review', s), ...requestApprovers('clockFix', s)])];
  if (section === 'leave') return s.leaveApproverRoles ?? [];
  return [...new Set(SECTION_KINDS[section].flatMap(k => requestApprovers(k, s)))];
}

export type Access = 'act' | 'view' | 'none';

/**
 * act  = may decide items in this section (each item still checks self-approval etc.)
 * view = read-only (auditor)
 * The owner always gets 'act': after the escalation window the owner may decide anything.
 */
export function approvalAccess(roles: Role[], section: ApprovalSection, s: ApproverSettings): Access {
  if (roles.includes('owner') || intersects(roles, sectionActRoles(section, s))) return 'act';
  return roles.includes('auditor') ? 'view' : 'none';
}

export const ALL_ROLES: Role[] = ['employee', 'head', 'accountant', 'owner', 'auditor'];

/** Who may grant roles at all: only the owner. Kept out of ACTION_ROLES' maker-checker flow on purpose (see roleChangeBlock). */
export const canGrantRoles = (who: Who, s?: ApproverSettings) => (Array.isArray(who) ? who.includes('owner') : rightsOf(who, s).has('userMng'));

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
