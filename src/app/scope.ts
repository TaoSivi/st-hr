import type { Employee, Role } from '../domain/types';
import { scopeBlock } from '../domain/scope';

/** Department of an employee id, or undefined when unknown. */
export const deptOf = (employees: Employee[], id: string) => employees.find(e => e.id === id)?.dept;

/**
 * Whether `me` may see and decide items of `employeeId`. The auditor sees everything (read-only);
 * a head sees their own departments; owner and role-holders from other roles are not limited.
 */
export function inMyScope(me: Employee, employees: Employee[], employeeId: string, allowedRoles: Role[]): boolean {
  if (me.roles.includes('auditor')) return true;
  return scopeBlock(me, deptOf(employees, employeeId), allowedRoles) === null;
}
