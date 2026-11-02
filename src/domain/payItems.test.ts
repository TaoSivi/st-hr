import { describe, expect, it } from 'vitest';
import { commissionAmount, initialPayItemStatus, payItemDecisionBlock, payItemTotals, pendingPayItemsBlock, validatePayItem, type PayItem } from './payItems';
import { computePayslip } from './payroll';
import { validateShifts } from './settingsCheck';
import { shiftAllowanceFor, summarize } from '../app/payrun';
import { payrollSheets } from './payrollSheet';
import { defaultSettings } from './defaults';
import { branches, employees, shifts } from '../data/seed';
import type { ScanRecord, Shift } from './types';

const S = defaultSettings('c1');
const item = (over: Partial<PayItem> = {}): PayItem => ({ id: 'i' + Math.random(), companyId: 'c1', employeeId: 'e-kl', month: '2026-11', kind: 'bonus', label: 'ໂບນັດ', amount: 500_000, taxable: true, status: 'approved', by: 'e-acc', createdAt: '2026-11-02T09:00:00', ...over });
const ok = { employeeExists: true, employedInMonth: true, periodLocked: false };

describe('validatePayItem', () => {
  it('accepts a normal bonus', () => expect(validatePayItem(item(), ok)).toEqual([]));
  it('needs an employee who worked in that month', () => {
    expect(validatePayItem(item(), { ...ok, employeeExists: false }).join()).toMatch('ເລືອກພະນັກງານ');
    expect(validatePayItem(item(), { ...ok, employedInMonth: false }).join()).toMatch('ບໍ່ໄດ້ເຮັດວຽກ');
  });
  it('refuses a locked month', () => expect(validatePayItem(item(), { ...ok, periodLocked: true }).join()).toMatch('ລັອກແລ້ວ'));
  it('amount must be a whole positive number, with a ceiling against a slipped zero', () => {
    for (const amount of [0, -1, 1.5, NaN, Infinity]) expect(validatePayItem(item({ amount }), ok).join(), String(amount)).toMatch('ຈຳນວນເງິນ');
    expect(validatePayItem(item({ amount: 2_000_000_000 }), ok).join()).toMatch('ສູງເກີນ');
  });
  it('needs a short label and a real month', () => {
    expect(validatePayItem(item({ label: '  ' }), ok).join()).toMatch('ຊື່ລາຍການ');
    expect(validatePayItem(item({ label: 'x'.repeat(61) }), ok).join()).toMatch('60');
    expect(validatePayItem(item({ month: '2026-13' }), ok).join()).toMatch('ເດືອນ');
  });
  it('a commission must equal sales × rate when those are given', () => {
    expect(commissionAmount(10_000_000, 2.5)).toBe(250_000);
    expect(validatePayItem(item({ kind: 'commission', salesBase: 10_000_000, ratePct: 2.5, amount: 250_000 }), ok)).toEqual([]);
    expect(validatePayItem(item({ kind: 'commission', salesBase: 10_000_000, ratePct: 2.5, amount: 300_000 }), ok).join()).toMatch('ບໍ່ກົງກັບ');
    expect(validatePayItem(item({ kind: 'commission', salesBase: 10_000_000, ratePct: 150, amount: 1 }), ok).join()).toMatch('ເປີເຊັນ');
    expect(validatePayItem(item({ kind: 'commission', salesBase: 0, ratePct: 2, amount: 1 }), ok).join()).toMatch('ຍອດຂາຍ');
  });
});

describe('two-person rule on pay items', () => {
  it('the person who entered it cannot approve it while the rule is on; anyone else can', () => {
    const pending = item({ status: 'pending', by: 'e-acc' });
    expect(payItemDecisionBlock(pending, 'e-acc', { makerChecker: true })).toMatch('ກວດ 2 ຄົນ');
    expect(payItemDecisionBlock(pending, 'e-owner', { makerChecker: true })).toBeNull();
    expect(payItemDecisionBlock(pending, 'e-acc', { makerChecker: false })).toBeNull();
  });
  it('an item already decided cannot be decided again', () => {
    expect(payItemDecisionBlock(item({ status: 'approved' }), 'e-owner', { makerChecker: true })).toMatch('ຕັດສິນແລ້ວ');
    expect(payItemDecisionBlock(item({ status: 'rejected' }), 'e-owner', { makerChecker: true })).toMatch('ຕັດສິນແລ້ວ');
  });
  it('new items start pending only when the rule is on', () => {
    expect(initialPayItemStatus({ makerChecker: true })).toBe('pending');
    expect(initialPayItemStatus({ makerChecker: false })).toBe('approved');
  });
  it('a month with items waiting cannot be locked', () => {
    expect(pendingPayItemsBlock([item({ status: 'pending' }), item({ status: 'pending' })], '2026-11')).toMatch('2 ລາຍການ');
    expect(pendingPayItemsBlock([item({ status: 'approved' }), item({ status: 'rejected' }), item({ status: 'pending', month: '2026-12' })], '2026-11')).toBeNull();
  });
});

describe('payItemTotals', () => {
  const items = [
    item({ amount: 500_000 }), item({ amount: 100_000, kind: 'commission' }), item({ amount: 70_000, kind: 'other' }), item({ amount: 30_000, taxable: false }),
    item({ amount: 999, status: 'pending' }), item({ amount: 888, status: 'rejected' }), item({ amount: 777, month: '2026-10' }), item({ amount: 666, employeeId: 'e-bm' })
  ];
  it('adds only approved items of that person and month, split by kind and tax', () => {
    expect(payItemTotals(items, 'e-kl', '2026-11')).toEqual({ bonus: 500_000, commission: 100_000, taxableOther: 70_000, nonTaxable: 30_000 });
  });
  it('nothing for someone with no items', () => expect(payItemTotals(items, 'nobody', '2026-11')).toEqual({ bonus: 0, commission: 0, taxableOther: 0, nonTaxable: 0 }));
});

describe('pay items in the payslip', () => {
  const base = { baseSalary: 5_000_000, allowance: 0, otMinutesApproved: 0, lateDeduction: 0, unpaidLeaveDays: 0, advanceInstallment: 0, adjustments: 0, workingDaysInMonth: 26 };
  const plain = computePayslip(base, S);
  it('without items nothing changes', () => expect(plain).toMatchObject({ bonus: 0, commission: 0, shiftAllowance: 0, otherPay: 0, extraNonTaxable: 0 }));
  it('taxable items raise gross and tax; social security stays on base pay only', () => {
    const p = computePayslip({ ...base, bonus: 1_000_000, commission: 500_000, shiftAllowance: 200_000, otherTaxable: 100_000 }, S);
    expect(p.gross).toBe(plain.gross + 1_800_000);
    expect(p.socialSecurity).toBe(plain.socialSecurity);
    expect(p.tax).toBeGreaterThan(plain.tax);
    expect(p).toMatchObject({ bonus: 1_000_000, commission: 500_000, shiftAllowance: 200_000, otherPay: 100_000 });
  });
  it('a non-taxable item is paid after tax and does not change the tax', () => {
    const p = computePayslip({ ...base, extraNonTaxable: 300_000 }, S);
    expect(p.tax).toBe(plain.tax);
    expect(p.gross).toBe(plain.gross);
    expect(p.net).toBe(plain.net + 300_000);
  });
  it('a part-month does not scale bonuses (they are what was agreed)', () => {
    const p = computePayslip({ ...base, prorate: 0.5, bonus: 400_000 }, S);
    expect(p.bonus).toBe(400_000);
    expect(p.base).toBe(2_500_000);
  });
});

describe('shift allowance from the shifts actually worked', () => {
  const night: Shift = { id: 'night', name: 'ກາງຄືນ', start: '22:00', end: '06:00', breakStart: '01:00', breakEnd: '01:30', allowance: 30_000 };
  const day: Shift = { ...shifts[0], allowance: 10_000 };
  const kl = { ...employees.find(e => e.id === 'e-kl')!, shiftId: 'night', startDate: '2026-10-01', dayOff: [0] };
  let n = 0;
  const scan = (kind: ScanRecord['kind'], d: Date, over: Partial<ScanRecord> = {}): ScanRecord => ({ id: 'a' + n++, companyId: 'c1', employeeId: 'e-kl', kind, deviceTime: d.toISOString(), serverTime: d.toISOString(), branchId: branches[0].id, status: 'ok', reasons: [], offline: false, ...over });
  const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m);
  const data = (scans: ScanRecord[], payItems: PayItem[] = [], shiftList = [night, day]) => ({ employees: [kl], branches, scans, leaves: [], ots: [], advances: [], payrollRuns: [], requests: [], overrides: [], shifts: shiftList, notifications: [], payItems, settings: S }) as any;

  it('each worked night earns the shift allowance, including the one that ends after midnight', () => {
    const scans = [scan('in', at(2, 22)), scan('out', at(3, 6)), scan('in', at(3, 22)), scan('out', at(4, 6))];
    expect(shiftAllowanceFor(data(scans), kl, '2026-11')).toBe(60_000);
  });
  it('a night worked at the end of October pays in October, not November', () => {
    const scans = [scan('in', new Date(2026, 9, 31, 22)), scan('out', at(1, 6))];
    expect(shiftAllowanceFor(data(scans), kl, '2026-10')).toBe(30_000);
    expect(shiftAllowanceFor(data(scans), kl, '2026-11')).toBe(0);
  });
  it('pending, rejected and unconfirmed-offline clock-ins earn nothing; a missed clock-out still counts the night', () => {
    expect(shiftAllowanceFor(data([scan('in', at(2, 22), { status: 'pending' })]), kl, '2026-11')).toBe(0);
    expect(shiftAllowanceFor(data([scan('in', at(2, 22), { status: 'rejected' })]), kl, '2026-11')).toBe(0);
    expect(shiftAllowanceFor(data([scan('in', at(2, 22), { offline: true, serverTime: undefined })]), kl, '2026-11')).toBe(0);
    expect(shiftAllowanceFor(data([scan('in', at(2, 22))]), kl, '2026-11')).toBe(30_000);
    expect(shiftAllowanceFor(data([scan('in', at(2, 22), { status: 'approved' })]), kl, '2026-11')).toBe(30_000);
  });
  it('a shift without an allowance, or work on a day off, earns nothing', () => {
    expect(shiftAllowanceFor(data([scan('in', at(2, 22))], [], [{ ...night, allowance: undefined }, day]), kl, '2026-11')).toBe(0);
    expect(shiftAllowanceFor(data([scan('in', at(1, 22))]), kl, '2026-11')).toBe(0); // Sunday 1 Nov is the weekly day off
  });
  it('it reaches the payslip together with approved pay items, and only approved ones', () => {
    const scans = [scan('in', at(2, 22)), scan('out', at(3, 6))];
    const items = [item({ amount: 400_000 }), item({ kind: 'commission', amount: 50_000 }), item({ amount: 9_999_999, status: 'pending' })];
    const { slip } = summarize(data(scans, items), kl, '2026-11', false);
    expect(slip).toMatchObject({ shiftAllowance: 30_000, bonus: 400_000, commission: 50_000 });
  });
});

describe('shift allowance setting', () => {
  const ok = { id: 'n', name: 'ກາງຄືນ', start: '22:00', end: '06:00', breakStart: '01:00', breakEnd: '01:30' };
  it('whole non-negative amounts only', () => {
    expect(validateShifts([{ ...ok, allowance: 30_000 }])).toEqual([]);
    expect(validateShifts([{ ...ok, allowance: 0 }])).toEqual([]);
    expect(validateShifts([ok])).toEqual([]); // optional
    for (const allowance of [-1, 1.5, NaN, 20_000_000]) expect(validateShifts([{ ...ok, allowance }]).join(), String(allowance)).toMatch('ເບ້ຍລ້ຽງ');
  });
});

describe('payroll workbook carries the new columns', () => {
  it('bonus, commission and shift allowance columns match the slips and the totals', () => {
    const e = employees.find(x => x.id === 'e-kl')!;
    const slip = computePayslip({ baseSalary: e.baseSalary, allowance: e.allowance, otMinutesApproved: 0, lateDeduction: 0, unpaidLeaveDays: 0, advanceInstallment: 0, adjustments: 0, workingDaysInMonth: 26, bonus: 100_000, commission: 20_000, shiftAllowance: 30_000, otherTaxable: 5_000, extraNonTaxable: 7_000 }, S);
    const [lines] = payrollSheets([{ employee: e, lateMin: 0, otMin: 0, unpaidDays: 0, lateConfirmed: false, slip }], { month: '2026-11', status: 'draft', by: 'x', generatedAt: 'y' });
    const col = (h: string) => lines.columns.findIndex(c => c.header === h);
    const row = lines.rows[0];
    expect([row[col('ໂບນັດ')], row[col('ຄອມມິດຊັນ')], row[col('ເບ້ຍລ້ຽງຕາມກະ')], row[col('ລາຍຮັບອື່ນໆ')], row[col('ລາຍຮັບອື່ນ (ບໍ່ເສຍພາສີ)')], row[col('ຮັບສຸດທິ')]]).toEqual([100_000, 20_000, 30_000, 5_000, 7_000, slip.net]);
    expect(lines.rows[1][col('ໂບນັດ')]).toBe(100_000);
    expect(row.length).toBe(lines.columns.length);
  });
});
