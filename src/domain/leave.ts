import type { AccrualMethod, Employee, LeaveRequest, LeaveType, Role, Settings } from './types';
import { scopeBlock } from './scope';

const parse = (d: string) => new Date(d + 'T00:00:00');

function fullMonthsBetween(from: Date, to: Date): number {
  let m = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) m -= 1;
  return Math.max(0, m);
}

/** Annual-leave days earned in the current leave year as of `asOf`. */
export function accruedLeave(method: AccrualMethod, startDate: string, asOf: string, daysPerYear: number): number {
  const start = parse(startDate);
  const now = parse(asOf);
  if (now < start) return 0;
  const yearStart = new Date(now.getFullYear(), 0, 1);

  if (method === 'monthly') {
    const from = start > yearStart ? start : yearStart;
    const months = fullMonthsBetween(from, now);
    return Math.round(Math.min(daysPerYear, (months * daysPerYear) / 12) * 100) / 100;
  }
  if (method === 'yearStart') {
    if (start <= yearStart) return daysPerYear;
    const monthsLeft = 12 - start.getMonth();
    return Math.round(((daysPerYear * monthsLeft) / 12) * 100) / 100;
  }
  // anniversary: nothing in the first year, the full amount after each completed year
  return fullMonthsBetween(start, now) >= 12 ? daysPerYear : 0;
}

export interface Approver {
  id: string;
  roles: Role[];
  dept?: string;
  headOf?: string[];
  /** May approve their own request (see ownerSelfOk). */
  selfOk?: boolean;
}

/** Why an approver may not act on a request, or null when they may. */
export function approvalBlock(req: LeaveRequest, approver: Approver, s: Settings, now: Date, targetDept?: string): string | null {
  if (req.status !== 'pending') return 'ຄຳຂໍນີ້ຕັດສິນແລ້ວ';
  if (req.employeeId === approver.id && !approver.selfOk) return 'ອະນຸມັດຄຳຂໍຂອງຕົນເອງບໍ່ໄດ້';
  if (req.approvals.some(a => a.by === approver.id)) return 'ທ່ານອະນຸມັດຄຳຂໍນີ້ແລ້ວ';
  const escalated = isEscalated(req, s, now);
  const allowed: Role[] = escalated ? [...s.leaveApproverRoles, 'owner'] : s.leaveApproverRoles;
  if (!approver.roles.some(r => allowed.includes(r))) return 'ບໍ່ມີສິດອະນຸມັດ';
  if (approver.dept !== undefined) return scopeBlock({ roles: approver.roles, dept: approver.dept, headOf: approver.headOf }, targetDept, allowed);
  return null;
}

export function isEscalated(req: LeaveRequest, s: Settings, now: Date): boolean {
  return now.getTime() - new Date(req.createdAt).getTime() >= s.escalateAfterHours * 3600000;
}

/** Apply one decision; one rejection rejects, N distinct approvals approve. Returns a new object. */
export function decide(req: LeaveRequest, approver: Approver, decision: 'approve' | 'reject', s: Settings, now: Date, note?: string, targetDept?: string): LeaveRequest {
  const block = approvalBlock(req, approver, s, now, targetDept);
  if (block) throw new Error(block);
  if (decision === 'reject' && !note?.trim()) throw new Error('ຕ້ອງໃສ່ເຫດຜົນເມື່ອປະຕິເສດ');
  const approvals = [...req.approvals, { by: approver.id, at: now.toISOString(), decision, note }];
  const approveCount = approvals.filter(a => a.decision === 'approve').length;
  const needed = req.employeeId === approver.id && approver.selfOk ? 1 : s.leaveApproversRequired; // on their own request an owner is the only approver there is
  const status = decision === 'reject' ? 'rejected' : approveCount >= needed ? 'approved' : 'pending';
  return { ...req, approvals, status };
}

/** Working days between two dates inclusive, skipping the employee's weekly day off and holidays. */
export function leaveDays(from: string, to: string, weeklyOff: number[], holidays: string[]): number {
  let n = 0;
  for (let d = parse(from); d <= parse(to); d.setDate(d.getDate() + 1)) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!weeklyOff.includes(d.getDay()) && !holidays.includes(iso)) n++;
  }
  return n;
}

export interface LeaveBalance { earned: number; carried: number; used: number; left: number }

/**
 * Annual leave left on `asOf`: this year's accrual, plus unused days brought over from last year
 * (capped by Settings → leaveCarryOverMax, chained year by year), minus days already booked.
 */
export function annualLeaveBalance(a: {
  startDate: string; asOf: string;
  s: Pick<Settings, 'leaveAccrual' | 'leaveDaysPerYear' | 'leaveCarryOverMax'>;
  usedInYear: (year: number) => number;
}): LeaveBalance {
  const { startDate, asOf, s } = a;
  const firstYear = new Date(startDate + 'T00:00:00').getFullYear();
  const year = new Date(asOf + 'T00:00:00').getFullYear();
  const round = (n: number) => Math.round(n * 100) / 100;
  const carriedInto = (y: number): number => (y <= firstYear ? 0 : Math.min(s.leaveCarryOverMax, Math.max(0, endOfYear(y - 1))));
  const endOfYear = (y: number): number => accruedLeave(s.leaveAccrual, startDate, `${y}-12-31`, s.leaveDaysPerYear) + carriedInto(y) - a.usedInYear(y);
  const earned = accruedLeave(s.leaveAccrual, startDate, asOf, s.leaveDaysPerYear);
  const carried = carriedInto(year);
  const used = a.usedInYear(year);
  return { earned: round(earned), carried: round(carried), used: round(used), left: round(earned + carried - used) };
}

/** Days used this calendar year of one kind of leave (pending and approved both count: they are already booked). */
export function usedInYear(leaves: LeaveRequest[], employeeId: string, type: LeaveType, year: number): number {
  const n = leaves.filter(l => l.employeeId === employeeId && l.type === type && (l.status === 'pending' || l.status === 'approved') && l.from.startsWith(String(year))).reduce((a, l) => a + l.days, 0);
  return Math.round(n * 100) / 100;
}

export interface TypeBalance { type: LeaveType; quota: number | null; used: number; left: number | null }

/** Sick and personal leave: the yearly allowance from Settings (0 = no limit → quota null), what is used and what is left. Unpaid leave has no allowance. */
export function capBalance(type: 'sick' | 'personal' | 'unpaid', leaves: LeaveRequest[], employeeId: string, year: number, s: Pick<Settings, 'sickDaysPerYear' | 'personalDaysPerYear'>): TypeBalance {
  const cap = type === 'sick' ? s.sickDaysPerYear : type === 'personal' ? s.personalDaysPerYear : 0;
  const used = usedInYear(leaves, employeeId, type, year);
  const quota = cap > 0 ? cap : null;
  return { type, quota, used, left: quota === null ? null : Math.round((quota - used) * 100) / 100 };
}

/**
 * Who a leave request can be sent to: active people with a role that may approve leave (Settings), who may decide for the requester's department
 * (a head only for their own departments). Department heads come first; the person asking is never listed.
 */
export function leaveApprovers(employees: Employee[], s: Pick<Settings, 'leaveApproverRoles'>, requesterId: string): Employee[] {
  const target = employees.find(e => e.id === requesterId);
  if (!target) return [];
  const ok = employees.filter(e => !e.endDate && e.id !== requesterId && e.roles.some(r => s.leaveApproverRoles.includes(r))
    && scopeBlock({ roles: e.roles, dept: e.dept, headOf: e.headOf }, target.dept, s.leaveApproverRoles) === null);
  const rank = (e: Employee) => (e.roles.includes('head') && !e.roles.includes('owner') ? 0 : e.roles.includes('owner') ? 2 : 1);
  return ok.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
