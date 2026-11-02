import type { HRData, Notification } from './state';
import { effectiveShift } from '../domain/requests';
import { closesAtFor, missedClockOutDates } from '../domain/missedOut';
import { isActiveOn } from '../domain/hiring';
import { inMyScope } from './scope';
import { ymd } from '../ui/format';

/** How far back a forgotten clock-out is still chased. Older ones are left to the monthly report. */
export const MISSED_LOOKBACK_DAYS = 7;

type Data = Pick<HRData, 'employees' | 'scans' | 'shifts' | 'overrides' | 'notifications'>;
const dmy = (iso: string) => iso.split('-').reverse().join('/');

/** Dates in the lookback window on which this employee forgot to clock out. */
export function missedDatesFor(data: Pick<HRData, 'scans' | 'shifts' | 'overrides'>, e: { id: string; shiftId: string; dayOff?: number[] }, now: Date, lookbackDays = MISSED_LOOKBACK_DAYS): string[] {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - lookbackDays);
  return missedClockOutDates({
    scans: data.scans.filter(s => s.employeeId === e.id), from: ymd(from), to: ymd(now), now,
    closesAt: date => closesAtFor(date, data.shifts.find(x => x.id === effectiveShift(e, date, data.overrides)))
  });
}

/**
 * The notices that should exist but do not yet: one to the employee and one to each head whose department covers them,
 * per forgotten day. Ids are deterministic, so running this again (or on another device) never duplicates a notice.
 */
export function missedOutNotices(data: Data, now: Date, companyId: string): Notification[] {
  const have = new Set(data.notifications.map(n => n.id));
  const out: Notification[] = [];
  const at = now.toISOString();
  const heads = data.employees.filter(h => h.roles.includes('head') && !h.endDate);
  for (const e of data.employees) {
    if (e.baseSalary <= 0 || !isActiveOn(e, ymd(now))) continue;
    for (const date of missedDatesFor(data, e, now).filter(d => isActiveOn(e, d))) {
      const mk = (userId: string, text: string, link: string): void => {
        const id = `miss:${e.id}:${date}:${userId}`;
        if (!have.has(id)) out.push({ id, companyId, userId, text, at, read: false, link });
      };
      mk(e.id, `ເຈົ້າລືມລົງເວລາອອກ ວັນທີ ${dmy(date)} — ກົດເພື່ອຂໍແກ້ເວລາ`, 'requests');
      for (const h of heads) if (h.id !== e.id && inMyScope(h, data.employees, e.id, ['head'])) mk(h.id, `${e.name} ລືມລົງເວລາອອກ ວັນທີ ${dmy(date)}`, 'approvals');
    }
  }
  return out;
}
