import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { defaultSettings } from './defaults';
import { attendanceSheets, buildAttendance, STATUS_LABEL, type ReportInput } from './attendanceReport';
import { buildXlsx, colLetter, safeSheetName, type Sheet } from './xlsx';
import { employees as seedEmployees, branches, shifts } from '../data/seed';
import type { Employee, LeaveRequest, ScanRecord } from './types';
import type { ShiftOverride } from './requests';

const S = defaultSettings('c1');
const base = seedEmployees.find(e => e.id === 'e-kl')!; // morning shift 06:00, Sunday off
const emp = (over: Partial<Employee> = {}): Employee => ({ ...base, startDate: '2026-10-01', ...over });
const at = (d: number, h: number, m: number, month = 10) => new Date(2026, month, d, h, m).toISOString();
let n = 0;
const scan = (employeeId: string, kind: ScanRecord['kind'], iso: string, over: Partial<ScanRecord> = {}): ScanRecord => ({
  id: 's' + n++, companyId: 'c1', employeeId, kind, deviceTime: iso, serverTime: iso, branchId: branches[0].id, status: 'ok', reasons: [], offline: false, ...over
});
const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  employees: [emp()], scans: [], leaves: [], ots: [], overrides: [], shifts, branches, settings: S, year: 2026, month: 10, today: '2026-11-06', ...over
});
const day = (r: ReturnType<typeof buildAttendance>, date: string, id = 'e-kl') => r.days.find(d => d.date === date && d.employee.id === id)!;

// Mon 2 Nov: 06:00 → 14:05 with a 30 min break · Tue 3 Nov: in 06:20, out 14:00 · Wed 4 Nov: approved leave · Thu 5 Nov: nothing
const week = (): ScanRecord[] => [
  scan('e-kl', 'in', at(2, 6, 0)), scan('e-kl', 'breakStart', at(2, 10, 0)), scan('e-kl', 'breakEnd', at(2, 10, 30)), scan('e-kl', 'out', at(2, 14, 5)),
  scan('e-kl', 'in', at(3, 6, 20)), scan('e-kl', 'out', at(3, 14, 0))
];
const leave: LeaveRequest = { id: 'l', companyId: 'c1', employeeId: 'e-kl', type: 'sick', from: '2026-11-04', to: '2026-11-04', days: 1, reason: 'x', createdAt: '2026-11-01T09:00:00', approvals: [], status: 'approved' };

describe('attendance report numbers', () => {
  const r = buildAttendance(input({ scans: week(), leaves: [leave] }));

  it('one row per reported day, up to but not including today when nothing happened today', () => {
    expect(r.days.map(d => d.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
  });
  it('a normal day: times, break taken out of the hours', () => {
    expect(day(r, '2026-11-02')).toMatchObject({ in: '06:00', breakStart: '10:00', breakEnd: '10:30', out: '14:05', workedMin: 455, lateMin: 0, status: 'ok', shiftTime: '06:00–14:00' });
  });
  it('late: minutes counted beyond the grace period', () => {
    expect(day(r, '2026-11-03')).toMatchObject({ in: '06:20', workedMin: 460, lateMin: 20, status: 'late' });
  });
  it('leave, day off and absence are told apart', () => {
    expect(day(r, '2026-11-04')).toMatchObject({ status: 'leave', note: 'ລາປ່ວຍ', workedMin: 0 });
    expect(day(r, '2026-11-01').status).toBe('dayoff'); // Sunday
    expect(day(r, '2026-11-05').status).toBe('absent');
  });
  it('summary agrees with the rows', () => {
    expect(r.summary).toHaveLength(1);
    expect(r.summary[0]).toMatchObject({ workedDays: 2, lateDays: 1, lateMin: 20, absentDays: 1, leaveDays: 1, dayOffDays: 1, holidayDays: 0, pendingDays: 0, hours: 15.25 }); // 455 + 460 min
  });
  it('a grace-period arrival is on time', () => {
    const g = buildAttendance(input({ scans: [scan('e-kl', 'in', at(2, 6, 5)), scan('e-kl', 'out', at(2, 14, 0))] }));
    expect(day(g, '2026-11-02')).toMatchObject({ status: 'ok', lateMin: 0 });
    const g2 = buildAttendance(input({ scans: [scan('e-kl', 'in', at(2, 6, 6)), scan('e-kl', 'out', at(2, 14, 0))] }));
    expect(day(g2, '2026-11-02')).toMatchObject({ status: 'late', lateMin: 6 });
  });
  it('today is reported once the person has scanned in, with no hours until they scan out', () => {
    const t = buildAttendance(input({ scans: [scan('e-kl', 'in', at(6, 6, 0))] }));
    expect(day(t, '2026-11-06')).toMatchObject({ in: '06:00', workedMin: 0, status: 'ok' });
  });
});

describe('what is and is not counted', () => {
  it('rejected scans are ignored; pending ones show as pending with their reasons', () => {
    const r = buildAttendance(input({ scans: [
      scan('e-kl', 'in', at(2, 6, 0), { status: 'rejected', reasons: ['ໜ້າກົງກັນຕ່ຳ 40%'] }),
      scan('e-kl', 'in', at(3, 6, 0), { status: 'pending', reasons: ['ບໍ່ມີ GPS'] })
    ] }));
    expect(day(r, '2026-11-02').status).toBe('absent'); // the rejected scan does not make the day a worked day
    expect(day(r, '2026-11-02').in).toBeUndefined(); // ...and its time does not appear in the row either
    const withOut = buildAttendance(input({ scans: [scan('e-kl', 'in', at(2, 6, 0)), scan('e-kl', 'out', at(2, 18, 0), { status: 'rejected' })] }));
    expect(day(withOut, '2026-11-02')).toMatchObject({ in: '06:00', workedMin: 0 }); // a rejected clock-out never creates hours
    expect(day(withOut, '2026-11-02').out).toBeUndefined();
    expect(day(r, '2026-11-03')).toMatchObject({ status: 'pending', note: 'ບໍ່ມີ GPS' });
    expect(r.summary[0].pendingDays).toBe(1);
    expect(r.summary[0].workedDays).toBe(1); // pending still shows up as attendance to be confirmed
  });
  it('an offline scan not yet confirmed by the server is flagged, a confirmed one is not', () => {
    const open = buildAttendance(input({ scans: [scan('e-kl', 'in', at(2, 6, 0), { offline: true, serverTime: undefined })] }));
    expect(day(open, '2026-11-02').note).toMatch('ບໍ່ມີເນັດ');
    const done = buildAttendance(input({ scans: [scan('e-kl', 'in', at(2, 6, 0), { offline: true, serverTime: at(2, 9, 0) })] }));
    expect(day(done, '2026-11-02').note).toBe('');
  });
  it('a head-approved scan says so', () => {
    const r = buildAttendance(input({ scans: [scan('e-kl', 'in', at(2, 6, 0), { status: 'approved', reasons: ['ບໍ່ມີ GPS'] })] }));
    expect(day(r, '2026-11-02').note).toMatch('ຫົວໜ້າຢືນຢັນແລ້ວ');
    expect(day(r, '2026-11-02').status).toBe('ok');
  });
  it('another employee\'s scans never leak into a row', () => {
    const other = emp({ id: 'e-other', code: 'ST-999', name: 'ຄົນອື່ນ' });
    const r = buildAttendance(input({ employees: [emp(), other], scans: [scan('e-other', 'in', at(2, 6, 0)), scan('e-other', 'out', at(2, 14, 0))] }));
    expect(day(r, '2026-11-02', 'e-kl').in).toBeUndefined();
    expect(day(r, '2026-11-02', 'e-other').in).toBe('06:00');
    expect(r.summary.map(s => s.employee.id)).toEqual(['e-kl', 'e-other']);
  });
  it('only approved OT of that month is summed', () => {
    const ots = [
      { id: 'o1', companyId: 'c1', employeeId: 'e-kl', date: '2026-11-02', minutes: 60, status: 'approved' as const },
      { id: 'o2', companyId: 'c1', employeeId: 'e-kl', date: '2026-11-03', minutes: 30, status: 'pending' as const },
      { id: 'o3', companyId: 'c1', employeeId: 'e-kl', date: '2026-10-30', minutes: 90, status: 'approved' as const }
    ];
    expect(buildAttendance(input({ ots })).summary[0].otMin).toBe(60);
  });
});

describe('schedule, holidays and employment dates', () => {
  it('public holiday from Settings', () => {
    const r = buildAttendance(input({ settings: { ...S, holidays: ['2026-11-05'] } }));
    expect(day(r, '2026-11-05').status).toBe('holiday');
    expect(r.summary[0].holidayDays).toBe(1);
    expect(r.summary[0].absentDays).toBe(3); // Mon–Wed had no scans; the holiday itself is not an absence
    expect(buildAttendance(input()).summary[0].absentDays).toBe(4); // without the holiday, Thu counts too
  });
  it('working on a public holiday is visible: hours kept, flagged, counted separately from normal worked days', () => {
    const r = buildAttendance(input({ settings: { ...S, holidays: ['2026-11-03'] }, scans: week() }));
    expect(day(r, '2026-11-03')).toMatchObject({ status: 'holiday', in: '06:20', workedMin: 460 });
    expect(day(r, '2026-11-03').note).toMatch('ມາເຮັດວຽກໃນວັນພັກລັດຖະການ');
    expect(r.summary[0]).toMatchObject({ holidayDays: 1, holidayWorkedDays: 1, workedDays: 1, lateDays: 0, hours: 15.25 });
    // an untouched holiday carries no such flag
    expect(buildAttendance(input({ settings: { ...S, holidays: ['2026-11-05'] } })).summary[0].holidayWorkedDays).toBe(0);
  });
  it('a scan on an approved leave day is flagged instead of silently hidden', () => {
    const r = buildAttendance(input({ leaves: [leave], scans: [scan('e-kl', 'in', at(4, 6, 0)), scan('e-kl', 'out', at(4, 14, 0))] }));
    expect(day(r, '2026-11-04')).toMatchObject({ status: 'leave' });
    expect(day(r, '2026-11-04').note).toMatch('ມີການລົງເວລາໃນວັນລາ');
  });
  it('an approved shift change: lateness is measured against the new shift, an "off" override is not absence', () => {
    const overrides: ShiftOverride[] = [
      { id: 'e-kl:2026-11-03', companyId: 'c1', employeeId: 'e-kl', date: '2026-11-03', shiftId: 'evening', source: 'r' },
      { id: 'e-kl:2026-11-05', companyId: 'c1', employeeId: 'e-kl', date: '2026-11-05', shiftId: 'off', source: 'r' }
    ];
    const r = buildAttendance(input({ overrides, scans: [scan('e-kl', 'in', at(3, 14, 3)), scan('e-kl', 'out', at(3, 22, 0))] }));
    expect(day(r, '2026-11-03')).toMatchObject({ shiftName: 'ກະແລງ', status: 'ok', lateMin: 0, workedMin: 477 });
    expect(day(r, '2026-11-05')).toMatchObject({ status: 'dayoff', shiftName: '—' });
  });
  it('no rows before the start date or after the end date', () => {
    const r = buildAttendance(input({ employees: [emp({ startDate: '2026-11-03', endDate: '2026-11-04' })] }));
    expect(r.days.map(d => d.date)).toEqual(['2026-11-03', '2026-11-04']);
  });
  it('a past month is reported to its last day', () => {
    const r = buildAttendance(input({ month: 9, today: '2026-11-06' })); // October, 31 days, hired 1 Oct
    expect(r.days).toHaveLength(31);
    expect(day(r, '2026-10-31').date).toBe('2026-10-31');
  });
  it('a month still in the future has no rows', () => expect(buildAttendance(input({ month: 11 })).days).toEqual([]));
  it('an empty employee list gives an empty report, not an error', () => {
    const r = buildAttendance(input({ employees: [] }));
    expect(r.days).toEqual([]);
    expect(r.summary).toEqual([]);
  });
  it('the status words are the ones used on screen', () => {
    expect(STATUS_LABEL.ok).toBe('ປົກກະຕິ');
    expect(STATUS_LABEL.late).toBe('ມາຊ້າ');
  });
});

describe('the three sheets', () => {
  const sheets = attendanceSheets(input({ scans: week(), leaves: [leave] }), { by: 'Admin', generatedAt: '02/11/2026 20:00', scopeNote: 'ທຸກພະແນກ' });
  it('names and column counts line up with the rows', () => {
    expect(sheets.map(s => s.name)).toEqual(['ສະຫຼຸບ', 'ລາຍລະອຽດລາຍມື້', 'ຂໍ້ມູນລາຍງານ']);
    for (const s of sheets) for (const row of s.rows) expect(row.length, s.name).toBe(s.columns.length);
  });
  it('the daily rows carry the date as dd/mm/yyyy, weekday and blanks for empty times', () => {
    const daily = sheets[1];
    const mon = daily.rows.find(r => r[0] === '02/11/2026')!;
    expect(mon.slice(1, 12)).toEqual(['ຈ', 'ST-012', 'ຄຳຫຼ້າ ອິນທະວົງ', 'ຄົວ', 'ກະເຊົ້າ', '06:00–14:00', '06:00', '10:00', '10:30', '14:05', 7.58]);
    const sun = daily.rows.find(r => r[0] === '01/11/2026')!;
    expect(sun[7]).toBeNull();
    expect(sun[13]).toBe('ວັນພັກ');
  });
  it('the information sheet records who exported, when, and the scope', () => {
    const info = Object.fromEntries(sheets[2].rows.map(r => [r[0], r[1]]));
    expect(info['ສ້າງໂດຍ']).toBe('Admin');
    expect(info['ຂອບເຂດຂໍ້ມູນ']).toBe('ທຸກພະແນກ');
    expect(info['ເດືອນ']).toBe('11/2026');
  });
});

// -------------------------------------------------------------------------------------------------
describe('the .xlsx file', () => {
  const sample: Sheet[] = [
    { name: 'ສະຫຼຸບ', columns: [{ header: 'ຊື່', width: 20 }, { header: 'ຊົ່ວໂມງ', format: 'decimal' }, { header: 'ມື້', format: 'int' }], rows: [['ນ້ອຍ & <ວົງສາ> "x"', 7.58, 3], ['ຄຳຫຼ້າ', null, 0]] },
    { name: 'ຫວ່າງ', columns: [{ header: 'A' }], rows: [] }
  ];
  const zip = unzipSync(buildXlsx(sample));
  const text = (p: string) => strFromU8(zip[p]);

  /** a strict-enough XML check: every tag closes, in order */
  const wellFormed = (xml: string) => {
    const stack: string[] = [];
    for (const m of xml.replace(/<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g)) {
      if (m[4]) continue;
      if (m[1]) { if (stack.pop() !== m[2]) return false; } else stack.push(m[2]);
    }
    return stack.length === 0;
  };

  it('is a zip with every part Excel needs', () => {
    for (const p of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) expect(zip[p], p).toBeDefined();
  });
  it('starts with the zip signature', () => expect(Array.from(buildXlsx(sample).slice(0, 2))).toEqual([0x50, 0x4b]));
  it('every part is well-formed XML', () => { for (const p of Object.keys(zip)) expect(wellFormed(text(p)), p).toBe(true); });
  it('workbook lists both sheets with their Lao names', () => {
    const wb = text('xl/workbook.xml');
    expect(wb).toContain('name="ສະຫຼຸບ"');
    expect(wb).toContain('name="ຫວ່າງ"');
  });
  it('text is escaped, numbers stay numbers, empty cells are omitted', () => {
    const sh = text('xl/worksheets/sheet1.xml');
    expect(sh).toContain('ນ້ອຍ &amp; &lt;ວົງສາ&gt; &quot;x&quot;');
    expect(sh).toContain('<c r="B2" s="3"><v>7.58</v></c>');
    expect(sh).toContain('<c r="C2" s="2"><v>3</v></c>');
    expect(sh).not.toContain('r="B3"'); // null
    expect(sh).toContain('<c r="C3" s="2"><v>0</v></c>'); // zero is a value, not blank
  });
  it('header row is styled, frozen and filtered', () => {
    const sh = text('xl/worksheets/sheet1.xml');
    expect(sh).toContain('<c r="A1" s="1" t="inlineStr">');
    expect(sh).toContain('state="frozen"');
    expect(sh).toContain('<autoFilter ref="A1:C3"/>');
    expect(text('xl/workbook.xml')).toMatch(/_xlnm\._FilterDatabase" localSheetId="0" hidden="1">'ສະຫຼຸບ'!\$A\$1:\$C\$3</);
  });
  it('a sheet with no data rows has no filter (Excel would flag it)', () => {
    expect(text('xl/worksheets/sheet2.xml')).not.toContain('autoFilter');
    expect(text('xl/workbook.xml')).not.toMatch(/localSheetId="1"/);
  });
  it('control characters that would corrupt the file are removed', () => {
    const z = unzipSync(buildXlsx([{ name: 'x', columns: [{ header: 'h\u0001' }], rows: [['a\u0000b\u000Bc']] }]));
    const sh = strFromU8(z['xl/worksheets/sheet1.xml']);
    expect(sh).toContain('>abc<');
    expect(sh).toContain('>h<');
  });
  it('NaN and Infinity are left blank instead of writing invalid numbers', () => {
    const z = unzipSync(buildXlsx([{ name: 'x', columns: [{ header: 'n', format: 'int' }], rows: [[NaN], [Infinity], [5]] }]));
    const sh = strFromU8(z['xl/worksheets/sheet1.xml']);
    expect(sh).not.toMatch(/NaN|Infinity/);
    expect(sh).toContain('<v>5</v>');
  });
  it('refuses an empty workbook', () => expect(() => buildXlsx([])).toThrow());
  it('column letters', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(colLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });
  it('sheet names obey Excel limits and stay unique', () => {
    const used = new Set<string>();
    expect(safeSheetName('a/b:c*d?e[f]g\\h', used)).toBe('a b c d e f g h');
    expect(safeSheetName('x'.repeat(50), used)).toHaveLength(31);
    expect(safeSheetName('ສະຫຼຸບ', used)).toBe('ສະຫຼຸບ');
    expect(safeSheetName('ສະຫຼຸບ', used)).toBe('ສະຫຼຸບ (2)');
    expect(safeSheetName('ສະຫຼຸບ', used)).toBe('ສະຫຼຸບ (3)');
    expect(safeSheetName('   ', used)).toBe('Sheet');
    const long = 'y'.repeat(31);
    safeSheetName(long, used);
    expect(safeSheetName(long, used)).toHaveLength(31);
  });
  it('a full month of 40 people builds quickly and stays small', () => {
    const people = Array.from({ length: 40 }, (_, i) => emp({ id: 'p' + i, code: 'ST-' + i, name: 'ພະນັກງານ ' + i }));
    const t0 = Date.now();
    const bytes = buildXlsx(attendanceSheets(input({ employees: people, today: '2026-11-30' }), { by: 'x', generatedAt: 'y', scopeNote: 'z' }));
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(bytes.length).toBeLessThan(200_000);
  });
});
