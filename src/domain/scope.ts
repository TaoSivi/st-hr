import type { Role } from './types';

export interface ScopedPerson { roles: Role[]; dept: string; headOf?: string[] }

/**
 * A head decides only for the departments they manage (`headOf`; default: their own; '*' = everyone).
 * Anyone whose authority for this action comes from another role (owner, accountant for expenses) is not limited by it.
 */
export function scopeBlock(approver: ScopedPerson, targetDept: string | undefined, allowedRoles: Role[]): string | null {
  if (targetDept === undefined || approver.roles.includes('owner')) return null; // the owner is never limited
  if (approver.roles.some(r => r !== 'head' && allowedRoles.includes(r))) return null;
  const manages = approver.headOf ?? [approver.dept];
  return manages.includes('*') || manages.includes(targetDept) ? null : 'ນອກຂອບເຂດພະແນກຂອງທ່ານ';
}
