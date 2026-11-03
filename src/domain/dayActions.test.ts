import { describe, expect, it } from 'vitest';
import { DAY_ACTION_TEXT, dayActions, type DayAction, type DayContext } from './dayActions';

const base: DayContext = { date: '2026-11-03', today: '2026-11-03', startDate: '2026-01-01', isDayOff: false, isHoliday: false };
const at = (over: Partial<DayContext>) => dayActions({ ...base, ...over });

describe('what a day on the calendar offers', () => {
  it('an ordinary working day in the future: leave, swap the shift, change the schedule; nothing to fix yet', () => {
    expect(at({ date: '2026-11-10' })).toEqual(['leave', 'shiftSwap', 'schedule']);
  });
  it('today offers both: ask for what is coming, and fix what already happened', () => {
    expect(at({})).toEqual(['leave', 'shiftSwap', 'schedule', 'clockFix', 'ot']);
  });
  it('a past day offers only a fix or an OT, never leave or a swap', () => {
    expect(at({ date: '2026-10-28' })).toEqual(['clockFix', 'ot']);
  });
  it('a day off offers working that day instead of a shift swap, and no leave', () => {
    expect(at({ date: '2026-11-08', isDayOff: true })).toEqual(['dayOffSwap', 'schedule']);
  });
  it('a public holiday offers no leave and no swap', () => {
    expect(at({ date: '2026-12-02', isHoliday: true })).toEqual(['schedule']);
    expect(at({ date: '2026-10-28', isHoliday: true })).toEqual(['clockFix', 'ot']); // someone who did work that day can still claim it
  });
  it('a day already on leave offers to cancel it, not to ask again', () => {
    const l = { from: '2026-11-10', to: '2026-11-11' };
    expect(at({ date: '2026-11-10', leave: l })).toEqual(['leaveCancel', 'shiftSwap', 'schedule']);
  });
  it('a half-day leave leaves the other half free to ask for', () => {
    expect(at({ date: '2026-11-10', leave: { from: '2026-11-10', to: '2026-11-10', part: true } })).toContain('leave');
  });
  it('a leave that is already over cannot be cancelled, and a day on full leave has nothing to fix', () => {
    expect(at({ date: '2026-10-28', leave: { from: '2026-10-27', to: '2026-10-29' } })).toEqual([]);
  });
  it('before the hire date or after the last day there is nothing to do', () => {
    expect(at({ date: '2025-12-31' })).toEqual([]);
    expect(at({ date: '2026-11-10', endDate: '2026-11-05' })).toEqual([]);
    expect(at({ date: '2026-11-05', endDate: '2026-11-05' }).length).toBeGreaterThan(0); // the last day itself still counts
  });
  it('every action has a Lao label and hint, and none is offered twice', () => {
    for (const k of Object.keys(DAY_ACTION_TEXT) as DayAction[]) expect(DAY_ACTION_TEXT[k].label + DAY_ACTION_TEXT[k].hint, k).toMatch(/[຀-໿]/);
    const all = at({});
    expect(new Set(all).size).toBe(all.length);
  });
});
