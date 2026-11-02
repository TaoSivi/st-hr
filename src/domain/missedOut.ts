import type { ScanKind, ScanStatus } from './types';
import { toSessions } from './sessions';

/** How long after the shift ends before an unclosed day counts as a forgotten clock-out (people finish up, queue at the door). */
export const MISSED_OUT_GRACE_MIN = 60;

export interface DayScan { kind: ScanKind; status: ScanStatus; deviceTime: string }

/**
 * A day is "open" when the person clocked in and their last live scan is not a clock-out.
 * It is a forgotten clock-out once `closesAt` (shift end, or midnight when there is no shift) plus the grace has passed.
 * Rejected scans do not count: a rejected clock-out leaves the day open.
 */
export function isMissedClockOut(scans: DayScan[], closesAt: Date, now: Date, graceMin = MISSED_OUT_GRACE_MIN): boolean {
  const live = [...scans].filter(s => s.status !== 'rejected').sort((a, b) => a.deviceTime.localeCompare(b.deviceTime));
  if (!live.some(s => s.kind === 'in')) return false;
  if (live[live.length - 1].kind === 'out') return false;
  return now.getTime() >= closesAt.getTime() + graceMin * 60000;
}

/**
 * Work dates in [from, to] (YYYY-MM-DD, inclusive) with a session that was never clocked out, oldest first.
 * A session is judged on its own, so an overnight shift's clock-out after midnight closes the day it started.
 */
export function missedClockOutDates(p: {
  scans: DayScan[]; from: string; to: string; now: Date;
  closesAt: (date: string) => Date; graceMin?: number;
}): string[] {
  const dates = toSessions(p.scans, p.closesAt)
    .filter(s => s.workDate >= p.from && s.workDate <= p.to && s.scans.some(x => x.kind === 'in') && !s.closed
      && isMissedClockOut(s.scans, p.closesAt(s.workDate), p.now, p.graceMin))
    .map(s => s.workDate);
  return [...new Set(dates)].sort();
}

/**
 * When the work of `date` is due to be over: the shift's end, which is the next day for an overnight shift (end before start),
 * or the end of the day when there is no shift (someone who came in on a day off).
 */
export function closesAtFor(date: string, shift?: { start: string; end: string }): Date {
  if (!shift) return new Date(`${date}T23:59:59`);
  const end = new Date(`${date}T${shift.end}:00`);
  if (shift.end <= shift.start) end.setDate(end.getDate() + 1);
  return end;
}
