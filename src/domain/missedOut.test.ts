import { describe, expect, it } from 'vitest';
import { isMissedClockOut, missedClockOutDates, MISSED_OUT_GRACE_MIN, type DayScan } from './missedOut';

const at = (hhmm: string, date = '2026-11-02') => new Date(`${date}T${hhmm}:00`);
const scan = (kind: DayScan['kind'], hhmm: string, status: DayScan['status'] = 'ok', date = '2026-11-02'): DayScan => ({ kind, status, deviceTime: at(hhmm, date).toISOString() });
const end = at('17:00');

describe('isMissedClockOut', () => {
  it('not missed while the shift is still on or inside the grace period', () => {
    expect(isMissedClockOut([scan('in', '08:00')], end, at('16:59'))).toBe(false);
    expect(isMissedClockOut([scan('in', '08:00')], end, at('17:59'))).toBe(false);
  });
  it('missed from exactly shift end + grace', () => {
    expect(isMissedClockOut([scan('in', '08:00')], end, at('18:00'))).toBe(true);
    expect(MISSED_OUT_GRACE_MIN).toBe(60);
  });
  it('a clocked-out day is never missed, however late it is', () => {
    expect(isMissedClockOut([scan('in', '08:00'), scan('out', '17:05')], end, at('23:59'))).toBe(false);
  });
  it('no clock-in means nothing to close: an absent day is not a forgotten clock-out', () => {
    expect(isMissedClockOut([], end, at('23:59'))).toBe(false);
    expect(isMissedClockOut([scan('out', '17:00')], end, at('23:59'))).toBe(false);
  });
  it('a rejected clock-out leaves the day open; a pending one closes it', () => {
    expect(isMissedClockOut([scan('in', '08:00'), scan('out', '17:00', 'rejected')], end, at('20:00'))).toBe(true);
    expect(isMissedClockOut([scan('in', '08:00'), scan('out', '17:00', 'pending')], end, at('20:00'))).toBe(false);
  });
  it('a rejected clock-in does not open the day', () => {
    expect(isMissedClockOut([scan('in', '08:00', 'rejected')], end, at('23:00'))).toBe(false);
  });
  it('someone on break or back from break who never left is missed', () => {
    expect(isMissedClockOut([scan('in', '08:00'), scan('breakStart', '12:00')], end, at('19:00'))).toBe(true);
    expect(isMissedClockOut([scan('in', '08:00'), scan('breakStart', '12:00'), scan('breakEnd', '13:00')], end, at('19:00'))).toBe(true);
  });
  it('scans given out of order are sorted by time first', () => {
    expect(isMissedClockOut([scan('out', '17:05'), scan('in', '08:00')], end, at('23:00'))).toBe(false);
  });
  it('a second shift that was clocked into but not out of is missed even after an earlier out', () => {
    expect(isMissedClockOut([scan('in', '08:00'), scan('out', '12:00'), scan('in', '13:00')], end, at('20:00'))).toBe(true);
  });
});

describe('missedClockOutDates', () => {
  const closes = (d: string) => at('17:00', d);
  const now = at('09:00', '2026-11-05');
  const scans = [
    scan('in', '08:00', 'ok', '2026-11-02'), // never closed -> missed
    scan('in', '08:00', 'ok', '2026-11-03'), scan('out', '17:00', 'ok', '2026-11-03'), // closed
    scan('in', '08:00', 'ok', '2026-11-04'), // missed
    scan('in', '08:00', 'ok', '2026-10-20') // outside the window
  ];
  it('lists the open past days inside the window, oldest first', () => {
    expect(missedClockOutDates({ scans, from: '2026-11-01', to: '2026-11-05', now, closesAt: closes })).toEqual(['2026-11-02', '2026-11-04']);
  });
  it('respects the window and finds nothing in a clean range', () => {
    expect(missedClockOutDates({ scans, from: '2026-11-03', to: '2026-11-03', now, closesAt: closes })).toEqual([]);
    expect(missedClockOutDates({ scans: [], from: '2026-11-01', to: '2026-11-05', now, closesAt: closes })).toEqual([]);
  });
  it('today only counts once its own shift is over', () => {
    const todayScans = [scan('in', '08:00', 'ok', '2026-11-05')];
    expect(missedClockOutDates({ scans: todayScans, from: '2026-11-05', to: '2026-11-05', now: at('12:00', '2026-11-05'), closesAt: closes })).toEqual([]);
    expect(missedClockOutDates({ scans: todayScans, from: '2026-11-05', to: '2026-11-05', now: at('18:30', '2026-11-05'), closesAt: closes })).toEqual(['2026-11-05']);
  });
});
