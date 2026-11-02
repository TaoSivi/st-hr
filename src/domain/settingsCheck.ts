import type { Role, Settings } from './types';

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
  if (s.leaveApproversRequired !== 1 && s.leaveApproversRequired !== 2) e.push('ຈຳນວນຄົນອະນຸມັດ ຕ້ອງເປັນ 1 ຫຼື 2');
  if (!s.leaveApproverRoles.length) e.push('ຕ້ອງເລືອກຜູ້ອະນຸມັດການລາຢ່າງໜ້ອຍ 1 ບົດບາດ');
  if (s.leaveApproverRoles.some(r => !ASSIGNABLE_APPROVER_ROLES.includes(r))) e.push('ຜູ້ກວດສອບ ແລະ ພະນັກງານທົ່ວໄປ ອະນຸມັດບໍ່ໄດ້');

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

/** Shift definitions: valid times, start before end (no overnight shifts yet), and the break inside the shift. */
export function validateShifts(shifts: { id: string; name: string; start: string; end: string; breakStart: string; breakEnd: string }[]): string[] {
  const e: string[] = [];
  if (!shifts.length) e.push('ຕ້ອງມີຢ່າງໜ້ອຍ 1 ກະ');
  for (const s of shifts) {
    const label = s.name?.trim() || s.id;
    if (!s.name?.trim()) e.push(`ກະ ${s.id}: ຕ້ອງມີຊື່`);
    if (![s.start, s.end, s.breakStart, s.breakEnd].every(t => HHMM.test(t))) { e.push(`ກະ ${label}: ເວລາບໍ່ຖືກຕ້ອງ`); continue; }
    if (mins(s.start) >= mins(s.end)) e.push(`ກະ ${label}: ເວລາເລີ່ມຕ້ອງກ່ອນເວລາເລີກ (ຍັງບໍ່ຮອງຮັບກະຂ້າມຄືນ)`);
    else if (mins(s.breakStart) < mins(s.start) || mins(s.breakEnd) > mins(s.end) || mins(s.breakStart) >= mins(s.breakEnd)) e.push(`ກະ ${label}: ເວລາພັກຕ້ອງຢູ່ໃນກະ`);
  }
  if (new Set(shifts.map(s => s.name?.trim())).size !== shifts.length) e.push('ຊື່ກະຊ້ຳກັນ');
  return e;
}
