import type { Employee, Shift } from './types';
import { validateShifts } from './settingsCheck';

/**
 * Work hours set for one person only. They are stored as an ordinary shift marked with the person's id, so every
 * calculation (lateness, OT, night shifts, reports, pay) treats them exactly like a shared shift; they are only kept out of
 * the lists where shared shifts are chosen.
 */
export const personalShiftId = (employeeId: string) => `p-${employeeId}`;
export const sharedShifts = (shifts: Shift[]) => shifts.filter(s => !s.personal);
/** The shifts one person may pick from: the shared ones plus their own hours, if they have them. */
export const shiftsFor = (shifts: Shift[], employeeId: string) => shifts.filter(s => !s.personal || s.personal === employeeId);

export type Hours = Pick<Shift, 'start' | 'end' | 'breakStart' | 'breakEnd' | 'flexible' | 'dailyHours' | 'allowance'>;

export function makePersonalShift(e: Pick<Employee, 'id' | 'code'>, h: Hours): Shift {
  return { id: personalShiftId(e.id), name: `ສະເພາະ ${e.code}`, ...h, personal: e.id };
}

/** Problems with someone's own hours, checked together with the shared shifts (names must stay unique). */
export function personalShiftProblems(p: Shift, all: Shift[]): string[] {
  return validateShifts([...all.filter(s => s.id !== p.id), p]);
}

/** Who a "same hours for everyone" change would move: active people, all of them or one department. */
export function bulkTargets(employees: Employee[], dept: string | '*', today: string): Employee[] {
  return employees.filter(e => (!e.endDate || e.endDate >= today) && (dept === '*' || e.dept === dept));
}
