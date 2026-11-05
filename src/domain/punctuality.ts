import { lateMinutes } from './attendance';
import { lateStartFor } from './leavePart';
import { closesAtFor } from './missedOut';
import type { LeaveRequest, ScanKind } from './types';

export interface PunctualityNote { tone: 'late' | 'early'; minutes: number; text: string }

/** 75 → "1 ຊົ່ວໂມງ 15 ນາທີ", 12 → "12 ນາທີ". */
export function minutesText(m: number): string {
  const h = Math.floor(m / 60), r = m % 60;
  return [h ? `${h} ຊົ່ວໂມງ` : '', r || !h ? `${r} ນາທີ` : ''].filter(Boolean).join(' ');
}

/**
 * What to tell a person right after a clock-in or clock-out about the time, or null when there is nothing to say:
 * - clock-in later than the shift start (past the grace minutes) → "ມາຊ້າ N ນາທີ"
 * - clock-out before the shift ends → "ອອກກ່ອນເວລາ N ນາທີ"
 * On time, early in, or out at / after the end of the shift: nothing.
 * A flexible (office) shift has no fixed start or end, so nobody is late; at clock-out it is judged on hours instead: fewer than the shift's daily hours worked → "ອອກກ່ອນຄົບເວລາ N ນາທີ".
 * A day off has no shift, so nothing.
 * A half-day or hourly leave in the afternoon makes an early clock-out expected, so it is not mentioned.
 */
export function punctualityNote(a: {
  kind: ScanKind;
  at: Date;
  workDate: string;
  shift?: { start: string; end: string; breakEnd: string; flexible?: boolean; dailyHours?: number } | null;
  workedMinutes?: number; // this work day so far, up to this clock-out (flexible shifts are judged on it)
  leaves: Pick<LeaveRequest, 'part' | 'status'>[]; // the person's leave covering the work date
  graceMinutes: number;
}): PunctualityNote | null {
  const { shift } = a;
  if (!shift) return null;
  if (shift.flexible) {
    if (a.kind !== 'out' || a.workedMinutes == null) return null;
    if (a.leaves.some(l => l.status === 'approved' && (l.part === 'pm' || l.part === 'hours'))) return null;
    const hours = shift.dailyHours ?? 8;
    const short = Math.round(hours * 60 - a.workedMinutes);
    return short >= 1 ? { tone: 'early', minutes: short, text: `ອອກກ່ອນຄົບເວລາ ${minutesText(short)} (ເຮັດໄດ້ ${minutesText(a.workedMinutes)} ຈາກ ${hours} ຊົ່ວໂມງ)` } : null;
  }
  if (a.kind === 'in') {
    const start = lateStartFor(shift, a.leaves);
    const late = start ? lateMinutes(start, a.at, a.graceMinutes) : 0;
    return late > 0 ? { tone: 'late', minutes: late, text: `ມາຊ້າ ${minutesText(late)}` } : null;
  }
  if (a.kind === 'out') {
    if (a.leaves.some(l => l.status === 'approved' && (l.part === 'pm' || l.part === 'hours'))) return null;
    const early = Math.round((closesAtFor(a.workDate, shift).getTime() - a.at.getTime()) / 60000);
    return early >= 1 ? { tone: 'early', minutes: early, text: `ອອກກ່ອນເວລາ ${minutesText(early)}` } : null;
  }
  return null;
}
