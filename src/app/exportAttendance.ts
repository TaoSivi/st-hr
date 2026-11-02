import type { useHR } from './state';
import { uid } from '../data/store';
import { attendanceSheets, type ReportInput } from '../domain/attendanceReport';
import { buildXlsx, XLSX_MIME } from '../domain/xlsx';
import type { Employee } from '../domain/types';
import { inMyScope } from './scope';
import { employedFraction } from '../domain/hiring';
import { downloadBytes, ymd } from '../ui/format';

type HR = ReturnType<typeof useHR>;

/**
 * Who appears in a report for this user. A personal report is only the user.
 * A team report is everyone on the payroll that the user may see: heads see their departments,
 * accountant, owner and auditor see everyone. The on-screen table and the Excel file use this same list.
 */
export function reportEmployees(hr: HR, team: boolean, year: number, month: number): Employee[] {
  const me = hr.me!;
  if (!team) return [me];
  return hr.employees.filter(e => e.baseSalary > 0 && employedFraction(e, year, month) > 0 && inMyScope(me, hr.employees, e.id, ['head', 'accountant', 'owner']));
}

export function reportInput(hr: HR, employees: Employee[], year: number, month: number): ReportInput {
  return { employees, scans: hr.scans, leaves: hr.leaves, ots: hr.ots, overrides: hr.overrides, shifts: hr.shifts, branches: hr.branches, settings: hr.settings, year, month, today: ymd(new Date()), now: new Date() };
}

export function scopeNote(hr: HR, team: boolean, employees: Employee[], year: number, month: number): string {
  if (!team) return 'ສະເພາະຂອງຕົນເອງ';
  const all = hr.employees.filter(e => e.baseSalary > 0 && employedFraction(e, year, month) > 0);
  if (employees.length === all.length) return 'ທຸກພະແນກ';
  return `ສະເພາະພະແນກ: ${[...new Set(employees.map(e => e.dept))].join(', ') || '—'}`;
}

export const reportFileName = (team: boolean, me: Employee, year: number, month: number) =>
  `ລາຍງານເຂົ້າ-ອອກ_${team ? '' : me.code + '_'}${year}-${String(month + 1).padStart(2, '0')}.xlsx`;

/** Build the workbook, hand it to the browser, and record the export in the audit log (who exported what, when). */
export async function exportAttendanceXlsx(hr: HR, team: boolean, year: number, month: number): Promise<{ fileName: string; employees: number }> {
  const me = hr.me!;
  const employees = reportEmployees(hr, team, year, month);
  const now = new Date();
  const stamp = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const bytes = buildXlsx(attendanceSheets(reportInput(hr, employees, year, month), { by: `${me.name} (${me.code})`, generatedAt: stamp, scopeNote: scopeNote(hr, team, employees, year, month) }));
  const fileName = reportFileName(team, me, year, month);
  // log first: an export that cannot be recorded must not leave the system
  await hr.save('exports', { id: uid(), companyId: me.companyId, kind: team ? 'attendance-team' : 'attendance-self', month: `${year}-${String(month + 1).padStart(2, '0')}`, employees: employees.length, fileName }, 'export-attendance');
  downloadBytes(fileName, bytes, XLSX_MIME);
  return { fileName, employees: employees.length };
}
