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
}

export interface Payslip {
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
  const hourly = p.baseSalary / s.workHoursPerMonth;
  const ot = Math.round((p.otMinutesApproved / 60) * hourly * s.otRate);
  const unpaidLeave = Math.round((p.baseSalary / p.workingDaysInMonth) * p.unpaidLeaveDays);
  const gross = p.baseSalary + p.allowance + ot - p.lateDeduction - unpaidLeave + p.adjustments;
  const socialSecurity = Math.round(p.baseSalary * s.ssRate);
  const taxable = Math.max(0, gross - socialSecurity);
  const tax = progressiveTax(taxable, s.taxBrackets);
  const reimbursement = p.reimbursement ?? 0;
  const net = gross - socialSecurity - tax - p.advanceInstallment + reimbursement;
  return {
    base: p.baseSalary, allowance: p.allowance, ot, lateDeduction: p.lateDeduction, unpaidLeave,
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
