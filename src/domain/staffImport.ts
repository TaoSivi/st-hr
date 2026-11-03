import type { Branch, Employee, Shift } from './types';
import type { Sheet } from './xlsx';
import { nextEmployeeCode, validateNewEmployee } from './hiring';

/**
 * Bringing a staff list in from Excel. Every row goes through the same checks as hiring one person by hand,
 * and new people always start as plain employees: roles are granted afterwards by the owner, as before.
 */

type Field = 'code' | 'name' | 'dept' | 'position' | 'branch' | 'shift' | 'dayOff' | 'startDate' | 'baseSalary' | 'allowance' | 'payMethod' | 'bankName' | 'bankAccount';

export const IMPORT_COLUMNS: { field: Field; header: string; required?: boolean; width: number; note: string }[] = [
  { field: 'code', header: 'ລະຫັດ', width: 10, note: 'ປ່ອຍວ່າງໄດ້ — ລະບົບອອກໃຫ້ (ST-001, ST-002…)' },
  { field: 'name', header: 'ຊື່ ແລະ ນາມສະກຸນ', required: true, width: 26, note: 'ຕ້ອງໃສ່' },
  { field: 'dept', header: 'ພະແນກ', required: true, width: 14, note: 'ຕ້ອງໃສ່ ເຊັ່ນ ຄົວ, ບໍລິການ' },
  { field: 'position', header: 'ຕຳແໜ່ງ', required: true, width: 16, note: 'ຕ້ອງໃສ່ ເຊັ່ນ ພະນັກງານເສີບ' },
  { field: 'branch', header: 'ສາຂາ', width: 16, note: 'ຊື່ສາຂາຕາມໃນລະບົບ; ປ່ອຍວ່າງ = ສາຂາທຳອິດ' },
  { field: 'shift', header: 'ກະ', width: 12, note: 'ຊື່ກະຕາມໃນລະບົບ; ປ່ອຍວ່າງ = ກະທຳອິດ' },
  { field: 'dayOff', header: 'ວັນພັກປະຈຳອາທິດ', width: 18, note: 'ເຊັ່ນ ອາທິດ ຫຼື ເສົາ, ອາທິດ; ປ່ອຍວ່າງ = ອາທິດ' },
  { field: 'startDate', header: 'ວັນເລີ່ມວຽກ', required: true, width: 14, note: 'ຕ້ອງໃສ່ ເຊັ່ນ 01/11/2026' },
  { field: 'baseSalary', header: 'ເງິນເດືອນພື້ນຖານ', required: true, width: 16, note: 'ຕ້ອງໃສ່ ເປັນກີບ' },
  { field: 'allowance', header: 'ເງິນອຸດໜູນ', width: 12, note: 'ປ່ອຍວ່າງ = 0' },
  { field: 'payMethod', header: 'ວິທີຈ່າຍ', width: 10, note: 'ໂອນ ຫຼື ເງິນສົດ; ປ່ອຍວ່າງ = ໂອນ ຖ້າມີເລກບັນຊີ' },
  { field: 'bankName', header: 'ທະນາຄານ', width: 10, note: 'ເຊັ່ນ LDB, BCEL, JDB' },
  { field: 'bankAccount', header: 'ເລກບັນຊີ', width: 20, note: 'ຕັ້ງຖັນນີ້ເປັນ Text ກ່ອນພິມ ເພື່ອບໍ່ໃຫ້ເລກ 0 ທາງໜ້າຫາຍ' }
];

const DAY_NAMES: [number, string[]][] = [
  [0, ['ອາທິດ', 'ທິດ', 'sun', 'sunday']], [1, ['ຈັນ', 'mon', 'monday']], [2, ['ອັງຄານ', 'tue', 'tuesday']], [3, ['ພຸດ', 'wed', 'wednesday']],
  [4, ['ພະຫັດ', 'thu', 'thursday']], [5, ['ສຸກ', 'fri', 'friday']], [6, ['ເສົາ', 'sat', 'saturday']]
];

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** "ເສົາ, ອາທິດ" → [0, 6]; null when a word is not a day. */
export function parseDayOff(raw: string): number[] | null {
  const parts = raw.split(/[,/;、]|\s+ແລະ\s+|\s+/).map(p => norm(p).replace(/^ວັນ/, '')).filter(Boolean);
  if (!parts.length) return [0];
  const days = new Set<number>();
  for (const p of parts) {
    const hit = DAY_NAMES.find(([, names]) => names.includes(p));
    if (!hit) return null;
    days.add(hit[0]);
  }
  return [...days].sort();
}

const pad = (n: number) => String(n).padStart(2, '0');
const realDate = (y: number, m: number, d: number) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };

/** 01/11/2026, 1/11/2026, 2026-11-01, or an Excel date number (45962) → "2026-11-01"; null when it is not a real date. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  if (/^\d{4,6}(\.\d+)?$/.test(s) && +s > 20000 && +s < 80000) { // Excel's day count since 1899-12-30
    const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 86400000);
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  }
  let mt = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (mt) [y, m, d] = [+mt[1], +mt[2], +mt[3]];
  else if ((mt = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) [d, m, y] = [+mt[1], +mt[2], +mt[3]];
  else return null;
  return realDate(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** "8,500,000 ₭" → 8500000; NaN when it is not a number. */
export function parseMoney(raw: string): number {
  const s = raw.replace(/[\s,₭]|ກີບ|kip/gi, '');
  return s === '' ? NaN : /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

export interface ImportRow { line: number; employee?: Employee; errors: string[] }
export interface ImportResult { rows: ImportRow[]; ok: Employee[]; missingColumns: string[]; headerLine: number | null }

/** Finds the header row (in the first few rows), then turns every following non-empty row into an employee or a list of problems. */
export function parseStaffRows(
  table: string[][],
  ctx: { existing: Employee[]; shifts: Shift[]; branches: Branch[]; companyId: string; newId: () => string }
): ImportResult {
  const wanted = IMPORT_COLUMNS.map(c => ({ ...c, key: norm(c.header) }));
  let headerLine: number | null = null;
  const at: Partial<Record<Field, number>> = {};
  for (let r = 0; r < Math.min(table.length, 6) && headerLine === null; r++) {
    const cells = (table[r] ?? []).map(c => norm(String(c ?? '')).replace(/\s*\*$/, ''));
    const hits = wanted.filter(w => cells.includes(w.key));
    if (hits.length >= 3) {
      headerLine = r;
      for (const w of wanted) { const i = cells.indexOf(w.key); if (i >= 0) at[w.field] = i; }
    }
  }
  const missingColumns = headerLine === null ? IMPORT_COLUMNS.filter(c => c.required).map(c => c.header) : IMPORT_COLUMNS.filter(c => c.required && at[c.field] === undefined).map(c => c.header);
  if (headerLine === null || missingColumns.length) return { rows: [], ok: [], missingColumns, headerLine };

  const seen: Employee[] = [...ctx.existing];
  const rows: ImportRow[] = [];
  for (let r = headerLine + 1; r < table.length; r++) {
    const cell = (f: Field) => (at[f] === undefined ? '' : String(table[r]?.[at[f]!] ?? '').trim());
    if (IMPORT_COLUMNS.every(c => cell(c.field) === '')) continue; // blank line
    const errors: string[] = [];
    const branchName = cell('branch'), shiftName = cell('shift');
    const branch = branchName ? ctx.branches.find(b => norm(b.name) === norm(branchName)) : ctx.branches[0];
    if (branchName && !branch) errors.push(`ບໍ່ມີສາຂາ "${branchName}" ໃນລະບົບ`);
    const shift = shiftName ? ctx.shifts.find(s => norm(s.name) === norm(shiftName)) : ctx.shifts[0];
    if (shiftName && !shift) errors.push(`ບໍ່ມີກະ "${shiftName}" ໃນລະບົບ`);
    const dayOff = parseDayOff(cell('dayOff'));
    if (!dayOff) errors.push(`ວັນພັກ "${cell('dayOff')}" ອ່ານບໍ່ອອກ (ໃຊ້ ອາທິດ, ຈັນ, ອັງຄານ, ພຸດ, ພະຫັດ, ສຸກ, ເສົາ)`);
    const startDate = parseDate(cell('startDate'));
    if (cell('startDate') && !startDate) errors.push(`ວັນເລີ່ມວຽກ "${cell('startDate')}" ບໍ່ຖືກ (ໃຊ້ ວັນ/ເດືອນ/ປີ ເຊັ່ນ 01/11/2026)`);
    const salaryRaw = cell('baseSalary'), allowanceRaw = cell('allowance');
    const baseSalary = parseMoney(salaryRaw);
    if (salaryRaw && Number.isNaN(baseSalary)) errors.push(`ເງິນເດືອນ "${salaryRaw}" ບໍ່ແມ່ນຕົວເລກ`);
    const allowance = allowanceRaw === '' ? 0 : parseMoney(allowanceRaw);
    if (Number.isNaN(allowance)) errors.push(`ເງິນອຸດໜູນ "${allowanceRaw}" ບໍ່ແມ່ນຕົວເລກ`);
    const account = cell('bankAccount');
    if (/e\+?\d+$/i.test(account)) errors.push('ເລກບັນຊີຖືກ Excel ປ່ຽນເປັນເລກວິທະຍາສາດ — ຕັ້ງຖັນເປັນ Text ແລ້ວພິມໃໝ່');
    const pm = norm(cell('payMethod'));
    const payMethod: Employee['payMethod'] | null = pm === '' ? (account ? 'bank' : 'cash') : ['ໂອນ', 'bank', 'ທະນາຄານ', 'ໂອນເງິນ'].includes(pm) ? 'bank' : ['ເງິນສົດ', 'cash', 'ສົດ'].includes(pm) ? 'cash' : null;
    if (!payMethod) errors.push(`ວິທີຈ່າຍ "${cell('payMethod')}" ຕ້ອງເປັນ ໂອນ ຫຼື ເງິນສົດ`);

    const e: Employee = {
      id: ctx.newId(), companyId: ctx.companyId,
      code: cell('code') || nextEmployeeCode(seen),
      name: cell('name'), dept: cell('dept'), position: cell('position'), roles: ['employee'],
      homeBranchId: branch?.id ?? '', shiftId: shift?.id ?? '', dayOff: dayOff ?? [0],
      startDate: startDate ?? cell('startDate'), baseSalary, allowance: Number.isNaN(allowance) ? 0 : allowance,
      payMethod: payMethod ?? 'cash',
      ...(payMethod === 'bank' ? { bankName: cell('bankName') || undefined, bankAccount: account || undefined } : {})
    };
    // the same checks as hiring one person, against the roster plus the rows already accepted from this file
    for (const m of validateNewEmployee(e, seen, ctx.shifts, ctx.branches)) if (!errors.some(x => x.includes(m))) errors.push(m);
    const clean = [...new Set(errors)].filter(x => !(x === 'ເລືອກສາຂາຫຼັກ' && branchName) && !(x === 'ເລືອກກະທີ່ມີຢູ່ໃນລະບົບ' && shiftName) && !(x === 'ວັນເລີ່ມວຽກບໍ່ຖືກຕ້ອງ' && cell('startDate')) && !(x === 'ເງິນເດືອນພື້ນຖານຕ້ອງຫຼາຍກວ່າ 0' && Number.isNaN(baseSalary) && salaryRaw));
    if (!clean.length) seen.push(e);
    rows.push({ line: r + 1, employee: e, errors: clean });
  }
  return { rows, ok: rows.filter(r => !r.errors.length).map(r => r.employee!), missingColumns: [], headerLine };
}

/** The workbook people fill in: the list sheet with two example rows, and a sheet that explains every column and lists the valid names. */
export function staffTemplate(ctx: { branches: Branch[]; shifts: Shift[] }): Sheet[] {
  const b = ctx.branches[0]?.name ?? '', s = ctx.shifts[0]?.name ?? '';
  const list: Sheet = {
    name: 'ລາຍຊື່ພະນັກງານ',
    columns: IMPORT_COLUMNS.map(c => ({ header: c.header + (c.required ? ' *' : ''), width: c.width, format: 'text' as const })),
    rows: [
      ['', 'ສົມສັກ ພົມມະຈັນ', 'ຄົວ', 'ພໍ່ຄົວ', b, s, 'ອາທິດ', '01/11/2026', '5000000', '300000', 'ໂອນ', 'LDB', '0201000123456'],
      ['', 'ນາງ ແສງເດືອນ ສີວົງ', 'ບໍລິການ', 'ພະນັກງານເສີບ', b, s, 'ເສົາ, ອາທິດ', '15/11/2026', '3500000', '', 'ເງິນສົດ', '', '']
    ]
  };
  const help: Sheet = {
    name: 'ວິທີໃສ່',
    columns: [{ header: 'ຖັນ', width: 22 }, { header: 'ວິທີໃສ່', width: 70 }],
    rows: [
      ...IMPORT_COLUMNS.map(c => [c.header + (c.required ? ' *' : ''), c.note]),
      ['', ''],
      ['ສາຂາທີ່ມີ', ctx.branches.map(x => x.name).join(', ') || '—'],
      ['ກະທີ່ມີ', ctx.shifts.map(x => x.name).join(', ') || '—'],
      ['ໝາຍເຫດ', 'ລຶບ 2 ແຖວຕົວຢ່າງອອກກ່ອນ. ແຖວທີ່ມີບັນຫາຈະບໍ່ຖືກນຳເຂົ້າ ແລະ ຈະບອກວ່າຜິດຫຍັງ. ບົດບາດ (ຫົວໜ້າ, ບັນຊີ…) ໃຫ້ກຳນົດໃນລະບົບຫຼັງນຳເຂົ້າ.']
    ]
  };
  return [list, help];
}
