import { describe, expect, it } from 'vitest';
import { employees, shifts } from '../data/seed';
import { reportEmployees, reportFileName, scopeNote } from './exportAttendance';
import { defaultSettings } from '../domain/defaults';
import type { Employee } from '../domain/types';

const byId = (id: string) => employees.find(e => e.id === id)!;
// the report code only reads these fields of the HR context
const hrFor = (me: Employee, list: Employee[] = employees) => ({ me, employees: list, settings: defaultSettings('c'), shifts }) as any;
const ids = (list: Employee[]) => list.map(e => e.id).sort();
const rep = (hr: any, team: boolean) => reportEmployees(hr, team, 2026, 10);
const note = (hr: any, team: boolean, list: Employee[]) => scopeNote(hr, team, list, 2026, 10);
const payroll = employees.filter(e => e.baseSalary > 0);

describe('who appears in an exported report', () => {
  it('a personal report is only the person, for everybody', () => {
    for (const id of ['e-kl', 'e-noy', 'e-acc', 'e-owner', 'e-aud']) expect(ids(rep(hrFor(byId(id)), false)), id).toEqual([id]);
  });
  it('owner, accountant and auditor export everyone on the payroll', () => {
    for (const id of ['e-owner', 'e-acc', 'e-aud']) expect(ids(rep(hrFor(byId(id)), true)), id).toEqual(ids(payroll));
  });
  it('the shop manager (head of every department) exports everyone', () => {
    expect(ids(rep(hrFor(byId('e-head')), true))).toEqual(ids(payroll));
  });
  it('a department head exports only the departments they manage', () => {
    const got = rep(hrFor(byId('e-noy')), true); // head of Serve
    expect(got.length).toBeGreaterThan(0);
    expect(got.every(e => e.dept === 'ເສີບ')).toBe(true);
    expect(got.some(e => e.id === 'e-kl')).toBe(false); // a Kitchen cook is not in the file
  });
  it('a head with several departments gets exactly those', () => {
    const head: Employee = { ...byId('e-noy'), headOf: ['ເສີບ', 'ຄົວ'] };
    const got = rep(hrFor(head, employees.map(e => (e.id === head.id ? head : e))), true);
    expect(new Set(got.map(e => e.dept))).toEqual(new Set(['ເສີບ', 'ຄົວ']));
  });
  it('people without a salary (such as the owner account) are not in a team report', () => {
    expect(rep(hrFor(byId('e-owner')), true).some(e => e.baseSalary === 0)).toBe(false);
  });
  it('a plain employee asking for the team report still only gets themself or nothing sensitive: they hold no head/accountant/owner role', () => {
    const got = rep(hrFor(byId('e-kl')), true);
    expect(got.every(e => e.dept === byId('e-kl').dept)).toBe(true); // default scope is their own department, never beyond it
  });
});

describe('scope note and file name', () => {
  it('says what the file covers', () => {
    const owner = hrFor(byId('e-owner'));
    expect(note(owner, true, rep(owner, true))).toBe('ທຸກພະແນກ');
    expect(note(owner, false, [byId('e-owner')])).toBe('ສະເພາະຂອງຕົນເອງ');
    const noy = hrFor(byId('e-noy'));
    expect(note(noy, true, rep(noy, true))).toBe('ສະເພາະພະແນກ: ເສີບ');
  });
  it('file names carry the month, and the employee code for a personal file', () => {
    expect(reportFileName(true, byId('e-owner'), 2026, 10)).toBe('ລາຍງານເຂົ້າ-ອອກ_2026-11.xlsx');
    expect(reportFileName(false, byId('e-kl'), 2026, 0)).toBe('ລາຍງານເຂົ້າ-ອອກ_ST-012_2026-01.xlsx');
    expect(reportFileName(true, byId('e-owner'), 2026, 11)).toMatch(/2026-12\.xlsx$/);
  });
});

describe('people who joined or left are only in the months they worked', () => {
  const joiner: Employee = { ...byId('e-kl'), id: 'j', code: 'ST-900', startDate: '2026-11-16' };
  const leaver: Employee = { ...byId('e-kl'), id: 'l', code: 'ST-901', endDate: '2026-10-20' };
  const list = [...employees, joiner, leaver];
  const owner = hrFor(byId('e-owner'), list);
  it('a new hire is absent before their start month and present from it', () => {
    expect(rep(owner, true).some(e => e.id === 'j')).toBe(true); // Nov 2026
    expect(reportEmployees(owner, true, 2026, 9).some(e => e.id === 'j')).toBe(false); // Oct 2026
  });
  it('a leaver stays in their last month and drops out after', () => {
    expect(reportEmployees(owner, true, 2026, 9).some(e => e.id === 'l')).toBe(true);
    expect(rep(owner, true).some(e => e.id === 'l')).toBe(false);
  });
  it('the scope note still says all departments when only absent people are missing', () => {
    expect(note(owner, true, rep(owner, true))).toBe('ທຸກພະແນກ');
  });
});
