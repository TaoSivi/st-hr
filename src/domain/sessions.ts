import type { ScanKind, ScanStatus } from './types';
import { allowedActions } from './day';

/** After a shift ends, a clock-out (or break scan) still belongs to that shift's session for this long: covers approved overtime and queueing at the door. */
export const SESSION_TAIL_MIN = 240;

export interface SessionScan { kind: ScanKind; status: ScanStatus; deviceTime: string }

/** One stretch of work: from a clock-in to its clock-out. It belongs to the calendar day of the clock-in, so a 22:00–06:00 shift is one session of the day it started. */
export interface Session<S extends SessionScan = SessionScan> { workDate: string; scans: S[]; closed: boolean }

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Latest moment a scan can still attach to the session of `workDate`. */
export const sessionLimit = (workDate: string, closesAt: (workDate: string) => Date) => new Date(closesAt(workDate).getTime() + SESSION_TAIL_MIN * 60000);

/**
 * Group one person's scans into sessions, oldest first. Rejected scans are left out (they never counted).
 * A clock-in always opens a new session; any other scan joins the open session while it is inside that session's limit,
 * otherwise it stands alone on its own calendar day (an orphan, e.g. a clock-out made long after the shift).
 */
export function toSessions<S extends SessionScan>(scans: S[], closesAt: (workDate: string) => Date): Session<S>[] {
  const live = scans.filter(s => s.status !== 'rejected').sort((a, b) => a.deviceTime.localeCompare(b.deviceTime));
  const out: Session<S>[] = [];
  let cur: Session<S> | null = null;
  for (const s of live) {
    const t = new Date(s.deviceTime);
    if (s.kind === 'in') { cur = { workDate: ymd(t), scans: [s], closed: false }; out.push(cur); continue; }
    if (cur && !cur.closed && t.getTime() <= sessionLimit(cur.workDate, closesAt).getTime()) {
      cur.scans.push(s);
      if (s.kind === 'out') cur.closed = true;
      continue;
    }
    out.push({ workDate: ymd(t), scans: [s], closed: s.kind === 'out' });
  }
  return out;
}

/** All live scans of the sessions that belong to `date`, in time order. */
export const scansOn = <S extends SessionScan>(sessions: Session<S>[], date: string): S[] =>
  sessions.filter(x => x.workDate === date).flatMap(x => x.scans).sort((a, b) => a.deviceTime.localeCompare(b.deviceTime));

/** The session still waiting for its clock-out right now, if any. */
export function activeSession<S extends SessionScan>(sessions: Session<S>[], now: Date, closesAt: (workDate: string) => Date): Session<S> | null {
  const last = sessions[sessions.length - 1];
  return last && !last.closed && last.scans.some(s => s.kind === 'in') && now.getTime() <= sessionLimit(last.workDate, closesAt).getTime() ? last : null;
}

/** Which buttons are enabled right now: continue the open session, otherwise only a new clock-in. */
export function actionsNow<S extends SessionScan>(scans: S[], now: Date, closesAt: (workDate: string) => Date): Record<ScanKind, boolean> {
  return allowedActions(activeSession(toSessions(scans, closesAt), now, closesAt)?.scans ?? []);
}

/** Minutes worked in one work day: first clock-in to last clock-out, minus the break. Zero when there is no clock-out. */
export function workedMinutesOf(scans: SessionScan[]): number {
  const live = scans.filter(s => s.status !== 'rejected').sort((a, b) => a.deviceTime.localeCompare(b.deviceTime));
  const at = (s?: SessionScan) => (s ? new Date(s.deviceTime).getTime() : NaN);
  const firstIn = live.find(s => s.kind === 'in');
  const lastOut = [...live].reverse().find(s => s.kind === 'out');
  const bs = live.find(s => s.kind === 'breakStart');
  const be = [...live].reverse().find(s => s.kind === 'breakEnd');
  if (!firstIn || !lastOut) return 0;
  const breakMin = bs && be ? Math.max(0, (at(be) - at(bs)) / 60000) : 0;
  return Math.max(0, Math.round((at(lastOut) - at(firstIn)) / 60000 - breakMin));
}
