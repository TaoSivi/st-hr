import { describe, expect, it } from 'vitest';
import { payrollSheets, type PayrollRow } from './payrollSheet';
import { buildXlsx } from './xlsx';
import { computePayslip } from './payroll';
import { defaultSettings } from './defaults';
import { employees } from '../data/seed';

const S = defaultSettings('c');
const row = (id: string, prorate = 1): PayrollRow => {
  const employee = employees.find(e => e.id === id)!;
  return { employee, lateMin: 0, otMin: 0, unpaidDays: 0, lateConfirmed: false, slip: computePayslip({ baseSalary: employee.baseSalary, allowance: employee.allowance, otMinutesApproved: 60, lateDeduction: 0, unpaidLeaveDays: 0, advanceInstallment: 0, adjustments: 0, workingDaysInMonth: 26, prorate }, S) };
};
const meta = { month: '2026-11', status: 'prepared' as const, by: 'Admin (ST-001)', generatedAt: '02/11/2026 22:00' };

describe('payrollSheets', () => {
  const rows = [row('e-wn', 10 / 30), row('e-kl'), row('e-bm')];
  const [lines, cover] = payrollSheets(rows, meta);
  const col = (h: string) => lines.columns.findIndex(c => c.header === h);

  it('has one line per person plus a totals row, ordered by employee code', () => {
    expect(lines.rows.length).toBe(rows.length + 1);
    const codes = lines.rows.slice(0, -1).map(r => r[0] as string);
    expect(codes).toEqual([...codes].sort());
  });
  it('each line carries the exact payslip figures', () => {
    for (const r of rows) {
      const line = lines.rows.find(l => l[0] === r.employee.code)!;
      expect(line[col('ຮັບສຸດທິ')]).toBe(r.slip.net);
      expect(line[col('ເງິນເດືອນພື້ນຖານ')]).toBe(r.slip.base);
      expect(line[col('ອາກອນ')]).toBe(r.slip.tax);
    }
  });
  it('the totals row is the sum of the lines, for every numeric column', () => {
    const total = lines.rows[lines.rows.length - 1];
    for (const h of ['ເງິນເດືອນພື້ນຖານ', 'ເບ້ຍລ້ຽງ', 'OT', 'ລວມລາຍຮັບ', 'ປະກັນສັງຄົມ', 'ອາກອນ', 'ເບີກລ່ວງໜ້າ', 'ຮັບສຸດທິ']) {
      const i = col(h);
      expect(total[i], h).toBe(lines.rows.slice(0, -1).reduce((a, l) => a + (l[i] as number), 0));
    }
  });
  it('shows the share of the month worked, so a part-month looks different from a full one', () => {
    const wn = lines.rows.find(l => l[0] === row('e-wn').employee.code)!;
    expect(wn[col('ສັດສ່ວນເດືອນ (%)')]).toBe(33.33);
    expect(lines.rows.find(l => l[0] === row('e-kl').employee.code)![col('ສັດສ່ວນເດືອນ (%)')]).toBe(100);
  });
  it('bank details appear only for people paid by bank', () => {
    const cash = { ...row('e-kl'), employee: { ...row('e-kl').employee, payMethod: 'cash' as const, bankName: 'LDB', bankAccount: '999' } };
    const [l] = payrollSheets([cash], meta);
    expect(l.rows[0][col('ທະນາຄານ')]).toBe('');
    expect(l.rows[0][col('ເລກບັນຊີ')]).toBe('');
    expect(l.rows[0][col('ຮັບເງິນ')]).toBe('ເງິນສົດ');
  });
  it('the cover sheet states how final the figures are and who exported', () => {
    const text = cover.rows.map(r => r.join(' ')).join('\n');
    expect(text).toMatch('ລໍອະນຸມັດ');
    expect(text).toMatch('ຍັງບໍ່ຢືນຢັນ');
    expect(text).toMatch('Admin (ST-001)');
    const [, lockedCover] = payrollSheets(rows, { ...meta, status: 'locked', approvedBy: 'X' });
    expect(lockedCover.rows.map(r => r.join(' ')).join('\n')).not.toMatch('ຍັງບໍ່ຢືນຢັນ');
  });
  it('an empty period still produces a valid workbook', () => {
    expect(buildXlsx(payrollSheets([], meta)).byteLength).toBeGreaterThan(100);
  });
  it('builds a real workbook from the sheets', () => expect(buildXlsx([lines, cover]).byteLength).toBeGreaterThan(500));
});
