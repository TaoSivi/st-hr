import { describe, expect, it } from 'vitest';
import { finalSettlement } from './settlement';
import { planSettlement, settlementItem } from '../app/settlement';
import { payItemTotals, validatePayItem } from './payItems';
import { defaultSettings } from './defaults';
import { branches, employees, shifts } from '../data/seed';
import type { LeaveRequest } from './types';

describe('finalSettlement', () => {
  const run = (over: object = {}) => finalSettlement({ baseSalary: 2_600_000, annualLeft: 5, compLeft: 0, workingDaysInMonth: 26, payOut: true, ...over });
  it('pays unused days at one day of salary each', () => expect(run()).toEqual({ dailyRate: 100_000, annualDays: 5, compDays: 0, amount: 500_000 }));
  it('adds compensatory days to the annual days', () => expect(run({ compLeft: 1.5 }).amount).toBe(650_000));
  it('half days are paid in halves', () => expect(run({ annualLeft: 2.5 }).amount).toBe(250_000));
  it('the setting turns the payout off but still reports the days', () => expect(run({ payOut: false })).toMatchObject({ annualDays: 5, amount: 0 }));
  it('overdrawn leave is never charged back here', () => expect(run({ annualLeft: -3 })).toMatchObject({ annualDays: 0, amount: 0 }));
  it('no leave left, or odd inputs, pay nothing', () => {
    expect(run({ annualLeft: 0 }).amount).toBe(0);
    expect(run({ workingDaysInMonth: 0 })).toMatchObject({ dailyRate: 0, amount: 0 });
  });
  it('rounds to whole kip', () => expect(finalSettlement({ baseSalary: 1_000_000, annualLeft: 1, compLeft: 0, workingDaysInMonth: 26, payOut: true }).amount).toBe(38_462));
});

describe('planSettlement and settlementItem from stored data', () => {
  const kl = { ...employees.find(e => e.id === 'e-kl')!, startDate: '2024-01-01', baseSalary: 2_600_000 };
  const NOW = new Date(2026, 10, 2);
  const settings = { ...defaultSettings('c1'), leaveDaysPerYear: 12, leaveAccrual: 'yearStart' as const, leaveCarryOverMax: 0 };
  const annual = (days: number, status: LeaveRequest['status'] = 'approved'): LeaveRequest => ({ id: 'l' + Math.random(), companyId: 'c1', employeeId: 'e-kl', type: 'annual', from: '2026-03-02', to: '2026-03-06', days, reason: 'x', createdAt: '2026-02-01T09:00:00', approvals: [], status });
  const data = (leaves: LeaveRequest[] = [], over: object = {}, s = settings) => ({ employees: [kl], branches, scans: [], leaves, ots: [], advances: [], payrollRuns: [], requests: [], overrides: [], shifts, notifications: [], payItems: [], settings: s, ...over }) as any;

  it('owes the leave not taken this year', () => {
    const plan = planSettlement(data([annual(5)]), kl, '2026-11-30', NOW);
    expect(plan).toMatchObject({ annualDays: 7, amount: 700_000, month: '2026-11' });
  });
  it('pending leave is reserved, rejected leave is not', () => {
    expect(planSettlement(data([annual(5, 'pending')]), kl, '2026-11-30', NOW).annualDays).toBe(7);
    expect(planSettlement(data([annual(5, 'rejected')]), kl, '2026-11-30', NOW).annualDays).toBe(12);
  });
  it('pays with the last month worked, or the current month when that one is locked, or nothing when both are locked', () => {
    const locked = (id: string) => ({ id, companyId: 'c1', status: 'locked' as const, lateConfirmed: [] });
    expect(planSettlement(data([], { payrollRuns: [locked('2026-10')] }), kl, '2026-10-31', NOW).month).toBe('2026-11');
    expect(planSettlement(data([], { payrollRuns: [locked('2026-10'), locked('2026-11')] }), kl, '2026-10-31', NOW).month).toBeNull();
  });
  it('makes a taxable "other" pay item, pending under the two-person rule, approved when it is off', () => {
    const d = data([annual(5)]);
    const item = settlementItem(d, kl, planSettlement(d, kl, '2026-11-30', NOW), 'e-owner', NOW)!;
    expect(item).toMatchObject({ employeeId: 'e-kl', month: '2026-11', kind: 'other', amount: 700_000, taxable: true, status: 'pending', by: 'e-owner' });
    expect(item.label).toMatch('7 ມື້');
    const off = data([annual(5)], {}, { ...settings, makerChecker: false });
    expect(settlementItem(off, kl, planSettlement(off, kl, '2026-11-30', NOW), 'e-owner', NOW)!.status).toBe('approved');
  });
  it('is not created when nothing is owed, when the setting is off, or when no month is open', () => {
    const none = data([annual(12)]);
    expect(settlementItem(none, kl, planSettlement(none, kl, '2026-11-30', NOW), 'x', NOW)).toBeNull();
    const off = data([], {}, { ...settings, leavePayoutOnExit: false });
    expect(settlementItem(off, kl, planSettlement(off, kl, '2026-11-30', NOW), 'x', NOW)).toBeNull();
    const locked = data([], { payrollRuns: ['2026-10', '2026-11'].map(id => ({ id, companyId: 'c1', status: 'locked', lateConfirmed: [] })) });
    expect(settlementItem(locked, kl, planSettlement(locked, kl, '2026-10-31', NOW), 'x', NOW)).toBeNull();
  });
  it('once approved it is paid in that month like any pay item', () => {
    const d = data([annual(5)]);
    const item = { ...settlementItem(d, kl, planSettlement(d, kl, '2026-11-30', NOW), 'e-owner', NOW)!, status: 'approved' as const };
    expect(payItemTotals([item], 'e-kl', '2026-11').taxableOther).toBe(700_000);
    expect(validatePayItem(item, { employeeExists: true, employedInMonth: true, periodLocked: false })).toEqual([]);
  });
});
