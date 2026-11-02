import type { TaxBracket, Settings } from './types';

/** Progressive tax: each bracket's rate applies only to the slice of income inside it. */
export function progressiveTax(income: number, brackets: TaxBracket[]): number {
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    const upper = b.upTo ?? Infinity;
    if (income > lower) tax += (Math.min(income, upper) - lower) * b.rate;
    lower = upper;
    if (income <= upper) break;
  }
  return Math.round(tax);
}

export interface PayInput {
  baseSalary: number;
  allowance: number;
  otMinutesApproved: number;
  lateDeduction: number; // already confirmed by HR
  unpaidLeaveDays: number;
  advanceInstallment: number;
  adjustments: number; // + or − carried from locked periods
  workingDaysInMonth: number;
  reimbursement?: number; // approved expenses, paid with salary, not taxed
  prorate?: number; // share of the month employed (hired or left mid-month); base pay and allowance scale by it
}

export interface Payslip {
  prorate: number;
  base: number;
  allowance: number;
  ot: number;
  lateDeduction: number;
  unpaidLeave: number;
  adjustments: number;
  gross: number;
  socialSecurity: number;
  taxable: number;
  tax: number;
  advance: number;
  reimbursement: number;
  net: number;
}

export function computePayslip(p: PayInput, s: Settings): Payslip {
  const prorate = Math.min(1, Math.max(0, p.prorate ?? 1));
  // hourly and daily rates come from the full monthly salary; only the fixed pay is cut for a part month
  const base = Math.round(p.baseSalary * prorate);
  const allowance = Math.round(p.allowance * prorate);
  const hourly = p.baseSalary / s.workHoursPerMonth;
  const ot = Math.round((p.otMinutesApproved / 60) * hourly * s.otRate);
  const unpaidLeave = Math.round((p.baseSalary / p.workingDaysInMonth) * p.unpaidLeaveDays);
  const gross = base + allowance + ot - p.lateDeduction - unpaidLeave + p.adjustments;
  const socialSecurity = Math.round(base * s.ssRate);
  const taxable = Math.max(0, gross - socialSecurity);
  const tax = progressiveTax(taxable, s.taxBrackets);
  const reimbursement = p.reimbursement ?? 0;
  const net = gross - socialSecurity - tax - p.advanceInstallment + reimbursement;
  return {
    prorate, base, allowance, ot, lateDeduction: p.lateDeduction, unpaidLeave,
    adjustments: p.adjustments, gross, socialSecurity, taxable, tax, advance: p.advanceInstallment, reimbursement, net
  };
}

export function lateDeductionAmount(lateMinutesTotal: number, s: Settings): number {
  return lateMinutesTotal * s.lateDeductPerMinute;
}

/** Max advance an employee may draw: a share of what they have already earned this month. */
export function maxAdvance(baseSalary: number, dayOfMonth: number, daysInMonth: number, s: Settings): number {
  const earned = (baseSalary * dayOfMonth) / daysInMonth;
  return Math.floor((earned * s.advanceMaxPctOfEarned) / 1000) * 1000;
}

/** Bank transfer sheet as CSV with a UTF-8 BOM so Lao names open correctly in Excel. */
export function bankCsv(rows: { code: string; name: string; bank: string; account: string; amount: number }[]): string {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [['ລະຫັດ', 'ຊື່', 'ທະນາຄານ', 'ເລກບັນຊີ', 'ຈຳນວນເງິນ'].map(esc).join(',')];
  for (const r of rows) lines.push([r.code, r.name, r.bank, r.account, r.amount].map(esc).join(','));
  return '﻿' + lines.join('\r\n');
}

/** The person who prepared a payroll run may not be the one who locks it, unless Admin turned the two-person rule off. */
export function payrollLockBlock(preparedBy: string | undefined, approverId: string, s: Pick<Settings, 'makerChecker'>): string | null {
  return s.makerChecker && preparedBy === approverId ? 'ຄົນກະກຽມ ອະນຸມັດເອງບໍ່ໄດ້ (ກວດ 2 ຄົນ)' : null;
}

/** Whether a salary or bank-account change must be confirmed by a second person before it takes effect. */
export const changeNeedsSecondPerson = (s: Pick<Settings, 'makerChecker'>) => s.makerChecker;
