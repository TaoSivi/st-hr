import type { Branch, Employee, LeaveRequest, OtRequest, ScanRecord, Settings, Shift } from './types';
import { dayStatus, type DayStatus } from './day';
import { effectiveShift, type ShiftOverride } from './requests';
import { isSettled, lateMinutes } from './attendance';
import type { Cell, Sheet } from './xlsx';
import { closesAtFor, isMissedClockOut } from './missedOut';
import { scansOn, toSessions } from './sessions';

export const STATUS_LABEL: Record<DayStatus, string> = {
  ok: 'ປົກກະຕິ', late: 'ມາຊ້າ', absent: 'ຂາດ', leave: 'ລາ', pending: 'ລໍກວດ', dayoff: 'ວັນພັກ', holiday: 'ວັນພັກລັດຖະການ', future: '', 'before-hire': ''
};
const WEEKDAY = ['ອາ', 'ຈ', 'ອ', 'ພ', 'ພຫ', 'ສຸ', 'ເສ'];
const LEAVE_LABEL: Record<string, string> = { annual: 'ລາພັກປະຈຳປີ', sick: 'ລາປ່ວຍ', personal: 'ລາກິດ', unpaid: 'ລາບໍ່ຮັບເງິນເດືອນ' };

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dmy = (iso: string) => iso.split('-').reverse().join('/');
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ReportInput {
  employees: Employee[]; // already limited to the people the exporter may see
  scans: ScanRecord[];
  leaves: LeaveRequest[];
  ots: OtRequest[];
  overrides: ShiftOverride[];
  shifts: Shift[];
  branches: Branch[];
  settings: Settings;
  year: number;
  month: number; // 0-based
  today: string; // YYYY-MM-DD, days after it are not reported
  now?: Date; // decides whether today's open day is already a forgotten clock-out; defaults to the end of `today`
}

export interface DayRow {
  date: string; employee: Employee; shiftName: string; shiftTime: string;
  in?: string; breakStart?: string; breakEnd?: string; out?: string;
  workedMin: number; lateMin: number; status: DayStatus; branch: string; note: string;
}

export interface SummaryRow {
  employee: Employee; workedDays: number; lateDays: number; lateMin: number; absentDays: number; leaveDays: number;
  dayOffDays: number; holidayDays: number; holidayWorkedDays: number; pendingDays: number; missedOutDays: number; hours: number; otMin: number;
}

export function buildAttendance(inp: ReportInput): { days: DayRow[]; summary: SummaryRow[] } {
  const { year, month, settings: s } = inp;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const prefix = `${year}-${pad(month + 1)}`;
  const branchName = new Map(inp.branches.map(b => [b.id, b.name]));
  const days: DayRow[] = [];
  const summary: SummaryRow[] = [];

  for (const e of inp.employees) {
    const sum: SummaryRow = { employee: e, workedDays: 0, lateDays: 0, lateMin: 0, absentDays: 0, leaveDays: 0, dayOffDays: 0, holidayDays: 0, holidayWorkedDays: 0, pendingDays: 0, missedOutDays: 0, hours: 0, otMin: 0 };
    const mine = inp.scans.filter(x => x.employeeId === e.id && x.status !== 'rejected');
    const myLeaves = inp.leaves.filter(l => l.employeeId === e.id);
    const shiftOn = (date: string) => { const id = effectiveShift(e, date, inp.overrides); return id ? inp.shifts.find(x => x.id === id) : undefined; };
    // a night shift's clock-out after midnight belongs to the day the shift started
    const sessions = toSessions(mine, date => closesAtFor(date, shiftOn(date)));

    for (let d = 1; d <= lastDay; d++) {
      const date = `${prefix}-${pad(d)}`;
      if (date > inp.today || date < e.startDate || (e.endDate && date > e.endDate)) continue;
      const shift = shiftOn(date);
      const dow = new Date(`${date}T12:00:00`).getDay();
      const scans = scansOn(sessions, date);
      const status = dayStatus({ date, today: inp.today, startDate: e.startDate, shiftStart: shift?.start ?? '00:00', graceMinutes: s.graceMinutes,
        dayOff: shift ? [] : [dow], holidays: s.holidays, scans, leaves: myLeaves });
      if (status === 'future' || status === 'before-hire') continue;

      const firstIn = scans.find(x => x.kind === 'in');
      const lastOut = [...scans].reverse().find(x => x.kind === 'out');
      const bs = scans.find(x => x.kind === 'breakStart');
      const be = [...scans].reverse().find(x => x.kind === 'breakEnd');
      const t = (x?: ScanRecord) => (x ? new Date(x.deviceTime) : undefined);
      const breakMin = bs && be ? Math.max(0, (t(be)!.getTime() - t(bs)!.getTime()) / 60000) : 0;
      const workedMin = firstIn && lastOut ? Math.max(0, Math.round((t(lastOut)!.getTime() - t(firstIn)!.getTime()) / 60000 - breakMin)) : 0;
      const lateMin = firstIn && shift ? lateMinutes(shift.start, t(firstIn)!, s.graceMinutes) : 0;

      const notes: string[] = [];
      const leave = myLeaves.find(l => l.status === 'approved' && l.from <= date && l.to >= date);
      if (leave) notes.push(LEAVE_LABEL[leave.type] ?? 'ລາ');
      for (const x of scans.filter(x => x.status === 'pending')) notes.push(...x.reasons);
      // a holiday or leave day on which the person still clocked in must not look like a plain day off: it is often paid differently
      const workedOnOff = !!firstIn && (status === 'holiday' || status === 'leave');
      if (workedOnOff) notes.push(status === 'holiday' ? 'ມາເຮັດວຽກໃນວັນພັກລັດຖະການ' : 'ມີການລົງເວລາໃນວັນລາ');
      // clocked in, never clocked out: the hours cannot be counted until someone fixes it
      const closesAt = closesAtFor(date, shift);
      const missedOut = isMissedClockOut(scans, closesAt, inp.now ?? new Date(`${inp.today}T23:59:59`));
      if (missedOut) notes.push('ລືມລົງເວລາອອກ');
      if (scans.some(x => !isSettled(x))) notes.push('ສະແກນຕອນບໍ່ມີເນັດ ຍັງບໍ່ຢືນຢັນ');
      if (scans.some(x => x.status === 'approved' && x.reasons.length)) notes.push('ຫົວໜ້າຢືນຢັນແລ້ວ');

      days.push({
        date, employee: e, shiftName: shift?.name ?? '—', shiftTime: shift ? `${shift.start}–${shift.end}` : '',
        in: firstIn && hhmm(t(firstIn)!), breakStart: bs && hhmm(t(bs)!), breakEnd: be && hhmm(t(be)!), out: lastOut && hhmm(t(lastOut)!) + (ymd(t(lastOut)!) > date ? ' (+1)' : ''),
        workedMin, lateMin, status, branch: (firstIn?.branchId && branchName.get(firstIn.branchId)) || '', note: [...new Set(notes)].join(' · ')
      });

      if (status === 'ok' || status === 'late' || status === 'pending') sum.workedDays++;
      if (status === 'late') { sum.lateDays++; sum.lateMin += lateMin; }
      if (status === 'pending') sum.pendingDays++;
      if (missedOut) sum.missedOutDays++;
      if (status === 'absent') sum.absentDays++;
      if (status === 'leave') sum.leaveDays++;
      if (status === 'dayoff') sum.dayOffDays++;
      if (status === 'holiday') { sum.holidayDays++; if (workedOnOff) sum.holidayWorkedDays++; }
      sum.hours += workedMin / 60;
    }
    sum.hours = round2(sum.hours);
    sum.otMin = inp.ots.filter(o => o.employeeId === e.id && o.status === 'approved' && o.date.startsWith(prefix)).reduce((a, o) => a + o.minutes, 0);
    summary.push(sum);
  }
  return { days, summary };
}

/** The three sheets of the Excel file. `by` and `generatedAt` go on the information sheet for whoever audits the export. */
export function attendanceSheets(inp: ReportInput, meta: { by: string; generatedAt: string; scopeNote: string }): Sheet[] {
  const { days, summary } = buildAttendance(inp);
  const month = `${String(inp.month + 1).padStart(2, '0')}/${inp.year}`;
  const summarySheet: Sheet = {
    name: 'ສະຫຼຸບ',
    columns: [
      { header: 'ລະຫັດ', width: 10 }, { header: 'ຊື່', width: 26 }, { header: 'ພະແນກ', width: 14 },
      { header: 'ມື້ມາວຽກ', width: 11, format: 'int' }, { header: 'ມາຊ້າ (ມື້)', width: 11, format: 'int' }, { header: 'ມາຊ້າ (ນາທີ)', width: 12, format: 'int' },
      { header: 'ຂາດ (ມື້)', width: 10, format: 'int' }, { header: 'ລາ (ມື້)', width: 10, format: 'int' }, { header: 'ວັນພັກ (ມື້)', width: 12, format: 'int' },
      { header: 'ວັນພັກລັດຖະການ', width: 15, format: 'int' }, { header: 'ເຮັດວຽກວັນພັກລັດຖະການ', width: 22, format: 'int' }, { header: 'ລໍກວດ (ມື້)', width: 11, format: 'int' }, { header: 'ລືມລົງເວລາອອກ (ມື້)', width: 18, format: 'int' },
      { header: 'ຊົ່ວໂມງເຮັດວຽກ', width: 15, format: 'decimal' }, { header: 'OT (ນາທີ)', width: 11, format: 'int' }
    ],
    rows: summary.map(r => [r.employee.code, r.employee.name, r.employee.dept, r.workedDays, r.lateDays, r.lateMin, r.absentDays, r.leaveDays, r.dayOffDays, r.holidayDays, r.holidayWorkedDays, r.pendingDays, r.missedOutDays, r.hours, r.otMin])
  };
  const dailySheet: Sheet = {
    name: 'ລາຍລະອຽດລາຍມື້',
    columns: [
      { header: 'ວັນທີ', width: 12 }, { header: 'ວັນ', width: 6 }, { header: 'ລະຫັດ', width: 10 }, { header: 'ຊື່', width: 26 }, { header: 'ພະແນກ', width: 14 },
      { header: 'ກະ', width: 12 }, { header: 'ເວລາກະ', width: 13 }, { header: 'ເຂົ້າ', width: 8 }, { header: 'ເລີ່ມພັກ', width: 10 }, { header: 'ເສັດພັກ', width: 10 }, { header: 'ອອກ', width: 8 },
      { header: 'ຊົ່ວໂມງເຮັດວຽກ', width: 15, format: 'decimal' }, { header: 'ມາຊ້າ (ນາທີ)', width: 12, format: 'int' }, { header: 'ສະຖານະ', width: 16 }, { header: 'ສາຂາ', width: 16 }, { header: 'ໝາຍເຫດ', width: 40 }
    ],
    rows: days.map((r): Cell[] => [dmy(r.date), WEEKDAY[new Date(`${r.date}T12:00:00`).getDay()], r.employee.code, r.employee.name, r.employee.dept, r.shiftName, r.shiftTime,
      r.in ?? null, r.breakStart ?? null, r.breakEnd ?? null, r.out ?? null, r.workedMin ? round2(r.workedMin / 60) : null, r.lateMin || null, STATUS_LABEL[r.status], r.branch, r.note])
  };
  const info: Sheet = {
    name: 'ຂໍ້ມູນລາຍງານ',
    columns: [{ header: 'ລາຍການ', width: 26 }, { header: 'ຄ່າ', width: 70 }],
    rows: [
      ['ລາຍງານ', 'ການເຂົ້າ-ອອກວຽກຂອງພະນັກງານ'], ['ເດືອນ', month], ['ຈຳນວນພະນັກງານ', summary.length], ['ສ້າງເມື່ອ', meta.generatedAt], ['ສ້າງໂດຍ', meta.by], ['ຂອບເຂດຂໍ້ມູນ', meta.scopeNote],
      ['ຜ່ອນຜັນມາຊ້າ (ນາທີ)', inp.settings.graceMinutes],
      ['ສະຖານະ: ປົກກະຕິ / ມາຊ້າ', 'ມີການລົງເວລາເຂົ້າ. ມາຊ້າ = ເຂົ້າຊ້າກວ່າເວລາກະ ເກີນເວລາຜ່ອນຜັນ'],
      ['ສະຖານະ: ລໍກວດ', 'ການລົງເວລາທີ່ລະບົບບໍ່ແນ່ໃຈ (ໜ້າ / GPS / ໂມງ) ລໍຫົວໜ້າຢືນຢັນ'],
      ['ສະຖານະ: ຂາດ', 'ມື້ເຮັດວຽກທີ່ຜ່ານມາແລ້ວ ບໍ່ມີການລົງເວລາ ແລະ ບໍ່ມີການລາທີ່ອະນຸມັດ'],
      ['ຊົ່ວໂມງເຮັດວຽກ', 'ເວລາອອກ − ເວລາເຂົ້າ − ເວລາພັກ (ສະເພາະມື້ທີ່ມີທັງເຂົ້າ ແລະ ອອກ)'],
      ['ເຮັດວຽກວັນພັກລັດຖະການ', 'ວັນພັກລັດຖະການທີ່ມີການລົງເວລາເຂົ້າ — ຊົ່ວໂມງຖືກນັບໃນ "ຊົ່ວໂມງເຮັດວຽກ" ແຕ່ບໍ່ນັບໃນ "ມື້ມາວຽກ"'],
      ['ການລົງເວລາທີ່ຖືກປະຕິເສດ', 'ບໍ່ນັບໃນລາຍງານ']
    ]
  };
  return [summarySheet, dailySheet, info];
}
