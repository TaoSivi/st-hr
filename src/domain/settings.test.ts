import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defaultSettings } from './defaults';
import { dailySample, evaluateScan, lateMinutes, purgeExpiredPhotos } from './attendance';
import { changeNeedsSecondPerson, computePayslip, lateDeductionAmount, maxAdvance, payrollLockBlock, progressiveTax } from './payroll';
import { accruedLeave, annualLeaveBalance, approvalBlock, decide, isEscalated, leaveDays } from './leave';
import { dayStatus } from './day';
import { compBalance } from './comp';
import { approvalAccess, canViewPage } from './permissions';
import { ASSIGNABLE_APPROVER_ROLES, validateSettings } from './settingsCheck';
import { seed } from '../data/seed';
import type { Branch, LeaveRequest, ScanRecord, Settings } from './types';

const S = defaultSettings('c1');
type Key = Exclude<keyof Settings, 'companyId'>;
const NOW = new Date('2026-11-02T10:00:00');
const shop: Branch = { id: 'b', companyId: 'c1', name: 'ຮ້ານ', lat: 17.9757, lng: 102.6331, radiusM: 100 };
const slip = (s: Settings, over: object = {}) => computePayslip({ baseSalary: 5_000_000, allowance: 0, otMinutesApproved: 0, lateDeduction: 0, unpaidLeaveDays: 0, advanceInstallment: 0, adjustments: 0, workingDaysInMonth: 26, ...over }, s);
const leave = (over: Partial<LeaveRequest> = {}): LeaveRequest => ({ id: 'l', companyId: 'c1', employeeId: 'e1', type: 'annual', from: '2026-11-04', to: '2026-11-05', days: 2, reason: 'x', createdAt: '2026-11-02T09:00:00', approvals: [], status: 'pending', ...over });

/**
 * One behavioural check per setting: change it and see the system change.
 * It is a Record over every key, so adding a setting without a check is a compile error,
 * and a setting that does nothing fails here.
 */
const EFFECT: Record<Key, () => void> = {
  graceMinutes: () => {
    const at = new Date(2026, 10, 2, 8, 10);
    expect(lateMinutes('08:00', at, 5)).toBe(10);
    expect(lateMinutes('08:00', at, 9)).toBe(10);
    expect(lateMinutes('08:00', at, 10)).toBe(0); // exactly the limit is on time
    expect(lateMinutes('08:00', at, 30)).toBe(0);
  },
  lateDeductPerMinute: () => {
    expect(lateDeductionAmount(10, { ...S, lateDeductPerMinute: 500 })).toBe(5000);
    expect(lateDeductionAmount(10, { ...S, lateDeductPerMinute: 2000 })).toBe(20000);
  },
  otRate: () => {
    const ot = (rate: number) => slip({ ...S, otRate: rate }, { otMinutesApproved: 120 }).ot;
    expect(ot(2)).toBeGreaterThan(ot(1.5));
    expect(ot(1.5)).toBe(Math.round((2 * (5_000_000 / 208)) * 1.5));
  },
  workHoursPerMonth: () => {
    const ot = (h: number) => slip({ ...S, workHoursPerMonth: h }, { otMinutesApproved: 60 }).ot;
    expect(ot(160)).toBeGreaterThan(ot(208));
    expect(ot(160)).toBe(Math.round(5_000_000 / 160 * 1.5));
  },
  ssRate: () => {
    expect(slip({ ...S, ssRate: 0.055 }).socialSecurity).toBe(275_000);
    expect(slip({ ...S, ssRate: 0.07 }).socialSecurity).toBe(350_000);
    expect(slip({ ...S, ssRate: 0 }).socialSecurity).toBe(0);
  },
  taxBrackets: () => {
    const flat = [{ upTo: null, rate: 0.1 }];
    expect(progressiveTax(1_000_000, flat)).toBe(100_000);
    expect(progressiveTax(1_000_000, [{ upTo: 500_000, rate: 0 }, { upTo: null, rate: 0.2 }])).toBe(100_000);
    expect(slip({ ...S, taxBrackets: flat }).tax).toBeGreaterThan(slip(S).tax);
  },
  maxClockSkewMin: () => {
    const t = new Date('2026-11-02T13:50:00');
    const run = (limit: number) => evaluateScan({ gps: { lat: shop.lat, lng: shop.lng }, faceScore: 95, deviceTime: t, serverTime: new Date(t.getTime() + 5 * 60000) }, [shop], { ...S, maxClockSkewMin: limit });
    expect(run(2).ok).toBe(false);
    expect(run(5).ok).toBe(true);
  },
  faceMinScore: () => {
    const t = new Date();
    const run = (min: number) => evaluateScan({ gps: { lat: shop.lat, lng: shop.lng }, faceScore: 75, deviceTime: t, serverTime: t }, [shop], { ...S, faceMinScore: min });
    expect(run(70).ok).toBe(true);
    expect(run(80).ok).toBe(false);
  },
  leaveDaysPerYear: () => {
    expect(accruedLeave('yearStart', '2020-01-01', '2026-11-02', 15)).toBe(15);
    expect(accruedLeave('yearStart', '2020-01-01', '2026-11-02', 20)).toBe(20);
    expect(annualLeaveBalance({ startDate: '2020-01-01', asOf: '2026-11-02', s: { ...S, leaveDaysPerYear: 24, leaveCarryOverMax: 0 }, usedInYear: () => 0 }).earned).toBe(20); // 10 of 12 months
  },
  leaveAccrual: () => {
    const left = (m: Settings['leaveAccrual']) => annualLeaveBalance({ startDate: '2025-12-01', asOf: '2026-11-02', s: { ...S, leaveAccrual: m, leaveCarryOverMax: 0 }, usedInYear: () => 0 }).left;
    expect(left('monthly')).toBe(12.5); // Jan–Oct = 10 full months × 15/12
    expect(left('yearStart')).toBe(15);
    expect(left('anniversary')).toBe(0);
  },
  leaveCarryOverMax: () => {
    const bal = (max: number) => annualLeaveBalance({ startDate: '2024-01-01', asOf: '2026-01-31', s: { ...S, leaveCarryOverMax: max, leaveAccrual: 'yearStart' }, usedInYear: y => (y === 2025 ? 3 : 0) });
    expect(bal(0).carried).toBe(0);
    expect(bal(5).carried).toBe(5); // 2025 ended with 17 unused (15 + 5 − 3), only 5 may come over
    expect(bal(30).carried).toBe(27); // 2024: 15 → carried 15; 2025: 15 + 15 − 3 = 27, all under the cap
    expect(bal(30).left).toBe(42);
    expect(bal(5).left).toBe(20);
  },
  leaveApproversRequired: () => {
    const approver = { id: 'h1', roles: ['head' as const] };
    expect(decide(leave(), approver, 'approve', { ...S, leaveApproversRequired: 1 }, NOW).status).toBe('approved');
    expect(decide(leave(), approver, 'approve', { ...S, leaveApproversRequired: 2 }, NOW).status).toBe('pending');
  },
  leaveApproverRoles: () => {
    const acc = { id: 'a', roles: ['accountant' as const] };
    expect(approvalBlock(leave(), acc, S, NOW)).not.toBeNull();
    expect(approvalBlock(leave(), acc, { ...S, leaveApproverRoles: ['accountant'] }, NOW)).toBeNull();
    expect(approvalAccess(['accountant'], 'leave', { leaveApproverRoles: ['accountant'] })).toBe('act');
    expect(canViewPage(['accountant'], 'leave', { leaveApproverRoles: ['accountant'] })).toBe(true);
  },
  escalateAfterHours: () => {
    const req = leave({ createdAt: '2026-11-02T08:00:00' }); // 2 hours before NOW
    expect(isEscalated(req, { ...S, escalateAfterHours: 3 }, NOW)).toBe(false);
    expect(isEscalated(req, { ...S, escalateAfterHours: 2 }, NOW)).toBe(true);
    expect(isEscalated(req, { ...S, escalateAfterHours: 1 }, NOW)).toBe(true);
  },
  makerChecker: () => {
    expect(payrollLockBlock('acc', 'acc', { makerChecker: true })).not.toBeNull();
    expect(payrollLockBlock('acc', 'acc', { makerChecker: false })).toBeNull();
    expect(payrollLockBlock('acc', 'owner', { makerChecker: true })).toBeNull();
    expect(changeNeedsSecondPerson({ makerChecker: true })).toBe(true);
    expect(changeNeedsSecondPerson({ makerChecker: false })).toBe(false);
  },
  advanceMaxPctOfEarned: () => {
    expect(maxAdvance(3_000_000, 10, 30, { ...S, advanceMaxPctOfEarned: 0.5 })).toBe(500_000);
    expect(maxAdvance(3_000_000, 10, 30, { ...S, advanceMaxPctOfEarned: 1 })).toBe(1_000_000);
    expect(maxAdvance(3_000_000, 10, 30, { ...S, advanceMaxPctOfEarned: 0 })).toBe(0);
  },
  photoRetentionDays: () => {
    const old = { id: 'o', deviceTime: '2026-01-01T08:00:00Z', photo: 'data:x' } as ScanRecord;
    const recent = { id: 'r', deviceTime: '2026-10-25T08:00:00Z', photo: 'data:y' } as ScanRecord;
    const run = (days: number) => purgeExpiredPhotos([old, recent], days, NOW);
    expect(run(365).purged).toBe(0);
    expect(run(30).purged).toBe(1);
    expect(run(30).scans[0].photo).toBeUndefined();
    expect(run(30).scans[1].photo).toBe('data:y');
    expect(run(1).purged).toBe(2);
  },
  randomSamplePerDay: () => {
    const ids = Array.from({ length: 50 }, (_, i) => i);
    expect(dailySample(ids, 3, 'd')).toHaveLength(3);
    expect(dailySample(ids, 9, 'd')).toHaveLength(9);
    expect(dailySample(ids, 0, 'd')).toHaveLength(0);
  },
  holidays: () => {
    const base = { date: '2026-11-03', today: '2026-11-05', startDate: '2026-01-01', shiftStart: '08:00', graceMinutes: 5, dayOff: [0], scans: [], leaves: [] };
    expect(dayStatus({ ...base, holidays: [] })).toBe('absent');
    expect(dayStatus({ ...base, holidays: ['2026-11-03'] })).toBe('holiday');
    expect(leaveDays('2026-11-02', '2026-11-06', [0], [])).toBe(5);
    expect(leaveDays('2026-11-02', '2026-11-06', [0], ['2026-11-04'])).toBe(4);
  },
  compLeaveExpiryDays: () => {
    const earned = [{ date: '2026-08-01', days: 1 }];
    const left = (expiryDays: number) => compBalance({ earned, used: [], asOf: '2026-11-02', expiryDays }).left;
    expect(left(0)).toBe(1); // never expires
    expect(left(90)).toBe(0); // 1 Aug + 90 days = 30 Oct, already gone
    expect(left(120)).toBe(1);
  }
};

describe('every Admin setting really changes behaviour', () => {
  for (const key of Object.keys(EFFECT) as Key[]) it(key, EFFECT[key]);
  it('there is a check for every setting and none for a setting that no longer exists', () => {
    expect(Object.keys(EFFECT).sort()).toEqual(Object.keys(S).filter(k => k !== 'companyId').sort());
  });
});

// ------------------------- the Admin screen against the same list of settings -------------------------
const src = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
const settingsPage = (() => { const t = src('ui/ManagerApp.tsx'); return t.slice(t.indexOf('function SettingsPage'), t.indexOf('function Audit')); })();

describe('the Admin settings screen matches the settings', () => {
  for (const key of Object.keys(EFFECT) as Key[]) {
    it(`${key} can be edited on the screen`, () => expect(settingsPage, key).toMatch(new RegExp(`\\b${key}\\b`)));
  }
  it('branch radius, which GPS checks depend on, can be edited too', () => expect(settingsPage).toMatch(/radiusM/));
  it('a save is refused while the form is invalid, and needs the settings.edit permission', () => {
    expect(settingsPage).toMatch(/errors\.length/);
    expect(settingsPage).toMatch(/canDo\(me\.roles, 'settings\.edit'\)/);
  });
  it('texts that quote a configurable value read it from Settings instead of hard-coding it', () => {
    const consent = src('ui/EmployeeApp.tsx');
    expect(consent).toMatch(/retentionLabel\(settings\.photoRetentionDays\)/);
    expect(consent).not.toMatch(/ເກັບຮູບຕອນສະແກນໄວ້ 1 ປີ/);
    expect(src('ui/Pages.tsx')).toMatch(/retentionLabel\(settings\.photoRetentionDays\)/);
    expect(consent).toMatch(/leaveDays\([^)]*settings\.holidays/); // leave days skip public holidays
  });
  it('randomSamplePerDay feeds the daily sample on the review page', () => {
    expect(src('ui/ManagerApp.tsx')).toMatch(/dailySample\(.*hr\.settings\.randomSamplePerDay/);
  });
});

describe('validateSettings blocks inconsistent settings', () => {
  const bad = (patch: Partial<Settings>) => validateSettings({ ...S, ...patch });
  it('the shipped defaults are consistent', () => expect(validateSettings(S)).toEqual([]));
  it('rejects out-of-range numbers and NaN (a cleared input)', () => {
    for (const patch of [{ graceMinutes: -1 }, { graceMinutes: NaN }, { faceMinScore: 0 }, { faceMinScore: 101 }, { ssRate: 0.9 }, { ssRate: -0.1 }, { otRate: 0.5 },
      { workHoursPerMonth: 0 }, { escalateAfterHours: 0 }, { advanceMaxPctOfEarned: 1.5 }, { photoRetentionDays: 0 }, { leaveDaysPerYear: -5 }, { maxClockSkewMin: 61 }] as Partial<Settings>[]) {
      expect(bad(patch).length, JSON.stringify(patch)).toBeGreaterThan(0);
    }
  });
  it('accepts the boundaries themselves', () => {
    expect(bad({ graceMinutes: 0, faceMinScore: 100, ssRate: 0, advanceMaxPctOfEarned: 1, otRate: 1, leaveDaysPerYear: 0 })).toEqual([]);
  });
  it('tax brackets must rise, end with an open bracket and keep rates in range', () => {
    expect(bad({ taxBrackets: [{ upTo: 5_000_000, rate: 0.1 }, { upTo: 1_000_000, rate: 0.2 }, { upTo: null, rate: 0.3 }] }).join()).toMatch('ສູງກວ່າຂັ້ນກ່ອນ');
    expect(bad({ taxBrackets: [{ upTo: 1_000_000, rate: 0.1 }] }).join()).toMatch('ຂຶ້ນໄປ');
    expect(bad({ taxBrackets: [{ upTo: null, rate: 0.1 }, { upTo: null, rate: 0.2 }] }).length).toBeGreaterThan(0);
    expect(bad({ taxBrackets: [{ upTo: null, rate: 1.5 }] }).join()).toMatch('ອັດຕາ');
    expect(bad({ taxBrackets: [] }).length).toBeGreaterThan(0);
    expect(bad({ taxBrackets: [{ upTo: null, rate: 0.1 }] })).toEqual([]);
  });
  it('approver roles: at least one, and never the auditor or the plain employee', () => {
    expect(bad({ leaveApproverRoles: [] }).length).toBeGreaterThan(0);
    expect(bad({ leaveApproverRoles: ['auditor'] }).join()).toMatch('ອະນຸມັດບໍ່ໄດ້');
    expect(bad({ leaveApproverRoles: ['head', 'employee'] }).length).toBeGreaterThan(0);
    for (const r of ASSIGNABLE_APPROVER_ROLES) expect(bad({ leaveApproverRoles: [r] })).toEqual([]);
    expect(ASSIGNABLE_APPROVER_ROLES).not.toContain('auditor');
    expect(ASSIGNABLE_APPROVER_ROLES).not.toContain('employee');
  });
  it('approvers required is 1 or 2 only', () => {
    expect(bad({ leaveApproversRequired: 3 as any }).length).toBeGreaterThan(0);
    expect(bad({ leaveApproversRequired: 0 as any }).length).toBeGreaterThan(0);
  });
  it('holidays: real dates, no duplicates', () => {
    expect(bad({ holidays: ['2026-13-45'] }).join()).toMatch('ບໍ່ຖືກຕ້ອງ');
    expect(bad({ holidays: ['02/11/2026'] }).length).toBeGreaterThan(0);
    expect(bad({ holidays: ['2026-12-02', '2026-12-02'] }).join()).toMatch('ຊ້ຳ');
    expect(bad({ holidays: ['2026-12-02', '2026-04-14'] })).toEqual([]);
  });
});

describe('seed data agrees with the settings it relies on', () => {
  it('the default settings are what a fresh demo stores', async () => {
    const map = new Map<string, string>();
    (globalThis as any).localStorage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
    const { LocalStore } = await import('../data/store');
    const store = new LocalStore('demo-co');
    await seed(store);
    const [stored] = await store.list<Settings & { id: string }>('settings');
    const { id: _id, ...rest } = stored;
    expect(rest).toEqual({ ...defaultSettings('demo-co') });
    expect(validateSettings(rest as Settings)).toEqual([]);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(f => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
}
describe('housekeeping', () => {
  it('no source file reads a setting that is missing from Settings', () => {
    const known = new Set(Object.keys(S));
    for (const f of walk(join(__dirname, '..')).filter(p => /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p))) {
      // a quote or word character before "settings." means a string such as 'settings.edit' or another object, not the Settings value
      for (const m of readFileSync(f, 'utf8').matchAll(/(?<!['"\w])(?:hr\.)?settings\.([A-Za-z]+)\b/g)) {
        expect(known.has(m[1]), `${f}: settings.${m[1]}`).toBe(true);
      }
    }
  });
});
