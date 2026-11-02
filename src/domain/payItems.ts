import type { Settings } from './types';

export type PayItemKind = 'bonus' | 'commission' | 'other';
export const PAY_ITEM_LABEL: Record<PayItemKind, string> = { bonus: 'ໂບນັດ', commission: 'ຄອມມິດຊັນ', other: 'ອື່ນໆ' };

/** A one-off addition to one person's pay for one month: a bonus, a commission, or another allowance. Positive amounts only; a deduction is not a pay item. */
export interface PayItem {
  id: string;
  companyId: string;
  employeeId: string;
  month: string; // YYYY-MM
  kind: PayItemKind;
  label: string;
  amount: number;
  taxable: boolean; // false: paid after tax, like an expense refund
  salesBase?: number; // commission: the sales it is a share of
  ratePct?: number; // commission: the share, in percent
  status: 'pending' | 'approved' | 'rejected';
  by: string;
  approvedBy?: string;
  note?: string; // reason for a rejection
  createdAt: string;
}

export const commissionAmount = (salesBase: number, ratePct: number) => Math.round((salesBase * ratePct) / 100);

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Everything wrong with a new pay item, in Lao. `periodLocked`: the month's payroll is already locked, so nothing can be added to it. */
export function validatePayItem(i: PayItem, ctx: { employeeExists: boolean; employedInMonth: boolean; periodLocked: boolean }): string[] {
  const e: string[] = [];
  if (!ctx.employeeExists) e.push('ເລືອກພະນັກງານ');
  else if (!ctx.employedInMonth) e.push('ພະນັກງານຄົນນີ້ບໍ່ໄດ້ເຮັດວຽກໃນເດືອນນັ້ນ');
  if (!MONTH.test(i.month)) e.push('ເດືອນບໍ່ຖືກຕ້ອງ');
  else if (ctx.periodLocked) e.push('ງວດນີ້ລັອກແລ້ວ ໃຫ້ໃສ່ໃນເດືອນຖັດໄປ');
  if (!i.label?.trim()) e.push('ໃສ່ຊື່ລາຍການ');
  else if (i.label.trim().length > 60) e.push('ຊື່ລາຍການຍາວເກີນ 60 ຕົວອັກສອນ');
  if (!Number.isInteger(i.amount) || i.amount <= 0) e.push('ຈຳນວນເງິນຕ້ອງເປັນເລກເຕັມຫຼາຍກວ່າ 0');
  else if (i.amount > 1_000_000_000) e.push('ຈຳນວນເງິນສູງເກີນໄປ (ກວດຈຳນວນສູນ)');
  if (i.kind === 'commission' && (i.salesBase !== undefined || i.ratePct !== undefined)) {
    const { salesBase: b, ratePct: r } = i;
    if (!Number.isFinite(b) || !(b! > 0)) e.push('ຍອດຂາຍຕ້ອງຫຼາຍກວ່າ 0');
    else if (!Number.isFinite(r) || !(r! > 0) || r! > 100) e.push('ເປີເຊັນຄອມຕ້ອງຢູ່ລະຫວ່າງ 0–100');
    else if (commissionAmount(b!, r!) !== i.amount) e.push('ຈຳນວນເງິນບໍ່ກົງກັບ ຍອດຂາຍ × ເປີເຊັນ');
  }
  return e;
}

/** Why someone may not decide a pay item, or null. The person who entered it cannot approve it while the two-person rule is on. */
export function payItemDecisionBlock(i: Pick<PayItem, 'status' | 'by'>, actorId: string, s: Pick<Settings, 'makerChecker'>): string | null {
  if (i.status !== 'pending') return 'ລາຍການນີ້ຕັດສິນແລ້ວ';
  if (s.makerChecker && i.by === actorId) return 'ຄົນບັນທຶກ ອະນຸມັດເອງບໍ່ໄດ້ (ກວດ 2 ຄົນ)';
  return null;
}

/** Initial status of a new pay item: approved at once when the two-person rule is off. */
export const initialPayItemStatus = (s: Pick<Settings, 'makerChecker'>): PayItem['status'] => (s.makerChecker ? 'pending' : 'approved');

export interface PayItemTotals { bonus: number; commission: number; taxableOther: number; nonTaxable: number }

/** What an employee gets from approved pay items in a month. Pending and rejected items pay nothing. */
export function payItemTotals(items: PayItem[], employeeId: string, month: string): PayItemTotals {
  const t: PayItemTotals = { bonus: 0, commission: 0, taxableOther: 0, nonTaxable: 0 };
  for (const i of items) {
    if (i.employeeId !== employeeId || i.month !== month || i.status !== 'approved') continue;
    if (!i.taxable) t.nonTaxable += i.amount;
    else if (i.kind === 'bonus') t.bonus += i.amount;
    else if (i.kind === 'commission') t.commission += i.amount;
    else t.taxableOther += i.amount;
  }
  return t;
}

/** Locking a month with items still waiting would leave them unpaid and out of reach, so it is refused. */
export function pendingPayItemsBlock(items: Pick<PayItem, 'month' | 'status'>[], month: string): string | null {
  const n = items.filter(i => i.month === month && i.status === 'pending').length;
  return n ? `ມີ ${n} ລາຍການໂບນັດ / ຄອມ ທີ່ລໍອະນຸມັດ — ຕັດສິນກ່ອນລັອກງວດ` : null;
}
