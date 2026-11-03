import type { Employee, Shift } from './types';
import type { HRRequest, RequestPayloads, ShiftOverride } from './requests';
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

/**
 * Why a shared shift cannot be deleted, or null. A shift that people, a booked schedule change or a waiting request still point at
 * would leave them with no hours (reports, lateness and pay all read the shift), so it must be emptied first.
 */
export function shiftDeleteBlock(shift: Shift, ctx: { shifts: Shift[]; employees: Pick<Employee, 'shiftId'>[]; overrides: Pick<ShiftOverride, 'shiftId'>[]; requests: HRRequest[] }): string | null {
  if (shift.personal) return 'ເວລາສະເພາະຄົນ ແກ້ໃນ ພະນັກງານ → ແກ້ໄຂ';
  if (sharedShifts(ctx.shifts).filter(s => s.id !== shift.id).length === 0) return 'ຕ້ອງເຫຼືອຢ່າງໜ້ອຍ 1 ກະ';
  const people = ctx.employees.filter(e => e.shiftId === shift.id).length;
  if (people) return `ມີ ${people} ຄົນໃຊ້ກະນີ້ຢູ່ — ຍ້າຍເຂົາໄປກະອື່ນກ່ອນ (ພະນັກງານ → ແກ້ໄຂ ຫຼື ຕັ້ງເວລາເຂົ້າ-ອອກໃຫ້ຫຼາຍຄົນ)`;
  const booked = ctx.overrides.filter(o => o.shiftId === shift.id).length;
  if (booked) return `ມີການປ່ຽນຕາຕະລາງ ${booked} ມື້ ທີ່ໃຊ້ກະນີ້ຢູ່`;
  const waiting = ctx.requests.filter(r => r.status === 'pending' && r.kind === 'schedule' && (r.payload as RequestPayloads['schedule']).shiftId === shift.id).length;
  if (waiting) return `ມີຄຳຂໍປ່ຽນຕາຕະລາງ ${waiting} ລາຍການ ທີ່ລໍອະນຸມັດ ແລະ ໃຊ້ກະນີ້`;
  return null;
}

/** Who a "same hours for everyone" change would move: active people, all of them or one department. */
export function bulkTargets(employees: Employee[], dept: string | '*', today: string): Employee[] {
  return employees.filter(e => (!e.endDate || e.endDate >= today) && (dept === '*' || e.dept === dept));
}
