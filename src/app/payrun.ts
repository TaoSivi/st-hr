import type { HRData } from './state';
import type { Employee } from '../domain/types';
import { isSettled, lateMinutes } from '../domain/attendance';
import { computePayslip, lateDeductionAmount, type Payslip } from '../domain/payroll';
import { employedFraction, isActiveOn } from '../domain/hiring';
import { compBalance, compDaysFor } from '../domain/comp';
import { lateStartFor, shiftPaidHours } from '../domain/leavePart';
import { closesAtFor } from '../domain/missedOut';
import { scansOn, toSessions, workedMinutesOf } from '../domain/sessions';
import { annualLeaveBalance, type LeaveBalance } from '../domain/leave';
import { effectiveShift, type RequestPayloads } from '../domain/requests';

import { payItemTotals } from '../domain/payItems';
import { ymd } from '../ui/format';

export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const inMonth = (iso: string, key: string) => iso.slice(0, 7) === key;

export interface MonthSummary {
  employee: Employee;
  lateMin: number;
  lateCount: number;
  otMin: number;
  unpaidDays: number;
  advance: number;
  lateConfirmed: boolean;
  slip: Payslip;
}

/** Everything payroll needs for one employee and month, derived only from accepted records. */
/** Shift start for one employee on one date, after approved swaps; null on a day off. */
export function shiftStartOn(data: HRData, e: Employee, date: string): string | null {
  const id = effectiveShift(e, date, data.overrides);
  return id ? data.shifts.find(s => s.id === id)?.start ?? null : null;
}

/**
 * The time lateness is measured from on one date: the shift start, or after the break when the morning is an approved leave.
 * Null on a day off.
 */
export function lateStartOn(data: HRData, e: Employee, date: string): string | null {
  const id = effectiveShift(e, date, data.overrides);
  const shift = id ? data.shifts.find(s => s.id === id) : undefined;
  if (!shift) return null;
  return lateStartFor(shift, data.leaves.filter(l => l.employeeId === e.id && l.from <= date && l.to >= date));
}

/** Compensatory days off earned by working public holidays, minus what has been booked (pending leave reserves its days). */
export function compBalanceFor(data: HRData, e: Employee, asOf: string): ReturnType<typeof compBalance> {
  const mine = data.scans.filter(s => s.employeeId === e.id && isSettled(s));
  const closesOf = (date: string) => closesAtFor(date, data.shifts.find(x => x.id === (effectiveShift(e, date, data.overrides) ?? e.shiftId)));
  const sessions = toSessions(mine, closesOf);
  const earned = data.settings.holidays.filter(h => h <= asOf && isActiveOn(e, h)).map(h => {
    const shift = data.shifts.find(x => x.id === (effectiveShift(e, h, data.overrides) ?? e.shiftId));
    return { date: h, days: shift ? compDaysFor(workedMinutesOf(scansOn(sessions, h)), shiftPaidHours(shift) * 60) : 0 };
  });
  const used = data.leaves.filter(l => l.employeeId === e.id && l.type === 'comp' && (l.status === 'pending' || l.status === 'approved')).map(l => ({ from: l.from, days: l.days }));
  return compBalance({ earned, used, asOf, expiryDays: data.settings.compLeaveExpiryDays });
}

/** Allowance for the shifts worked in a month (each shift's own per-shift amount), counting every confirmed clock-in session. */
export function shiftAllowanceFor(data: HRData, e: Employee, key: string): number {
  const mine = data.scans.filter(x => x.employeeId === e.id && isSettled(x));
  const closesOf = (date: string) => closesAtFor(date, data.shifts.find(x => x.id === (effectiveShift(e, date, data.overrides) ?? e.shiftId)));
  let total = 0;
  for (const s of toSessions(mine, closesOf)) {
    if (!s.workDate.startsWith(key) || !s.scans.some(x => x.kind === 'in' && (x.status === 'ok' || x.status === 'approved'))) continue;
    const id = effectiveShift(e, s.workDate, data.overrides);
    total += (id && data.shifts.find(x => x.id === id)?.allowance) || 0;
  }
  return total;
}

export function summarize(data: HRData, e: Employee, key: string, lateConfirmed: boolean): MonthSummary {
  const s = data.settings;
  // an offline scan whose clock has not been checked by the server yet does not count toward pay
  const ins = data.scans.filter(x => x.employeeId === e.id && x.kind === 'in' && inMonth(x.deviceTime, key) && (x.status === 'ok' || x.status === 'approved') && isSettled(x));
  let lateMin = 0, lateCount = 0;
  for (const x of ins) {
    const start = lateStartOn(data, e, ymd(new Date(x.deviceTime)));
    const m = start ? lateMinutes(start, new Date(x.deviceTime), s.graceMinutes) : 0;
    if (m > 0) { lateMin += m; lateCount++; }
  }
  const reimbursement = data.requests.filter(r => r.kind === 'expense' && r.employeeId === e.id && r.status === 'approved' && inMonth((r.payload as RequestPayloads['expense']).date, key))
    .reduce((a, r) => a + (r.payload as RequestPayloads['expense']).amount, 0);
  const otMin = data.ots.filter(o => o.employeeId === e.id && o.status === 'approved' && inMonth(o.date, key)).reduce((a, o) => a + o.minutes, 0);
  const unpaidDays = data.leaves.filter(l => l.employeeId === e.id && l.status === 'approved' && l.type === 'unpaid' && inMonth(l.from, key)).reduce((a, l) => a + l.days, 0);
  const advance = data.advances.filter(a => a.employeeId === e.id && a.status === 'approved' && a.remaining > 0)
    .reduce((sum, a) => sum + Math.min(a.remaining, Math.ceil(a.amount / a.installments)), 0);
  const items = payItemTotals(data.payItems ?? [], e.id, key);
  const slip = computePayslip({
    baseSalary: e.baseSalary, allowance: e.allowance, otMinutesApproved: otMin,
    lateDeduction: lateConfirmed ? lateDeductionAmount(lateMin, s) : 0,
    unpaidLeaveDays: unpaidDays, advanceInstallment: advance, adjustments: 0, workingDaysInMonth: 26, reimbursement, prorate: employedFraction(e, +key.slice(0, 4), +key.slice(5) - 1),
    bonus: items.bonus, commission: items.commission, otherTaxable: items.taxableOther, extraNonTaxable: items.nonTaxable, shiftAllowance: shiftAllowanceFor(data, e, key)
  }, s);
  return { employee: e, lateMin, lateCount, otMin, unpaidDays, advance, lateConfirmed, slip };
}

export function leaveBalance(data: HRData, e: Employee, asOf: string): LeaveBalance {
  return annualLeaveBalance({
    startDate: e.startDate, asOf, s: data.settings,
    usedInYear: y => data.leaves.filter(l => l.employeeId === e.id && l.type === 'annual' && (l.status === 'pending' || l.status === 'approved') && l.from.startsWith(String(y)))
      .reduce((a, l) => a + l.days, 0)
  });
}
