import type { LeaveRequest, LeaveType } from './types';

/** Part-day leave: the morning off, the afternoon off, or a number of hours. Whole-day leave has no `part`. */
export type LeavePart = 'am' | 'pm' | 'hours';
export const PART_LABEL: Record<LeavePart, string> = { am: 'ເຄິ່ງວັນເຊົ້າ', pm: 'ເຄິ່ງວັນບ່າຍ', hours: 'ເປັນຊົ່ວໂມງ' };

const mins = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3);
const wrap = (m: number) => (m + 1440) % 1440;

/** Paid working hours of one shift (its length minus the break), also for shifts that cross midnight. */
export function shiftPaidHours(s: { start: string; end: string; breakStart: string; breakEnd: string; flexible?: boolean; dailyHours?: number }): number {
  if (s.flexible) return s.dailyHours ?? 8;
  return (wrap(mins(s.end) - mins(s.start)) - wrap(mins(s.breakEnd) - mins(s.breakStart))) / 60;
}

/** Share of a working day a part-day leave takes. Hours are counted against the person's own shift. */
export function partialDays(part: LeavePart, hours: number | undefined, paidHours: number): number {
  if (part === 'am' || part === 'pm') return 0.5;
  return Math.round(((hours ?? 0) / paidHours) * 100) / 100;
}

/** How a shift's hours read in lists: "06:00–14:00", or "ຢືດຢຸ່ນ 8 ຊມ" for a flexible shift. */
export const shiftRange = (s: { start: string; end: string; flexible?: boolean; dailyHours?: number }) => (s.flexible ? `ຢືດຢຸ່ນ ${s.dailyHours ?? 8} ຊມ` : `${s.start}–${s.end}`);

/** What the leave takes, for lists: "2 ມື້", "ເຄິ່ງວັນເຊົ້າ", "3 ຊົ່ວໂມງ". */
export function leaveSpan(l: Pick<LeaveRequest, 'days' | 'part' | 'hours'>): string {
  if (l.part === 'hours') return `${l.hours} ຊົ່ວໂມງ`;
  if (l.part) return PART_LABEL[l.part];
  return `${l.days} ມື້`;
}

const live = (l: LeaveRequest) => l.status === 'pending' || l.status === 'approved';
const covers = (l: Pick<LeaveRequest, 'from' | 'to'>, date: string) => l.from <= date && l.to >= date;

export interface LeaveAsk {
  type: LeaveType; from: string; to: string; days: number;
  part?: LeavePart; hours?: number;
}

/**
 * Why a leave request cannot be made, or null. Covers the rules that are about the request itself:
 * part-day shape, overlap with leave already booked, and the balance of the kind of leave asked for.
 * `existing` is the same person's earlier leave (any status; only pending and approved count).
 */
export function leaveRequestBlock(
  ask: LeaveAsk,
  ctx: { existing: LeaveRequest[]; paidHours: number; weeklyOff: number[]; holidays: string[]; annualLeft: number; compLeft: number }
): string | null {
  if (!ask.from || !ask.to || ask.to < ask.from) return 'ວັນທີບໍ່ຖືກຕ້ອງ';
  if (!(ask.days > 0)) return 'ວັນທີບໍ່ຖືກຕ້ອງ';
  const others = ctx.existing.filter(live);

  if (ask.part) {
    if (ask.from !== ask.to) return 'ລາເຄິ່ງວັນ / ເປັນຊົ່ວໂມງ ເລືອກໄດ້ສະເພາະມື້ດຽວ';
    if (ctx.weeklyOff.includes(new Date(ask.from + 'T12:00:00').getDay()) || ctx.holidays.includes(ask.from)) return 'ມື້ນັ້ນເປັນວັນພັກ ບໍ່ຕ້ອງລາ';
    if (ask.part === 'hours') {
      const h = ask.hours ?? 0;
      if (!Number.isFinite(h) || h <= 0) return 'ໃສ່ຈຳນວນຊົ່ວໂມງທີ່ຈະລາ';
      if (Math.round(h * 2) !== h * 2) return 'ຊົ່ວໂມງຕ້ອງເປັນຕົວເລກເຕັມ ຫຼື ເຄິ່ງຊົ່ວໂມງ (ເຊັ່ນ 1.5)';
      if (h >= ctx.paidHours) return `ລາຕັ້ງແຕ່ ${ctx.paidHours} ຊົ່ວໂມງ ໃຫ້ເລືອກລາເຕັມວັນ`;
    }
    const sameDay = others.filter(l => covers(l, ask.from));
    if (sameDay.some(l => !l.part)) return 'ມື້ນັ້ນມີການລາເຕັມວັນຢູ່ແລ້ວ';
    if (ask.part !== 'hours' && sameDay.some(l => l.part === ask.part)) return 'ມື້ນັ້ນລາຊ່ວງນີ້ຢູ່ແລ້ວ';
    if (sameDay.reduce((a, l) => a + l.days, 0) + ask.days > 1 + 1e-9) return 'ລາລວມກັນເກີນ 1 ມື້';
  } else if (others.some(l => l.from <= ask.to && l.to >= ask.from)) {
    return 'ມີການລາທັບຊ້ອນກັບຊ່ວງນີ້ຢູ່ແລ້ວ (ລໍອະນຸມັດ ຫຼື ອະນຸມັດແລ້ວ)';
  }

  if (ask.type === 'annual' && ask.days > ctx.annualLeft + 1e-9) return `ມື້ລາພັກເຫຼືອ ${ctx.annualLeft} ມື້ ບໍ່ພໍ`;
  if (ask.type === 'comp' && ask.days > ctx.compLeft + 1e-9) return `ມື້ພັກຊົດເຊີຍເຫຼືອ ${ctx.compLeft} ມື້ ບໍ່ພໍ`;
  return null;
}

/**
 * The time lateness is measured from on a given day. When the morning is a leave (approved), work starts after the break;
 * every other case, including an afternoon or hourly leave, is judged from the shift start.
 */
export function lateStartFor(shift: { start: string; breakEnd: string; flexible?: boolean }, approvedLeavesThatDay: Pick<LeaveRequest, 'part' | 'status'>[]): string | null {
  if (shift.flexible) return null; // no fixed start, so nobody is late
  return approvedLeavesThatDay.some(l => l.status === 'approved' && l.part === 'am') ? shift.breakEnd : shift.start;
}
