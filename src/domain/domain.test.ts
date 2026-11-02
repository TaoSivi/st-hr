import { describe, it, expect } from 'vitest';
import { defaultSettings } from './defaults';
import { progressiveTax, computePayslip, maxAdvance, bankCsv } from './payroll';
import { distanceMeters, evaluateScan, lateMinutes, dailySample } from './attendance';
import { accruedLeave, decide, approvalBlock, leaveDays } from './leave';
import type { Branch, LeaveRequest } from './types';

const S = defaultSettings('c1');
const shop: Branch = { id: 'b1', companyId: 'c1', name: 'ໜ້າຮ້ານ', lat: 17.9757, lng: 102.6331, radiusM: 100 };

describe('progressiveTax', () => {
  it('is zero up to the first threshold, inclusive', () => {
    expect(progressiveTax(0, S.taxBrackets)).toBe(0);
    expect(progressiveTax(1_300_000, S.taxBrackets)).toBe(0);
  });
  it('taxes only the slice above each threshold', () => {
    expect(progressiveTax(1_300_001, S.taxBrackets)).toBe(0); // 0.05 ₭ rounds to 0
    expect(progressiveTax(5_000_000, S.taxBrackets)).toBe(185_000); // 3.7M × 5%
    expect(progressiveTax(6_000_000, S.taxBrackets)).toBe(285_000); // + 1M × 10%
    expect(progressiveTax(100_000_000, S.taxBrackets)).toBe(185_000 + 1_000_000 + 1_500_000 + 8_000_000 + 8_750_000);
  });
});

describe('computePayslip', () => {
  it('adds OT, subtracts late/unpaid/SS/tax/advance and balances', () => {
    const p = computePayslip({ baseSalary: 6_240_000, allowance: 300_000, otMinutesApproved: 120, lateDeduction: 24_000,
      unpaidLeaveDays: 1, advanceInstallment: 500_000, adjustments: 0, workingDaysInMonth: 26 }, S);
    expect(p.ot).toBe(90_000); // 6.24M/208 = 30,000/h × 2h × 1.5
    expect(p.unpaidLeave).toBe(240_000);
    expect(p.socialSecurity).toBe(343_200);
    expect(p.gross).toBe(6_240_000 + 300_000 + 90_000 - 24_000 - 240_000);
    expect(p.taxable).toBe(p.gross - p.socialSecurity);
    expect(p.net).toBe(p.gross - p.socialSecurity - p.tax - 500_000);
  });
  it('adds reimbursed expenses after tax, untaxed', () => {
    const inp = { baseSalary: 5_000_000, allowance: 0, otMinutesApproved: 0, lateDeduction: 0, unpaidLeaveDays: 0, advanceInstallment: 0, adjustments: 0, workingDaysInMonth: 26 };
    const a = computePayslip(inp, S);
    const b = computePayslip({ ...inp, reimbursement: 250_000 }, S);
    expect(b.tax).toBe(a.tax);
    expect(b.net - a.net).toBe(250_000);
  });
  it('never taxes a negative income', () => {
    const p = computePayslip({ baseSalary: 1_000_000, allowance: 0, otMinutesApproved: 0, lateDeduction: 2_000_000,
      unpaidLeaveDays: 0, advanceInstallment: 0, adjustments: 0, workingDaysInMonth: 26 }, S);
    expect(p.taxable).toBe(0);
    expect(p.tax).toBe(0);
  });
});

describe('advances and exports', () => {
  it('caps advance at 50% of earned, rounded down to 1,000', () => {
    expect(maxAdvance(3_000_000, 10, 30, S)).toBe(500_000);
    expect(maxAdvance(3_100_000, 7, 31, S)).toBe(350_000);
  });
  it('CSV starts with a BOM and escapes quotes', () => {
    const csv = bankCsv([{ code: 'ST-1', name: 'ນ້ອຍ "ນ"', bank: 'LDB', account: '0101', amount: 100 }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"ນ້ອຍ ""ນ"""');
  });
});

describe('attendance', () => {
  it('measures distance', () => {
    expect(distanceMeters(shop.lat, shop.lng, shop.lat, shop.lng)).toBe(0);
    const d = distanceMeters(shop.lat, shop.lng, shop.lat + 0.001, shop.lng);
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });
  it('late counts full minutes only beyond grace', () => {
    const at = (h: number, m: number) => new Date(2026, 10, 2, h, m);
    expect(lateMinutes('06:00', at(6, 5), 5)).toBe(0);
    expect(lateMinutes('06:00', at(6, 6), 5)).toBe(6);
    expect(lateMinutes('06:00', at(5, 50), 5)).toBe(0);
  });
  it('accepts a good scan and flags each failed check', () => {
    const t = new Date('2026-11-02T13:50:00');
    expect(evaluateScan({ gps: { lat: shop.lat, lng: shop.lng }, faceScore: 92, deviceTime: t, serverTime: t }, [shop], S).ok).toBe(true);
    const bad = evaluateScan({ gps: { lat: shop.lat + 0.003, lng: shop.lng }, faceScore: 58,
      deviceTime: t, serverTime: new Date(t.getTime() + 7 * 60000) }, [shop], S);
    expect(bad.ok).toBe(false);
    expect(bad.reasons).toHaveLength(3);
    expect(evaluateScan({ gps: null, faceScore: null, deviceTime: t, serverTime: t }, [shop], S).reasons).toEqual(['ບໍ່ພົບໃບໜ້າ', 'ບໍ່ມີ GPS']);
  });
  it('clock skew exactly at the limit is accepted', () => {
    const t = new Date('2026-11-02T13:50:00');
    const v = evaluateScan({ gps: { lat: shop.lat, lng: shop.lng }, faceScore: 90, deviceTime: t, serverTime: new Date(t.getTime() + 2 * 60000) }, [shop], S);
    expect(v.ok).toBe(true);
  });
  it('daily sample is reproducible and distinct', () => {
    const ids = Array.from({ length: 40 }, (_, i) => i);
    const a = dailySample(ids, 5, '2026-11-02');
    expect(a).toEqual(dailySample(ids, 5, '2026-11-02'));
    expect(new Set(a).size).toBe(5);
    expect(dailySample([1, 2], 5, 'x')).toHaveLength(2);
  });
});

describe('leave', () => {
  it('accrues monthly from the later of hire date and 1 Jan', () => {
    expect(accruedLeave('monthly', '2020-01-01', '2026-11-02', 15)).toBe(12.5); // 10 months
    expect(accruedLeave('monthly', '2026-09-01', '2026-11-02', 15)).toBe(2.5);
    expect(accruedLeave('monthly', '2026-12-01', '2026-11-02', 15)).toBe(0);
  });
  it('year-start and anniversary methods', () => {
    expect(accruedLeave('yearStart', '2020-05-01', '2026-03-01', 15)).toBe(15);
    expect(accruedLeave('yearStart', '2026-07-01', '2026-08-01', 15)).toBe(7.5);
    expect(accruedLeave('anniversary', '2025-12-01', '2026-11-02', 15)).toBe(0);
    expect(accruedLeave('anniversary', '2025-11-02', '2026-11-02', 15)).toBe(15);
  });
  it('counts working days, skipping day off and holidays', () => {
    expect(leaveDays('2026-11-02', '2026-11-08', [0], ['2026-11-04'])).toBe(5);
  });

  const now = new Date('2026-11-02T10:00:00');
  const req: LeaveRequest = { id: 'l1', companyId: 'c1', employeeId: 'e1', type: 'annual', from: '2026-11-04', to: '2026-11-06',
    days: 3, reason: '', createdAt: '2026-11-02T09:00:00', approvals: [], status: 'pending' };
  const head = { id: 'h1', roles: ['head' as const] };
  const head2 = { id: 'h2', roles: ['head' as const] };

  it('blocks self-approval and non-approvers', () => {
    expect(approvalBlock(req, { id: 'e1', roles: ['head'] }, S, now)).toMatch('ຕົນເອງ');
    expect(approvalBlock(req, { id: 'x', roles: ['accountant'] }, S, now)).toMatch('ບໍ່ມີສິດ');
    expect(approvalBlock(req, head, S, now)).toBeNull();
  });
  it('approves after N distinct approvals; same person cannot count twice', () => {
    const s2 = { ...S, leaveApproversRequired: 2 as const };
    const r1 = decide(req, head, 'approve', s2, now);
    expect(r1.status).toBe('pending');
    expect(() => decide(r1, head, 'approve', s2, now)).toThrow();
    expect(decide(r1, head2, 'approve', s2, now).status).toBe('approved');
  });
  it('reject needs a reason and ends the request', () => {
    expect(() => decide(req, head, 'reject', S, now)).toThrow();
    expect(decide(req, head, 'reject', S, now, 'ຄົນບໍ່ພໍ').status).toBe('rejected');
  });
  it('escalates to owner after the configured hours', () => {
    const s = { ...S, leaveApproverRoles: ['head' as const] };
    const owner = { id: 'o1', roles: ['owner' as const] };
    expect(approvalBlock(req, owner, s, now)).toMatch('ບໍ່ມີສິດ');
    expect(approvalBlock(req, owner, s, new Date('2026-11-03T09:00:00'))).toBeNull();
  });
});
