import { describe, expect, it } from 'vitest';
import { RULE_LABEL, recordChanges, ruleChanges, ruleValue, rulesSummary } from './rules';
import { landsInBackOffice } from './permissions';
import { defaultSettings } from './defaults';
import { branches, shifts } from '../data/seed';

const S = defaultSettings('c1');
const text = (s = S) => rulesSummary(s, shifts, branches).map(x => x.title + '\n' + x.lines.join('\n')).join('\n');

describe('what changed between two versions of the rules', () => {
  it('lists only the rules that differ, with the old and the new value as they read', () => {
    expect(ruleChanges(S, S)).toEqual([]);
    expect(ruleChanges(S, { ...S, graceMinutes: 10, otRate: 2 })).toEqual([
      { key: 'graceMinutes', label: RULE_LABEL.graceMinutes, from: '5', to: '10' },
      { key: 'otRate', label: RULE_LABEL.otRate, from: '1.5', to: '2' }
    ]);
  });
  it('reads percentages, switches, roles and money the way a person would', () => {
    expect(ruleChanges(S, { ...S, ssRate: 0.07 })[0]).toMatchObject({ from: '5.5%', to: '7%' });
    expect(ruleChanges(S, { ...S, makerChecker: false })[0]).toMatchObject({ from: 'ເປີດ', to: 'ປິດ' });
    expect(ruleChanges(S, { ...S, leaveApproverRoles: ['owner'] })[0]).toMatchObject({ from: 'ຫົວໜ້າ, ເຈົ້າຂອງ / HR', to: 'ເຈົ້າຂອງ / HR' });
    expect(ruleChanges(S, { ...S, lateDeductPerMinute: 1_500_000 })[0]).toMatchObject({ to: '1,500,000' });
    expect(ruleChanges(S, { ...S, compLeaveExpiryDays: 0 })[0]).toMatchObject({ to: 'ບໍ່ໝົດອາຍຸ' });
  });
  it('says which holidays came and went, and what a tax change was', () => {
    const withDays = { ...S, holidays: ['2026-12-02', '2027-01-01'] };
    expect(ruleChanges(S, withDays)[0]).toMatchObject({ key: 'holidays', from: '0 ວັນ', to: 'ເພີ່ມ 2026-12-02, 2027-01-01' });
    expect(ruleChanges(withDays, { ...S, holidays: ['2027-01-01'] })[0].to).toBe('ລຶບ 2026-12-02');
    const taxed = { ...S, taxBrackets: S.taxBrackets.map((b, i) => (i === 1 ? { ...b, rate: 0.06 } : b)) };
    expect(ruleChanges(S, taxed)[0]).toMatchObject({ key: 'taxBrackets' });
    expect(ruleChanges(S, taxed)[0].to).toContain('6%');
  });
  it('an older record that lacks a rule, or no record at all, is not a change', () => {
    const { compLeaveExpiryDays: _gone, ...old } = S;
    expect(ruleChanges(old, S)).toEqual([]);
    expect(ruleChanges(undefined, S)).toEqual([]);
  });
  it('every rule has a label and a readable value', () => {
    for (const k of Object.keys(RULE_LABEL) as (keyof typeof RULE_LABEL)[]) {
      expect(RULE_LABEL[k], k).toBeTruthy();
      expect(ruleValue(k, S), k).not.toMatch(/NaN|undefined|\[object/);
    }
  });
  it('shift and branch edits read as lines; a new one is an addition', () => {
    expect(recordChanges('shift', { name: 'ກະເຊົ້າ', start: '06:00', end: '14:00' }, { name: 'ກະເຊົ້າ', start: '07:00', end: '14:00' })).toEqual(['ກະເຊົ້າ · ເລີ່ມ: 06:00 → 07:00']);
    expect(recordChanges('branch', { name: 'ສາຂາ', radiusM: 100 }, { name: 'ສາຂາ', radiusM: 150 })).toEqual(['ສາຂາ · ລັດສະໝີ (ມ.): 100 → 150']);
    expect(recordChanges('shift', undefined, { name: 'ກະຄ່ຳ' })).toEqual(['ເພີ່ມກະ ກະຄ່ຳ']);
    expect(recordChanges('branch', { name: 'ກ', radiusM: 100 }, { name: 'ກ', radiusM: 100 })).toEqual([]);
  });
});

describe('the rules in plain sentences', () => {
  it('gives every settings tab a section, in order', () => {
    expect(rulesSummary(S, shifts, branches).map(x => x.tab)).toEqual(['places', 'shifts', 'time', 'leave', 'holidays', 'pay']);
  });
  it('follows the settings: change a rule and the sentence changes', () => {
    expect(text()).toContain('ເກີນ 5 ນາທີ');
    expect(text({ ...S, graceMinutes: 12 })).toContain('ເກີນ 12 ນາທີ');
    expect(text({ ...S, faceMinScore: 55 })).toContain('ຢ່າງໜ້ອຍ 55%');
    expect(text({ ...S, leaveDaysPerYear: 20 })).toContain('20 ມື້/ປີ');
    expect(text({ ...S, ssRate: 0.06 })).toContain('ປະກັນສັງຄົມ 6%');
    expect(text({ ...S, leavePayoutOnExit: false })).toContain('ບໍ່ຈ່າຍວັນລາພັກ');
    expect(text({ ...S, makerChecker: false })).toContain('ບໍ່ຕ້ອງມີຄົນກວດຊ້ຳ');
    expect(text({ ...S, holidays: ['2026-12-02'] })).toContain('1 ວັນ');
  });
  it('lists each shift with its hours, flexible ones as such, and each branch radius', () => {
    const t = rulesSummary(S, [...shifts, { id: 'x', name: 'ກະຄ່ຳ', start: '22:00', end: '06:00', breakStart: '01:00', breakEnd: '01:30', allowance: 20000 }], branches).map(x => x.lines.join('\n')).join('\n');
    expect(t).toContain('22:00–06:00');
    expect(t).toContain('ເບ້ຍລ້ຽງ 20,000');
    expect(t).toContain('ຢືດຢຸ່ນ 8 ຊມ');
    expect(t).toContain(`${branches[0].name}: ລົງເວລາໄດ້ເມື່ອຢູ່ໃນລັດສະໝີ ${branches[0].radiusM} ແມັດ`);
  });
  it('never prints a broken number', () => expect(text()).not.toMatch(/NaN|undefined|\[object/));
});

describe('where a manager lands', () => {
  it('on a computer any back-office role opens in the back office; on a phone nobody does', () => {
    for (const r of ['head', 'accountant', 'owner', 'auditor'] as const) {
      expect(landsInBackOffice(['employee', r], true), r).toBe(true);
      expect(landsInBackOffice(['employee', r], false), r).toBe(false);
    }
  });
  it('a plain employee never does, even on a computer', () => expect(landsInBackOffice(['employee'], true)).toBe(false));
});
