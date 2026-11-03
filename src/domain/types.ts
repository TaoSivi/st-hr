// Every record carries companyId so one deployment can serve many companies later.

export type Role = 'employee' | 'head' | 'accountant' | 'owner' | 'auditor';

export interface Branch {
  id: string;
  companyId: string;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
}

export interface Shift {
  id: string;
  name: string;
  start: string; // 'HH:MM'
  end: string;
  breakStart: string;
  breakEnd: string;
  allowance?: number; // ກີບ paid for each shift worked (e.g. night-shift allowance); taxable
  flexible?: boolean; // office staff with no fixed hours: no lateness, any clock-in time; start/end/break are then only placeholders
  dailyHours?: number; // flexible shift: expected paid hours per working day (used for part-day leave and the short-day note)
}

export type PayMethod = 'bank' | 'cash';

export interface Employee {
  id: string;
  companyId: string;
  code: string; // ST-012
  name: string;
  dept: string;
  position: string;
  roles: Role[];
  homeBranchId: string;
  shiftId: string;
  dayOff?: number[]; // weekly days off, 0 = Sunday; default [0]
  headOf?: string[]; // departments a head manages ('*' = all); default: own department
  startDate: string; // YYYY-MM-DD
  endDate?: string;
  baseSalary: number;
  allowance: number;
  payMethod: PayMethod;
  bankName?: string;
  bankAccount?: string;
  faceEnrolled?: number[]; // face descriptor, facing the camera (demo: stored locally only)
  facePoses?: number[][]; // descriptors turned slightly to each side; a scan is matched against all of them
  faceReenroll?: boolean; // a manager approved taking the face again; the next clock-in does it
  faceConsentAt?: string;
  pinHash?: string; // salted SHA-256 of the sign-in PIN; the PIN itself is never stored
  pinSalt?: string;
  pinMustChange?: boolean; // set by a PIN reset: the person picks their own PIN at the next sign-in
  photo?: string; // profile photo (small square JPEG data URL), shown on the clock screen and the profile
  deviceId?: string; // the phone this account is bound to; a scan from another phone goes to review
  deviceBoundAt?: string;
}

export type ScanKind = 'in' | 'breakStart' | 'breakEnd' | 'out';
export type ScanStatus = 'ok' | 'pending' | 'approved' | 'rejected';

export interface ScanRecord {
  id: string;
  companyId: string;
  employeeId: string;
  kind: ScanKind;
  deviceTime: string; // ISO from phone
  serverTime?: string; // ISO when the server received it (offline scans arrive later)
  branchId?: string;
  lat?: number;
  lng?: number;
  distanceM?: number;
  faceScore?: number; // 0..100
  photo?: string; // data URL in demo; object storage key in production
  manual?: boolean; // branch chosen by hand, so branchId is the employee's claim, not GPS
  status: ScanStatus;
  reasons: string[];
  reviewedBy?: string;
  reviewNote?: string;
  offline?: boolean;
  deviceId?: string; // the phone the scan was made on
}

export type LeaveType = 'annual' | 'sick' | 'personal' | 'unpaid' | 'comp'; // comp = compensatory day off for working a public holiday

export interface LeaveRequest {
  id: string;
  companyId: string;
  employeeId: string;
  type: LeaveType;
  from: string; // YYYY-MM-DD
  to: string;
  days: number; // 0.5 for half a day, hours ÷ paid shift hours for hourly leave
  part?: 'am' | 'pm' | 'hours'; // set for part-day leave (single day only)
  hours?: number;
  reason: string;
  createdAt: string;
  approvals: { by: string; at: string; decision: 'approve' | 'reject'; note?: string }[];
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  escalatedAt?: string;
}

export interface OtRequest {
  id: string;
  companyId: string;
  employeeId: string;
  date: string;
  minutes: number;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
}

export interface Advance {
  id: string;
  companyId: string;
  employeeId: string;
  amount: number;
  installments: number;
  remaining: number;
  status: 'pending' | 'approved' | 'rejected';
  approvals: { by: string; at: string; decision: 'approve' | 'reject' }[];
  createdAt: string;
}

export interface TaxBracket {
  upTo: number | null; // null = no upper limit
  rate: number; // 0.05 = 5%
}

/** Approvals whose approvers the company can choose. */
export type ApprovalKey = import('./requests').RequestKind | 'scan.review' | 'advance.decide';
/** Self-service menus a company can switch off for everyone. */
export type SelfMenu = 'directory' | 'reports' | 'clockFix' | 'shift' | 'schedule' | 'ot' | 'expense' | 'certificate' | 'pay' | 'advance';

export type AccrualMethod = 'monthly' | 'yearStart' | 'anniversary';

export interface Settings {
  companyId: string;
  graceMinutes: number;
  lateDeductPerMinute: number; // ກີບ / ນາທີ
  otRate: number; // multiplier on hourly wage
  workHoursPerMonth: number;
  ssRate: number; // employee social security, on base salary
  taxBrackets: TaxBracket[];
  maxClockSkewMin: number;
  faceMinScore: number;
  leaveDaysPerYear: number;
  leaveAccrual: AccrualMethod;
  leaveCarryOverMax: number;
  leaveApproversRequired: 1 | 2;
  leaveApproverRoles: Role[];
  escalateAfterHours: number;
  makerChecker: boolean;
  advanceMaxPctOfEarned: number;
  photoRetentionDays: number;
  randomSamplePerDay: number;
  holidays: string[]; // YYYY-MM-DD public holidays, entered by HR each year
  leavePayoutOnExit: boolean; // pay unused annual / compensatory leave days when someone leaves
  compLeaveExpiryDays: number; // compensatory days off expire this long after the holiday worked; 0 = never
  approverRoles: Partial<Record<ApprovalKey, Role[]>>; // who may approve each kind of request, when the company changed the default; the owner always may
  employeeMenus: Partial<Record<SelfMenu, boolean>>; // self-service menus the company switched off (false); missing = on
}

export interface AuditEntry {
  id: string;
  companyId: string;
  at: string;
  by: string;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}
