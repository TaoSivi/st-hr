import type { Role, Settings } from './types';
import { EDITABLE_ROLES, isRightKey } from './rights';

/** Roles Admin may name as leave approvers. The auditor reads, the plain employee requests; neither decides. */
export const ASSIGNABLE_APPROVER_ROLES: Role[] = ['head', 'accountant', 'owner'];

/** Everything wrong with a settings object, in Lao, so the form can block the save. Empty list = consistent. */
export function validateSettings(s: Settings): string[] {
  const e: string[] = [];
  const num = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  if (!num(s.graceMinutes, 0, 120)) e.push('ຜ່ອນຜັນມາຊ້າ ຕ້ອງຢູ່ລະຫວ່າງ 0–120 ນາທີ');
  if (!num(s.lateDeductPerMinute, 0, 1_000_000)) e.push('ຫັກມາຊ້າ ຕ້ອງບໍ່ຕິດລົບ');
  if (!num(s.otRate, 1, 5)) e.push('ອັດຕາ OT ຕ້ອງຢູ່ລະຫວ່າງ 1–5 ເທົ່າ');
  if (!num(s.workHoursPerMonth, 1, 744)) e.push('ຊົ່ວໂມງວຽກ/ເດືອນ ຕ້ອງຢູ່ລະຫວ່າງ 1–744');
  if (!num(s.ssRate, 0, 0.5)) e.push('ປະກັນສັງຄົມ ຕ້ອງຢູ່ລະຫວ່າງ 0–50%');
  if (!num(s.maxClockSkewMin, 0, 60)) e.push('ໂມງຕ່າງໄດ້ສູງສຸດ ຕ້ອງຢູ່ລະຫວ່າງ 0–60 ນາທີ');
  if (!num(s.faceMinScore, 1, 100)) e.push('ໃບໜ້າຂັ້ນຕ່ຳ ຕ້ອງຢູ່ລະຫວ່າງ 1–100%');
  if (!num(s.leaveDaysPerYear, 0, 366)) e.push('ມື້ລາພັກ/ປີ ຕ້ອງຢູ່ລະຫວ່າງ 0–366');
  if (!num(s.leaveCarryOverMax, 0, 366)) e.push('ຍົກໄປປີໜ້າ ຕ້ອງບໍ່ຕິດລົບ');
  if (!num(s.escalateAfterHours, 1, 720)) e.push('ສົ່ງຫາເຈົ້າຂອງຫຼັງ ຕ້ອງຢູ່ລະຫວ່າງ 1–720 ຊົ່ວໂມງ');
  if (!num(s.advanceMaxPctOfEarned, 0, 1)) e.push('ເບີກສູງສຸດ ຕ້ອງຢູ່ລະຫວ່າງ 0–100% ຂອງເງິນທີ່ໄດ້ແລ້ວ');
  if (!num(s.photoRetentionDays, 1, 3650)) e.push('ເກັບຮູບ ຕ້ອງຢູ່ລະຫວ່າງ 1–3650 ມື້');
  if (!num(s.randomSamplePerDay, 0, 100)) e.push('ສຸ່ມກວດຕໍ່ມື້ ຕ້ອງຢູ່ລະຫວ່າງ 0–100');
  if (typeof s.leavePayoutOnExit !== 'boolean') e.push('ການຈ່າຍວັນລາພັກຄ້າງເມື່ອອອກ ຕ້ອງເລືອກ ເປີດ ຫຼື ປິດ');
  if (!num(s.compLeaveExpiryDays, 0, 3650)) e.push('ວັນພັກຊົດເຊີຍໝົດອາຍຸ ຕ້ອງຢູ່ລະຫວ່າງ 0–3650 ມື້ (0 = ບໍ່ໝົດ)');
  if (s.leaveApproversRequired !== 1 && s.leaveApproversRequired !== 2) e.push('ຈຳນວນຄົນອະນຸມັດ ຕ້ອງເປັນ 1 ຫຼື 2');
  if (!s.leaveApproverRoles.length) e.push('ຕ້ອງເລືອກຜູ້ອະນຸມັດການລາຢ່າງໜ້ອຍ 1 ບົດບາດ');
  if (s.leaveApproverRoles.some(r => !ASSIGNABLE_APPROVER_ROLES.includes(r))) e.push('ຜູ້ກວດສອບ ແລະ ພະນັກງານທົ່ວໄປ ອະນຸມັດບໍ່ໄດ້');
  // the auditor stays independent and a plain employee never approves, whatever the company picks
  if (Object.values(s.approverRoles ?? {}).some(rs => !rs || rs.some(r => !ASSIGNABLE_APPROVER_ROLES.includes(r)))) e.push('ຜູ້ອະນຸມັດຕ້ອງເປັນ ຫົວໜ້າ, ບັນຊີ ຫຼື ເຈົ້າຂອງ ເທົ່ານັ້ນ');
  if (Object.entries(s.roleRights ?? {}).some(([r, ks]) => !EDITABLE_ROLES.includes(r as Role) || !Array.isArray(ks) || ks.some(k => !isRightKey(k)))) e.push('ສິດຂອງບົດບາດ ຕ້ອງເປັນຂອງ ຫົວໜ້າ, ບັນຊີ ຫຼື ຜູ້ກວດສອບ ແລະ ເປັນສິດທີ່ມີໃນລະບົບ');
  if (Object.values(s.employeeMenus ?? {}).some(v => typeof v !== 'boolean')) e.push('ເມນູພະນັກງານ ຕ້ອງເປັນ ເປີດ ຫຼື ປິດ');

  const b = s.taxBrackets;
  if (!b.length) e.push('ຕ້ອງມີຂັ້ນອາກອນຢ່າງໜ້ອຍ 1 ຂັ້ນ');
  else {
    if (b[b.length - 1].upTo !== null) e.push('ຂັ້ນອາກອນສຸດທ້າຍ ຕ້ອງເປັນ "ຂຶ້ນໄປ" (ບໍ່ມີເພດານ)');
    let prev = 0;
    b.forEach((x, i) => {
      if (x.upTo !== null) {
        if (!Number.isFinite(x.upTo) || x.upTo <= prev) e.push(`ຂັ້ນອາກອນທີ ${i + 1}: ລາຍໄດ້ຕ້ອງສູງກວ່າຂັ້ນກ່ອນ`);
        prev = x.upTo;
      }
      if (!num(x.rate, 0, 1)) e.push(`ຂັ້ນອາກອນທີ ${i + 1}: ອັດຕາຕ້ອງຢູ່ລະຫວ່າງ 0–100%`);
    });
    if (b.slice(0, -1).some(x => x.upTo === null)) e.push('"ຂຶ້ນໄປ" ໃຊ້ໄດ້ສະເພາະຂັ້ນສຸດທ້າຍ');
  }
  if (s.holidays.some(d => !/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(new Date(d + 'T00:00:00').getTime()))) e.push('ວັນພັກລັດຖະການ ມີວັນທີທີ່ບໍ່ຖືກຕ້ອງ');
  if (new Set(s.holidays).size !== s.holidays.length) e.push('ວັນພັກລັດຖະການ ມີວັນທີຊ້ຳກັນ');
  return e;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const mins = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3);

/** Longest shift we accept: anything longer is almost certainly a typo, and a session never spans more than this. */
export const MAX_SHIFT_MIN = 16 * 60;

/** Shift definitions: valid times, a sensible length, and the break inside the shift. A shift whose end is before its start runs overnight (22:00–06:00). */
export function validateShifts(shifts: { id: string; name: string; start: string; end: string; breakStart: string; breakEnd: string; allowance?: number; flexible?: boolean; dailyHours?: number }[]): string[] {
  const e: string[] = [];
  if (!shifts.length) e.push('ຕ້ອງມີຢ່າງໜ້ອຍ 1 ກະ');
  for (const s of shifts) {
    const label = s.name?.trim() || s.id;
    if (!s.name?.trim()) e.push(`ກະ ${s.id}: ຕ້ອງມີຊື່`);
    if (s.flexible) {
      // no fixed times to check: only the expected hours per day matter
      if (!Number.isFinite(s.dailyHours) || s.dailyHours! < 1 || s.dailyHours! > 16 || Math.round(s.dailyHours! * 2) !== s.dailyHours! * 2) e.push(`ກະ ${label}: ຊົ່ວໂມງຕໍ່ມື້ຕ້ອງຢູ່ລະຫວ່າງ 1–16 (ເຄິ່ງຊົ່ວໂມງເປັນຂັ້ນ)`);
      if (s.allowance !== undefined && (!Number.isInteger(s.allowance) || s.allowance < 0 || s.allowance > 10_000_000)) e.push(`ກະ ${label}: ເບ້ຍລ້ຽງຕໍ່ກະຕ້ອງເປັນເລກເຕັມ 0–10,000,000`);
      continue;
    }
    if (![s.start, s.end, s.breakStart, s.breakEnd].every(t => HHMM.test(t))) { e.push(`ກະ ${label}: ເວລາບໍ່ຖືກຕ້ອງ`); continue; }
    if (s.allowance !== undefined && (!Number.isInteger(s.allowance) || s.allowance < 0 || s.allowance > 10_000_000)) e.push(`ກະ ${label}: ເບ້ຍລ້ຽງຕໍ່ກະຕ້ອງເປັນເລກເຕັມ 0–10,000,000`);
    // minutes since the shift started, wrapping past midnight
    const rel = (t: string) => (mins(t) - mins(s.start) + 1440) % 1440;
    const span = rel(s.end);
    if (span === 0) e.push(`ກະ ${label}: ເວລາເລີ່ມ ແລະ ເວລາເລີກຕ້ອງບໍ່ເທົ່າກັນ`);
    else if (span > MAX_SHIFT_MIN) e.push(`ກະ ${label}: ຍາວເກີນ 16 ຊົ່ວໂມງ (ກວດເວລາອີກຄັ້ງ)`);
    else if (!(rel(s.breakStart) < rel(s.breakEnd) && rel(s.breakEnd) <= span)) e.push(`ກະ ${label}: ເວລາພັກຕ້ອງຢູ່ໃນກະ — ພັກ ${s.breakStart}–${s.breakEnd} ແຕ່ກະແມ່ນ ${s.start}–${s.end} (ກວດ AM/PM: 12:00 AM ແມ່ນທ່ຽງຄືນ, ທ່ຽງມື້ແມ່ນ 12:00 PM)`);
  }
  if (new Set(shifts.map(s => s.name?.trim())).size !== shifts.length) e.push('ຊື່ກະຊ້ຳກັນ');
  return e;
}
