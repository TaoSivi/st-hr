import type { Sheet } from './xlsx';
import type { Payslip } from './payroll';
import type { Employee } from './types';

export interface PayrollRow { employee: Employee; lateMin: number; otMin: number; unpaidDays: number; lateConfirmed: boolean; slip: Payslip }
export interface PayrollMeta { month: string; status: 'draft' | 'prepared' | 'locked'; preparedBy?: string; approvedBy?: string; by: string; generatedAt: string }

const STATUS = { draft: 'ຮ່າງ (ຍັງບໍ່ລັອກ)', prepared: 'ກະກຽມແລ້ວ ລໍອະນຸມັດ', locked: 'ລັອກແລ້ວ' } as const;

/**
 * The payroll workbook: one sheet of per-person lines with a totals row, and a cover sheet that says
 * which period, how final the numbers are, and who prepared / approved / exported them.
 * Every figure comes from the same Payslip the screen shows, so file and screen cannot disagree.
 */
export function payrollSheets(rows: PayrollRow[], meta: PayrollMeta): Sheet[] {
  const sorted = [...rows].sort((a, b) => a.employee.code.localeCompare(b.employee.code));
  const sum = (f: (r: PayrollRow) => number) => sorted.reduce((a, r) => a + f(r), 0);
  const lines: Sheet = {
    name: 'ເງິນເດືອນ ' + meta.month,
    columns: [
      { header: 'ລະຫັດ', width: 10 }, { header: 'ຊື່', width: 26 }, { header: 'ພະແນກ', width: 14 }, { header: 'ຮັບເງິນ', width: 12 }, { header: 'ທະນາຄານ', width: 12 }, { header: 'ເລກບັນຊີ', width: 18 },
      { header: 'ສັດສ່ວນເດືອນ (%)', width: 12, format: 'decimal' },
      { header: 'ເງິນເດືອນພື້ນຖານ', width: 16, format: 'int' }, { header: 'ເບ້ຍລ້ຽງ', width: 12, format: 'int' }, { header: 'OT', width: 12, format: 'int' },
      { header: 'ເບ້ຍລ້ຽງຕາມກະ', width: 14, format: 'int' }, { header: 'ໂບນັດ', width: 12, format: 'int' }, { header: 'ຄອມມິດຊັນ', width: 12, format: 'int' }, { header: 'ລາຍຮັບອື່ນໆ', width: 12, format: 'int' },
      { header: 'ຫັກມາຊ້າ', width: 12, format: 'int' }, { header: 'ລາບໍ່ຮັບເງິນ', width: 12, format: 'int' }, { header: 'ປັບປຸງ', width: 12, format: 'int' },
      { header: 'ລວມລາຍຮັບ', width: 14, format: 'int' }, { header: 'ປະກັນສັງຄົມ', width: 13, format: 'int' }, { header: 'ລາຍໄດ້ຕ້ອງເສຍພາສີ', width: 16, format: 'int' }, { header: 'ອາກອນ', width: 12, format: 'int' },
      { header: 'ເບີກລ່ວງໜ້າ', width: 12, format: 'int' }, { header: 'ຄືນຄ່າໃຊ້ຈ່າຍ', width: 13, format: 'int' }, { header: 'ລາຍຮັບອື່ນ (ບໍ່ເສຍພາສີ)', width: 18, format: 'int' }, { header: 'ຮັບສຸດທິ', width: 14, format: 'int' }
    ],
    rows: [
      ...sorted.map(({ employee: e, slip: s }): (string | number | null)[] => [
        e.code, e.name, e.dept, e.payMethod === 'cash' ? 'ເງິນສົດ' : 'ໂອນ', e.payMethod === 'bank' ? e.bankName ?? '' : '', e.payMethod === 'bank' ? e.bankAccount ?? '' : '',
        Math.round(s.prorate * 10000) / 100,
        s.base, s.allowance, s.ot, s.shiftAllowance, s.bonus, s.commission, s.otherPay, s.lateDeduction, s.unpaidLeave, s.adjustments, s.gross, s.socialSecurity, s.taxable, s.tax, s.advance, s.reimbursement, s.extraNonTaxable, s.net
      ]),
      ['', 'ລວມ', '', '', '', '', null, sum(r => r.slip.base), sum(r => r.slip.allowance), sum(r => r.slip.ot), sum(r => r.slip.shiftAllowance), sum(r => r.slip.bonus), sum(r => r.slip.commission), sum(r => r.slip.otherPay), sum(r => r.slip.lateDeduction), sum(r => r.slip.unpaidLeave), sum(r => r.slip.adjustments),
        sum(r => r.slip.gross), sum(r => r.slip.socialSecurity), sum(r => r.slip.taxable), sum(r => r.slip.tax), sum(r => r.slip.advance), sum(r => r.slip.reimbursement), sum(r => r.slip.extraNonTaxable), sum(r => r.slip.net)]
    ]
  };
  const cover: Sheet = {
    name: 'ຂໍ້ມູນງວດ',
    columns: [{ header: 'ລາຍການ', width: 24 }, { header: 'ຄ່າ', width: 40 }],
    rows: [
      ['ງວດ', meta.month], ['ສະຖານະ', STATUS[meta.status]], ['ກະກຽມໂດຍ', meta.preparedBy ?? '—'], ['ອະນຸມັດໂດຍ', meta.approvedBy ?? '—'],
      ['ຈຳນວນຄົນ', sorted.length], ['ຈ່າຍສຸດທິລວມ', sum(r => r.slip.net)], ['Export ໂດຍ', meta.by], ['ເວລາ export', meta.generatedAt],
      ['ໝາຍເຫດ', meta.status === 'locked' ? '' : 'ຕົວເລກຍັງບໍ່ຢືນຢັນ: ງວດຍັງບໍ່ໄດ້ລັອກ ອາດປ່ຽນໄດ້'],
      ['ໝາຍເຫດ 2', 'ອັດຕາອາກອນ / ປະກັນສັງຄົມ ເປັນຄ່າຕົວຢ່າງ ຕ້ອງກວດກັບກົດໝາຍ ກ່ອນນຳໃຊ້ຈິງ']
    ]
  };
  return [lines, cover];
}
