import type { Role } from './types';

/**
 * What each role may see and do, and the two ways to change it: the Super admin edits a role's rights for the whole company
 * (Settings.roleRights), and an Admin ticks or unticks single rights on one person (Employee.perm).
 * A right is a plain string: 'p.pay' (open a back-office page), an action such as 'payroll.lock', or one of the scope rights below.
 * apps-script/Code.gs repeats ROLE_RIGHTS and enforces them on every read and write; a test keeps the two copies equal.
 */

export type ManagerPage = 'overview' | 'review' | 'approvals' | 'time' | 'reports' | 'map' | 'leave' | 'staff' | 'pay' | 'access' | 'settings' | 'audit' | 'records';
export const PAGES: ManagerPage[] = ['overview', 'review', 'approvals', 'time', 'reports', 'map', 'leave', 'staff', 'pay', 'access', 'settings', 'audit', 'records'];

export type Action =
  | 'scan.review' | 'ot.preapprove' | 'advance.decide'
  | 'staff.edit' | 'staff.change.decide'
  | 'payroll.prepare' | 'payroll.lock' | 'payroll.confirmLate' | 'payroll.items' | 'payroll.items.decide'
  | 'settings.edit';
export const ACTIONS: Action[] = ['scan.review', 'ot.preapprove', 'advance.decide', 'staff.edit', 'staff.change.decide', 'payroll.prepare', 'payroll.lock', 'payroll.confirmLate', 'payroll.items', 'payroll.items.decide', 'settings.edit'];

/** Beyond pages and actions: how far the data reaches, who may manage logins and rights, and who may approve for others with a PIN. */
export type ScopeRight = 'dataAll' | 'dataDept' | 'writeAll' | 'userMng' | 'override';
export const SCOPE_RIGHTS: ScopeRight[] = ['dataAll', 'dataDept', 'writeAll', 'userMng', 'override'];

export type RightKey = `p.${ManagerPage}` | Action | ScopeRight;
export const pageRight = (p: ManagerPage): RightKey => `p.${p}`;
export const ALL_RIGHTS: RightKey[] = [...PAGES.map(pageRight), ...ACTIONS, ...SCOPE_RIGHTS];
export const isRightKey = (k: string): k is RightKey => (ALL_RIGHTS as string[]).includes(k);

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
  access: ['owner', 'auditor'],
  settings: ['owner', 'auditor'],
  audit: ['owner', 'auditor'],
  records: ['owner'] // edit or delete any record: the Admin and the Super admin
};

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

const SCOPE_ROLES: Record<ScopeRight, Role[]> = {
  dataAll: ['owner', 'accountant', 'auditor'],
  dataDept: ['head'],
  writeAll: ['owner', 'accountant'],
  userMng: ['owner'],
  override: ['owner', 'head', 'accountant']
};

/** The rights each role has until the Super admin changes them. The owner (Admin) has every right and that cannot be taken away. */
export const ROLE_RIGHTS: Record<Role, RightKey[]> = (() => {
  const out = {} as Record<Role, RightKey[]>;
  for (const role of ['employee', 'head', 'accountant', 'owner', 'auditor'] as Role[]) {
    out[role] = [
      ...PAGES.filter(p => PAGE_ROLES[p].includes(role)).map(pageRight),
      ...ACTIONS.filter(a => ACTION_ROLES[a].includes(role)),
      ...SCOPE_RIGHTS.filter(s => SCOPE_ROLES[s].includes(role))
    ];
  }
  return out;
})();

/** Roles whose rights the Super admin may change. The owner keeps everything and the plain employee has no back-office rights to start from. */
export const EDITABLE_ROLES: Role[] = ['head', 'accountant', 'auditor'];

/** What the company decided about a role (Settings.roleRights) and what one person was given or refused (Employee.perm). */
export type RoleRights = Partial<Record<Role, RightKey[]>>;
export type PersonRights = Partial<Record<RightKey, boolean>>;

export interface RightsPerson { roles: Role[]; superAdmin?: boolean; perm?: PersonRights }
export interface RightsSettings { roleRights?: RoleRights }

export const hasAllRights = (p: { roles: Role[]; superAdmin?: boolean }) => !!p.superAdmin || p.roles.includes('owner');

/** The rights a role gives: the company's own list when the Super admin made one, otherwise the default. */
export function roleGives(role: Role, s?: RightsSettings): RightKey[] {
  if (role === 'owner') return ALL_RIGHTS;
  const custom = s?.roleRights?.[role];
  return custom ? custom.filter(isRightKey) : ROLE_RIGHTS[role];
}

/** Every right this person has: their roles' rights, then their own ticks on top. */
export function rightsOf(p: RightsPerson, s?: RightsSettings): Set<RightKey> {
  if (hasAllRights(p)) return new Set(ALL_RIGHTS);
  const out = new Set<RightKey>();
  for (const r of p.roles) for (const k of roleGives(r, s)) out.add(k);
  for (const [k, v] of Object.entries(p.perm ?? {})) {
    if (!isRightKey(k)) continue;
    if (v === true) out.add(k); else if (v === false) out.delete(k);
  }
  return out;
}

export const hasRight = (p: RightsPerson, key: RightKey, s?: RightsSettings) => rightsOf(p, s).has(key);

/** Why a set of ticks cannot be saved, or null: unknown rights, or a right the person making the change does not have themselves. */
export function permProblem(next: PersonRights, actor: RightsPerson, s?: RightsSettings): string | null {
  const mine = rightsOf(actor, s);
  for (const [k, v] of Object.entries(next)) {
    if (!isRightKey(k) || typeof v !== 'boolean') return 'ສິດບໍ່ຖືກຕ້ອງ';
    if (v && !mine.has(k)) return 'ໃຫ້ສິດທີ່ຕົນເອງບໍ່ມີບໍ່ໄດ້';
  }
  return null;
}
