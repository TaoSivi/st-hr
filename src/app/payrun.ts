import type { HRData } from './state';
import type { Employee } from '../domain/types';
import { lateMinutes } from '../domain/attendance';
import { computePayslip, lateDeductionAmount, type Payslip } from '../domain/payroll';
import { accruedLeave } from '../domain/leave';
import { effectiveShift, type RequestPayloads } from '../domain/requests';
import { shifts } from '../data/seed';
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
  return id ? shifts.find(s => s.id === id)?.start ?? null : null;
}

export function summarize(data: HRData, e: Employee, key: string, lateConfirmed: boolean): MonthSummary {
  const s = data.settings;
  const ins = data.scans.filter(x => x.employeeId === e.id && x.kind === 'in' && inMonth(x.deviceTime, key) && (x.status === 'ok' || x.status === 'approved'));
  let lateMin = 0, lateCount = 0;
  for (const x of ins) {
    const start = shiftStartOn(data, e, ymd(new Date(x.deviceTime)));
    const m = start ? lateMinutes(start, new Date(x.deviceTime), s.graceMinutes) : 0;
    if (m > 0) { lateMin += m; lateCount++; }
  }
  const reimbursement = data.requests.filter(r => r.kind === 'expense' && r.employeeId === e.id && r.status === 'approved' && inMonth((r.payload as RequestPayloads['expense']).date, key))
    .reduce((a, r) => a + (r.payload as RequestPayloads['expense']).amount, 0);
  const otMin = data.ots.filter(o => o.employeeId === e.id && o.status === 'approved' && inMonth(o.date, key)).reduce((a, o) => a + o.minutes, 0);
  const unpaidDays = data.leaves.filter(l => l.employeeId === e.id && l.status === 'approved' && l.type === 'unpaid' && inMonth(l.from, key)).reduce((a, l) => a + l.days, 0);
  const advance = data.advances.filter(a => a.employeeId === e.id && a.status === 'approved' && a.remaining > 0)
    .reduce((sum, a) => sum + Math.min(a.remaining, Math.ceil(a.amount / a.installments)), 0);
  const slip = computePayslip({
    baseSalary: e.baseSalary, allowance: e.allowance, otMinutesApproved: otMin,
    lateDeduction: lateConfirmed ? lateDeductionAmount(lateMin, s) : 0,
    unpaidLeaveDays: unpaidDays, advanceInstallment: advance, adjustments: 0, workingDaysInMonth: 26, reimbursement
  }, s);
  return { employee: e, lateMin, lateCount, otMin, unpaidDays, advance, lateConfirmed, slip };
}

export function leaveBalance(data: HRData, e: Employee, asOf: string): { earned: number; used: number; left: number } {
  const earned = accruedLeave(data.settings.leaveAccrual, e.startDate, asOf, data.settings.leaveDaysPerYear);
  const year = asOf.slice(0, 4);
  const used = data.leaves.filter(l => l.employeeId === e.id && l.type === 'annual' && (l.status === 'pending' || l.status === 'approved') && l.from.startsWith(year))
    .reduce((a, l) => a + l.days, 0);
  return { earned, used, left: Math.round((earned - used) * 100) / 100 };
}
