import type { ScanKind, ScanStatus } from './types';

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

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Dates in [from, to] (YYYY-MM-DD, inclusive) on which the person forgot to clock out, oldest first. */
export function missedClockOutDates(p: {
  scans: (DayScan & { employeeId?: string })[]; from: string; to: string; now: Date;
  closesAt: (date: string) => Date; graceMin?: number;
}): string[] {
  const byDate = new Map<string, DayScan[]>();
  for (const s of p.scans) { const d = ymd(new Date(s.deviceTime)); if (d >= p.from && d <= p.to) byDate.set(d, [...(byDate.get(d) ?? []), s]); }
  return [...byDate.keys()].sort().filter(d => isMissedClockOut(byDate.get(d)!, p.closesAt(d), p.now, p.graceMin));
}

/** When the day's work is due to be over: the shift's end, or midnight for a day without a shift (someone who came in on a day off). */
export function closesAtFor(date: string, shift?: { end: string }): Date {
  return shift ? new Date(`${date}T${shift.end}:00`) : new Date(`${date}T23:59:59`);
}
