import type { Settings } from './types';

// ⚠️ Tax brackets and rates are SAMPLE values. Verify against current Lao law before real use;
// every company changes them in Settings, nothing here is hard-wired into the calculation.
export const defaultSettings = (companyId: string): Settings => ({
  companyId,
  graceMinutes: 5,
  lateDeductPerMinute: 1000,
  otRate: 1.5,
  workHoursPerMonth: 208,
  ssRate: 0.055,
  taxBrackets: [
    { upTo: 1_300_000, rate: 0 },
    { upTo: 5_000_000, rate: 0.05 },
    { upTo: 15_000_000, rate: 0.1 },
    { upTo: 25_000_000, rate: 0.15 },
    { upTo: 65_000_000, rate: 0.2 },
    { upTo: null, rate: 0.25 }
  ],
  maxClockSkewMin: 2,
  faceMinScore: 70,
  leaveDaysPerYear: 15,
  sickDaysPerYear: 0,
  personalDaysPerYear: 0,
  leaveAccrual: 'monthly',
  leaveCarryOverMax: 5,
  leaveApproversRequired: 1,
  leaveApproverRoles: ['head', 'owner'],
  escalateAfterHours: 24,
  makerChecker: true,
  advanceMaxPctOfEarned: 0.5,
  photoRetentionDays: 365,
  randomSamplePerDay: 5,
  holidays: [],
  leavePayoutOnExit: true,
  compLeaveExpiryDays: 90,
  approverRoles: {},
  employeeMenus: {},
  roleRights: {}
});
