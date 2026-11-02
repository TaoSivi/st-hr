import type { useHR, PayrollRun } from './state';
import { uid } from '../data/store';
import { payrollSheets } from '../domain/payrollSheet';
import { buildXlsx, XLSX_MIME } from '../domain/xlsx';
import type { MonthSummary } from './payrun';
import { downloadBytes } from '../ui/format';

type HR = ReturnType<typeof useHR>;

export const payrollFileName = (key: string) => `ເງິນເດືອນ_${key}.xlsx`;

/** Build the payroll workbook, hand it to the browser, and record who exported which period (the audit log). */
export async function exportPayrollXlsx(hr: HR, rows: MonthSummary[], key: string, run: PayrollRun): Promise<{ fileName: string; employees: number }> {
  const me = hr.me!;
  const nameOf = (id?: string) => { const e = hr.employees.find(x => x.id === id); return e ? `${e.name} (${e.code})` : undefined; };
  const now = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const stamp = `${p2(now.getDate())}/${p2(now.getMonth() + 1)}/${now.getFullYear()} ${p2(now.getHours())}:${p2(now.getMinutes())}`;
  const bytes = buildXlsx(payrollSheets(rows, { month: key, status: run.status, preparedBy: nameOf(run.preparedBy), approvedBy: nameOf(run.approvedBy), by: `${me.name} (${me.code})`, generatedAt: stamp }));
  const fileName = payrollFileName(key);
  // log first: an export that cannot be recorded must not leave the system
  await hr.save('exports', { id: uid(), companyId: me.companyId, kind: 'payroll', month: key, employees: rows.length, fileName }, 'export-payroll');
  downloadBytes(fileName, bytes, XLSX_MIME);
  return { fileName, employees: rows.length };
}
