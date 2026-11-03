/**
 * What a person can ask for from a day on their calendar. The rules are only about the date and what is booked on it;
 * each action opens the same request form it always had, with the date filled in, and that form still checks everything else.
 */
export type DayAction = 'leave' | 'leaveCancel' | 'shiftSwap' | 'dayOffSwap' | 'schedule' | 'clockFix' | 'ot';

export interface DayContext {
  date: string;
  today: string;
  startDate: string;
  endDate?: string;
  /** Weekly day off, or switched to a day off for this date. */
  isDayOff: boolean;
  isHoliday: boolean;
  /** Pending or approved leave that covers this date, if any. */
  leave?: { from: string; to: string; part?: boolean };
}

export const DAY_ACTION_TEXT: Record<DayAction, { label: string; hint: string }> = {
  leave: { label: 'ຂໍລາ', hint: 'ລາພັກ / ລາປ່ວຍ / ລາກິດ ໃນມື້ນີ້' },
  leaveCancel: { label: 'ຍົກເລີກການລາ', hint: 'ມື້ນີ້ມີການລາຢູ່ ຂໍຍົກເລີກ' },
  shiftSwap: { label: 'ສະລັບກະ', hint: 'ແລກກະກັບເພື່ອນຮ່ວມງານ' },
  dayOffSwap: { label: 'ມາເຮັດວຽກແທນວັນພັກ', hint: 'ມາວັນນີ້ ແລ້ວເລືອກພັກວັນອື່ນແທນ' },
  schedule: { label: 'ປ່ຽນຕາຕະລາງວຽກ', hint: 'ຂໍປ່ຽນກະ ຫຼື ຂໍພັກ ສຳລັບມື້ນີ້' },
  clockFix: { label: 'ຂໍແກ້ເວລາເຂົ້າ-ອອກ', hint: 'ລືມສະແກນ ຫຼື ສະແກນບໍ່ໄດ້' },
  ot: { label: 'ຂໍລ່ວງເວລາ (OT)', hint: 'ເຮັດເກີນເວລາ ຂໍນັບເປັນ OT' }
};

export function dayActions(c: DayContext): DayAction[] {
  if (c.date < c.startDate || (c.endDate && c.date > c.endDate)) return []; // not employed that day
  const out: DayAction[] = [];
  const upcoming = c.date >= c.today;
  const happened = c.date <= c.today;
  const fullLeave = !!c.leave && !c.leave.part;
  if (upcoming) {
    if (c.leave && c.leave.to >= c.today) out.push('leaveCancel');
    if (!fullLeave && !c.isDayOff && !c.isHoliday) out.push('leave');
    if (!c.isHoliday) out.push(c.isDayOff ? 'dayOffSwap' : 'shiftSwap');
    out.push('schedule');
  }
  if (happened && !fullLeave) out.push('clockFix', 'ot'); // past days (and today): what was missed or worked extra
  return out;
}
