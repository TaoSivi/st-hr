import type { HRData } from './state';
import type { Employee } from '../domain/types';
import { finalSettlement, type Settlement } from '../domain/settlement';
import { initialPayItemStatus, type PayItem } from '../domain/payItems';
import { compBalanceFor, leaveBalance, monthKey } from './payrun';
import { uid } from '../data/store';

const monthOf = (date: string) => date.slice(0, 7);

export interface SettlementPlan extends Settlement {
  /** Month the payout is paid with: the last month worked, or the current month when that one is already locked. Null when both are locked. */
  month: string | null;
}

/** What someone leaving on `endDate` is owed for unused leave, and in which payroll month it can still be added. */
export function planSettlement(data: HRData, e: Employee, endDate: string, now: Date): SettlementPlan {
  const s = finalSettlement({
    baseSalary: e.baseSalary,
    annualLeft: leaveBalance(data, e, endDate).left,
    compLeft: compBalanceFor(data, e, endDate).left,
    workingDaysInMonth: 26,
    payOut: data.settings.leavePayoutOnExit
  });
  const locked = (m: string) => data.payrollRuns.find(r => r.id === m)?.status === 'locked';
  const last = monthOf(endDate);
  const current = monthKey(now);
  return { ...s, month: !locked(last) ? last : !locked(current) ? current : null };
}

/** The pay item for a settlement. It goes through the same two-person rule as any other pay item; `by` is whoever asked for the departure. */
export function settlementItem(data: HRData, e: Employee, plan: SettlementPlan, by: string, now: Date): PayItem | null {
  if (plan.amount <= 0 || !plan.month) return null;
  const days = plan.annualDays + plan.compDays;
  return {
    id: uid(), companyId: e.companyId, employeeId: e.id, month: plan.month, kind: 'other',
    label: `ຈ່າຍວັນລາພັກຄ້າງ ${days} ມື້ (ອອກວຽກ)`, amount: plan.amount, taxable: true,
    status: initialPayItemStatus(data.settings), by, createdAt: now.toISOString()
  };
}
