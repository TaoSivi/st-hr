import { describe, expect, it } from 'vitest';
import { minutesText, punctualityNote } from './punctuality';

const day = { start: '08:00', end: '17:00', breakEnd: '13:00' };
const night = { start: '22:00', end: '06:00', breakEnd: '02:00' };
const at = (hhmm: string, date = '2026-11-05') => new Date(`${date}T${hhmm}:00`);
const base = { workDate: '2026-11-05', leaves: [], graceMinutes: 5 };

describe('what to say after clocking in', () => {
  it('late beyond the grace: how many minutes', () => {
    expect(punctualityNote({ ...base, kind: 'in', at: at('08:12'), shift: day })).toEqual({ tone: 'late', minutes: 12, text: 'ມາຊ້າ 12 ນາທີ' });
  });
  it('on time, within the grace, or early: nothing', () => {
    for (const t of ['07:50', '08:00', '08:05']) expect(punctualityNote({ ...base, kind: 'in', at: at(t), shift: day }), t).toBeNull();
  });
  it('an hour or more reads in hours', () => expect(punctualityNote({ ...base, kind: 'in', at: at('09:15'), shift: day })!.text).toBe('ມາຊ້າ 1 ຊົ່ວໂມງ 15 ນາທີ'));
  it('when the morning is approved leave, lateness counts from the afternoon start', () => {
    const leaves = [{ part: 'am' as const, status: 'approved' as const }];
    expect(punctualityNote({ ...base, kind: 'in', at: at('12:50'), shift: day, leaves })).toBeNull();
    expect(punctualityNote({ ...base, kind: 'in', at: at('13:20'), shift: day, leaves })!.minutes).toBe(20);
  });
});

describe('what to say after clocking out', () => {
  it('before the end of the shift: how many minutes early', () => {
    expect(punctualityNote({ ...base, kind: 'out', at: at('16:31'), shift: day })).toEqual({ tone: 'early', minutes: 29, text: 'ອອກກ່ອນເວລາ 29 ນາທີ' });
  });
  it('at the end, or after (overtime): nothing', () => {
    for (const t of ['17:00', '17:40', '19:00']) expect(punctualityNote({ ...base, kind: 'out', at: at(t), shift: day }), t).toBeNull();
  });
  it('seconds early do not count as a minute', () => expect(punctualityNote({ ...base, kind: 'out', at: new Date('2026-11-05T16:59:40'), shift: day })).toBeNull());
  it('a night shift ends the next morning', () => {
    expect(punctualityNote({ ...base, kind: 'out', at: at('05:30', '2026-11-06'), shift: night })!.minutes).toBe(30);
    expect(punctualityNote({ ...base, kind: 'out', at: at('06:10', '2026-11-06'), shift: night })).toBeNull();
  });
  it('an approved afternoon or hourly leave makes leaving early expected', () => {
    for (const part of ['pm', 'hours'] as const) expect(punctualityNote({ ...base, kind: 'out', at: at('15:00'), shift: day, leaves: [{ part, status: 'approved' }] }), part).toBeNull();
    expect(punctualityNote({ ...base, kind: 'out', at: at('15:00'), shift: day, leaves: [{ part: 'pm', status: 'pending' }] })!.minutes).toBe(120);
  });
});

describe('when there is nothing to compare with', () => {
  it('no shift (day off), a flexible shift, or a break scan: nothing', () => {
    expect(punctualityNote({ ...base, kind: 'in', at: at('10:00'), shift: null })).toBeNull();
    expect(punctualityNote({ ...base, kind: 'out', at: at('10:00'), shift: { ...day, flexible: true } })).toBeNull();
    expect(punctualityNote({ ...base, kind: 'breakStart', at: at('12:00'), shift: day })).toBeNull();
  });
});

describe('minutes as words', () => {
  it('reads minutes, or hours and minutes', () => {
    expect(minutesText(7)).toBe('7 ນາທີ');
    expect(minutesText(60)).toBe('1 ຊົ່ວໂມງ');
    expect(minutesText(135)).toBe('2 ຊົ່ວໂມງ 15 ນາທີ');
  });
});
