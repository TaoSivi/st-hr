import { describe, expect, it } from 'vitest';
import { missedDatesFor, missedOutNotices } from './missedOut';
import { branches, employees, shifts } from '../data/seed';
import type { ScanRecord } from '../domain/types';

let n = 0;
const scan = (employeeId: string, kind: ScanRecord['kind'], d: Date, status: ScanRecord['status'] = 'ok'): ScanRecord => ({
  id: 's' + n++, companyId: 'c1', employeeId, kind, deviceTime: d.toISOString(), serverTime: d.toISOString(), branchId: branches[0].id, status, reasons: [], offline: false
});
const now = new Date(2026, 10, 5, 20, 0); // Thu 5 Nov 2026, 20:00
const day = (d: number, h: number) => new Date(2026, 10, d, h, 0);
const data = (scans: ScanRecord[], notifications: any[] = []) => ({ employees, scans, shifts, overrides: [], notifications });
const kl = employees.find(e => e.id === 'e-kl')!; // Kitchen cook, morning shift ends 14:00, Sunday off

describe('missedDatesFor', () => {
  it('finds days with an in and no out, within the window, on that person only', () => {
    const scans = [scan('e-kl', 'in', day(2, 6)), scan('e-kl', 'in', day(3, 6)), scan('e-kl', 'out', day(3, 14)), scan('e-bm', 'in', day(4, 6))];
    expect(missedDatesFor(data(scans), kl, now)).toEqual(['2026-11-02']);
  });
  it('ignores days older than the lookback window', () => {
    expect(missedDatesFor(data([scan('e-kl', 'in', new Date(2026, 9, 1, 6))]), kl, now)).toEqual([]);
  });
});

describe('missedOutNotices', () => {
  const scans = [scan('e-kl', 'in', day(2, 6))];
  const made = missedOutNotices(data(scans), now, 'c1');
  const to = (id: string) => made.filter(x => x.userId === id);

  it('tells the employee, in the same words every time, and links to the fix', () => {
    expect(to('e-kl')).toHaveLength(1);
    expect(to('e-kl')[0]).toMatchObject({ id: 'miss:e-kl:2026-11-02:e-kl', link: 'requests', read: false });
    expect(to('e-kl')[0].text).toMatch('02/11/2026');
  });
  it('tells the head whose department covers them, and nobody else', () => {
    const head = employees.filter(e => e.roles.includes('head'));
    const expected = head.filter(h => h.id !== 'e-kl' && (h.headOf?.includes('*') || (h.headOf ?? [h.dept]).includes(kl.dept))).map(h => h.id);
    expect(expected.length).toBeGreaterThan(0);
    expect(made.filter(x => x.link === 'approvals').map(x => x.userId).sort()).toEqual(expected.sort());
    for (const id of ['e-acc', 'e-aud', 'e-bm']) expect(to(id), id).toEqual([]);
  });
  it('a department head for another department is not told', () => {
    const noy = employees.find(e => e.id === 'e-noy')!; // head of Serve, kl is Kitchen
    expect(noy.dept).not.toBe(kl.dept);
    expect(to('e-noy')).toEqual([]);
  });
  it('is idempotent: notices that already exist are not made again', () => {
    expect(missedOutNotices(data(scans, made), now, 'c1')).toEqual([]);
  });
  it('a fixed day produces nothing', () => {
    expect(missedOutNotices(data([...scans, scan('e-kl', 'out', day(2, 14))]), now, 'c1')).toEqual([]);
  });
  it('a person who has left or not started yet is not chased', () => {
    const gone = employees.map(e => (e.id === 'e-kl' ? { ...e, endDate: '2026-11-01' } : e));
    expect(missedOutNotices({ ...data(scans), employees: gone }, now, 'c1').filter(x => x.userId === 'e-kl')).toEqual([]);
  });
});
