import type { LeaveRequest, ScanKind, ScanRecord } from './types';
import { lateMinutes } from './attendance';

/** Which clock buttons are enabled, given today's accepted-or-pending scans in time order. */
export function allowedActions(today: Pick<ScanRecord, 'kind' | 'status'>[]): Record<ScanKind, boolean> {
  const live = today.filter(s => s.status !== 'rejected');
  const last = live[live.length - 1]?.kind;
  const tookBreak = live.some(s => s.kind === 'breakStart');
  return {
    in: !last || last === 'out',
    breakStart: (last === 'in' || last === 'breakEnd') && !tookBreak,
    breakEnd: last === 'breakStart',
    out: last === 'in' || last === 'breakEnd'
  };
}

export type DayStatus = 'ok' | 'late' | 'absent' | 'leave' | 'pending' | 'dayoff' | 'holiday' | 'future' | 'before-hire';

export interface DayInput {
  date: string; // YYYY-MM-DD
  today: string;
  startDate: string;
  shiftStart: string | null; // null = no fixed start (flexible hours), so nobody is late
  graceMinutes: number;
  dayOff: number[];
  holidays: string[];
  scans: Pick<ScanRecord, 'kind' | 'status' | 'deviceTime'>[]; // that day's scans for the employee
  leaves: Pick<LeaveRequest, 'from' | 'to' | 'status' | 'part'>[];
}

/** Colour of one calendar day. Leave and holidays win over scans; a missing day in the past is absent. */
export function dayStatus(d: DayInput): DayStatus {
  if (d.date < d.startDate) return 'before-hire';
  // a half-day or hourly leave does not take the whole day: the person still works, and is judged on their scans
  if (d.leaves.some(l => l.status === 'approved' && !l.part && l.from <= d.date && l.to >= d.date)) return 'leave';
  if (d.holidays.includes(d.date)) return 'holiday';
  const firstIn = d.scans.filter(s => s.kind === 'in' && s.status !== 'rejected').sort((a, b) => a.deviceTime.localeCompare(b.deviceTime))[0];
  if (firstIn) {
    if (firstIn.status === 'pending') return 'pending';
    return d.shiftStart && lateMinutes(d.shiftStart, new Date(firstIn.deviceTime), d.graceMinutes) > 0 ? 'late' : 'ok';
  }
  if (d.date > d.today) return 'future';
  if (d.dayOff.includes(new Date(d.date + 'T00:00:00').getDay())) return 'dayoff';
  return d.date === d.today ? 'future' : 'absent';
}

/** 6×7 grid of YYYY-MM-DD starting on the Sunday on or before the 1st. */
export function monthGrid(year: number, month: number): { date: string; inMonth: boolean }[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const out: { date: string; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    out.push({ date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, inMonth: d.getMonth() === month });
  }
  return out;
}
