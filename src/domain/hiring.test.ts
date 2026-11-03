import { describe, expect, it } from 'vitest';
import { employedFraction, isActiveOn, nextEmployeeCode, profileProblems, terminationBlock, validateNewEmployee } from './hiring';
import { computePayslip } from './payroll';
import { defaultSettings } from './defaults';
import { branches, employees, shifts } from '../data/seed';
import type { Employee } from './types';

const S = defaultSettings('c1');
const base = employees.find(e => e.id === 'e-kl')!;
const fresh = (over: Partial<Employee> = {}): Employee => ({
  ...base, id: 'new', code: 'ST-099', name: 'ພະນັກງານໃໝ່ ທົດສອບ', dept: 'ເສີບ', position: 'ພະນັກງານເສີບ', roles: ['employee'], startDate: '2026-11-02', endDate: undefined, headOf: undefined,
  baseSalary: 3_000_000, allowance: 200_000, payMethod: 'bank', bankName: 'LDB', bankAccount: '0101', homeBranchId: branches[0].id, shiftId: shifts[0].id, ...over
});

describe('validateNewEmployee', () => {
  const ok = (e: Employee) => validateNewEmployee(e, employees, shifts, branches);
  it('accepts a sound record', () => expect(ok(fresh())).toEqual([]));
  it('needs name, department and position', () => {
    expect(ok(fresh({ name: ' ' })).join()).toMatch('ຊື່');
    expect(ok(fresh({ dept: '' })).join()).toMatch('ພະແນກ');
    expect(ok(fresh({ position: '' })).join()).toMatch('ຕຳແໜ່ງ');
  });
  it('refuses a duplicate code, in any letter case', () => {
    expect(ok(fresh({ code: 'ST-012' })).join()).toMatch('ຊ້ຳ');
    expect(ok(fresh({ code: 'st-012' })).join()).toMatch('ຊ້ຳ');
  });
  it('refuses the same person twice (same name and department)', () => {
    expect(ok(fresh({ name: base.name, dept: base.dept })).join()).toMatch('ຊ້ຳ');
  });
  it('salary must be a positive number; allowance not negative; NaN is refused', () => {
    for (const bad of [0, -5, NaN, Infinity]) expect(ok(fresh({ baseSalary: bad })).join(), String(bad)).toMatch('ເງິນເດືອນ');
    expect(ok(fresh({ allowance: -1 })).join()).toMatch('ເບ້ຍລ້ຽງ');
    expect(ok(fresh({ allowance: 0 }))).toEqual([]);
  });
  it('start date must be a real calendar date', () => {
    for (const d of ['2026-02-30', '2026-13-01', '02/11/2026', '', 'abc']) expect(ok(fresh({ startDate: d })).join(), d).toMatch('ວັນເລີ່ມ');
    expect(ok(fresh({ startDate: '2028-02-29' }))).toEqual([]); // leap day
  });
  it('bank pay needs bank and account; cash does not', () => {
    expect(ok(fresh({ bankAccount: '' })).join()).toMatch('ເລກບັນຊີ');
    expect(ok(fresh({ payMethod: 'cash', bankName: undefined, bankAccount: undefined }))).toEqual([]);
  });
  it('shift and branch must exist', () => {
    expect(ok(fresh({ shiftId: 'ghost' })).join()).toMatch('ກະ');
    expect(ok(fresh({ homeBranchId: 'ghost' })).join()).toMatch('ສາຂາ');
  });
  it('a new hire cannot arrive with powers: roles are granted separately', () => {
    expect(ok(fresh({ roles: ['employee', 'owner'] })).join()).toMatch('ບົດບາດພະນັກງານ');
    expect(ok(fresh({ roles: ['head'] as any })).join()).toMatch('ບົດບາດພະນັກງານ');
  });
});

describe('codes', () => {
  it('next code follows the highest number', () => expect(nextEmployeeCode([{ code: 'ST-003' }, { code: 'ST-041' }, { code: 'XX-099' }])).toBe('ST-042'));
  it('starts at 001 and survives odd codes', () => {
    expect(nextEmployeeCode([])).toBe('ST-001');
    expect(nextEmployeeCode([{ code: 'ST-abc' }])).toBe('ST-001');
    expect(nextEmployeeCode([{ code: 'ST-999' }])).toBe('ST-1000');
  });
});

describe('employment dates and pro-rated pay', () => {
  it('active on the boundaries, inactive outside', () => {
    const e = { startDate: '2026-11-10', endDate: '2026-11-20' };
    expect([isActiveOn(e, '2026-11-09'), isActiveOn(e, '2026-11-10'), isActiveOn(e, '2026-11-20'), isActiveOn(e, '2026-11-21')]).toEqual([false, true, true, false]);
    expect(isActiveOn({ startDate: '2026-01-01' }, '2030-01-01')).toBe(true);
  });
  it('fraction of the month employed', () => {
    expect(employedFraction({ startDate: '2020-01-01' }, 2026, 10)).toBe(1);
    expect(employedFraction({ startDate: '2026-11-01' }, 2026, 10)).toBe(1);
    expect(employedFraction({ startDate: '2026-11-16' }, 2026, 10)).toBe(15 / 30); // 16th..30th
    expect(employedFraction({ startDate: '2020-01-01', endDate: '2026-11-10' }, 2026, 10)).toBe(10 / 30);
    expect(employedFraction({ startDate: '2026-11-11', endDate: '2026-11-20' }, 2026, 10)).toBe(10 / 30);
    expect(employedFraction({ startDate: '2026-12-01' }, 2026, 10)).toBe(0);
    expect(employedFraction({ startDate: '2020-01-01', endDate: '2026-10-31' }, 2026, 10)).toBe(0);
    expect(employedFraction({ startDate: '2026-02-15' }, 2026, 1)).toBe(14 / 28); // February
  });
  const pay = (prorate?: number, extra: object = {}) => computePayslip({ baseSalary: 6_000_000, allowance: 300_000, otMinutesApproved: 0, lateDeduction: 0, unpaidLeaveDays: 0, advanceInstallment: 0, adjustments: 0, workingDaysInMonth: 26, prorate, ...extra }, S);
  it('a whole month is unchanged', () => {
    expect(pay(1)).toMatchObject({ base: 6_000_000, allowance: 300_000, prorate: 1 });
    expect(pay(undefined).net).toBe(pay(1).net);
  });
  it('a half month pays half the fixed pay, and social security follows the paid base', () => {
    const p = pay(0.5);
    expect(p).toMatchObject({ base: 3_000_000, allowance: 150_000, socialSecurity: Math.round(3_000_000 * S.ssRate) });
    expect(p.gross).toBe(3_150_000);
  });
  it('overtime and unpaid leave still use the full monthly salary for their rates', () => {
    const full = pay(1, { otMinutesApproved: 120, unpaidLeaveDays: 1 });
    const half = pay(0.5, { otMinutesApproved: 120, unpaidLeaveDays: 1 });
    expect(half.ot).toBe(full.ot);
    expect(half.unpaidLeave).toBe(full.unpaidLeave);
  });
  it('out-of-range fractions are clamped', () => {
    expect(pay(2).base).toBe(6_000_000);
    expect(pay(-1).base).toBe(0);
  });
});

describe('closing out an employee', () => {
  const kl = employees.find(e => e.id === 'e-kl')!;
  const owner = employees.find(e => e.id === 'e-owner')!;
  it('accepts a normal departure', () => expect(terminationBlock(kl, employees, '2026-11-30', 'e-owner')).toBeNull());
  it('refuses bad or early dates', () => {
    expect(terminationBlock(kl, employees, '2026-13-01', 'x')).toMatch('ບໍ່ຖືກຕ້ອງ');
    expect(terminationBlock(kl, employees, '2020-01-01', 'x')).toMatch('ກ່ອນວັນເລີ່ມ');
  });
  it('refuses closing yourself, an already closed person, or the last owner', () => {
    expect(terminationBlock(kl, employees, '2026-11-30', 'e-kl')).toMatch('ຕົນເອງ');
    expect(terminationBlock({ ...kl, endDate: '2026-10-01' }, employees, '2026-11-30', 'x')).toMatch('ຖືກປິດແລ້ວ');
    expect(terminationBlock(owner, employees, '2026-11-30', 'e-acc')).toMatch('ເຈົ້າຂອງ');
  });
  it('a second owner makes it possible to close the first', () => {
    const two = [...employees, { ...owner, id: 'o2', code: 'ST-777' }];
    expect(terminationBlock(owner, two, '2026-11-30', 'o2')).toBeNull();
    // ...but a closed second owner does not count
    const closed = [...employees, { ...owner, id: 'o2', code: 'ST-777', endDate: '2026-01-01' }];
    expect(terminationBlock(owner, closed, '2026-11-30', 'e-acc')).toMatch('ເຈົ້າຂອງ');
  });
});

describe('a closed owner does not count as an owner', () => {
  it('the only active owner cannot be demoted even if a closed owner exists', async () => {
    const { roleChangeBlock } = await import('./permissions');
    const owner = employees.find(e => e.id === 'e-owner')!;
    const list = [...employees, { ...owner, id: 'old', endDate: '2025-01-01' }];
    expect(roleChangeBlock(list, 'e-owner', ['employee'], 'e-acc')).toMatch('ເຈົ້າຂອງ');
  });
});

describe('editing a profile', () => {
  const me = employees.find(e => e.id === 'e-kl')!;
  const others = employees.filter(e => e.id !== me.id);
  const ok = { name: me.name, code: me.code, dept: me.dept, position: me.position, homeBranchId: me.homeBranchId, startDate: me.startDate, allowance: me.allowance, payMethod: me.payMethod, bankName: me.bankName };
  it('leaving it as it is is fine, including keeping the same code and name', () => expect(profileProblems(ok, others, branches, me.bankAccount)).toEqual([]));
  it('a code or a name+department already taken by someone else is refused', () => {
    expect(profileProblems({ ...ok, code: others[0].code.toLowerCase() }, others, branches, me.bankAccount).join()).toMatch('ຊ້ຳ');
    expect(profileProblems({ ...ok, name: others[0].name, dept: others[0].dept }, others, branches, me.bankAccount).join()).toMatch('ຊື່ ແລະ ພະແນກດຽວກັນ');
  });
  it('empty fields, a bad date, a missing branch, negative allowance and a bank pay with no account are each named', () => {
    const e = profileProblems({ ...ok, name: ' ', dept: '', position: '', startDate: '2026-02-31', homeBranchId: 'zzz', allowance: -1, payMethod: 'bank', bankName: '' }, others, branches, '').join(' | ');
    for (const m of ['ຊື່', 'ພະແນກ', 'ຕຳແໜ່ງ', 'ວັນເລີ່ມ', 'ສາຂາ', 'ເບ້ຍລ້ຽງ', 'ທະນາຄານ']) expect(e, m).toContain(m);
  });
});
