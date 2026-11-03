import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { IMPORT_COLUMNS, parseDate, parseDayOff, parseMoney, parseStaffRows, staffTemplate } from './staffImport';
import { colIndex, readCsvRows, readXlsxRows } from './xlsxRead';
import { buildXlsx } from './xlsx';
import { branches, employees, shifts } from '../data/seed';

let n = 0;
const ctx = { existing: employees, shifts, branches, companyId: 'c1', newId: () => 'imp-' + n++ };
const header = IMPORT_COLUMNS.map(c => c.header);
const row = (over: Partial<Record<string, string>> = {}) => IMPORT_COLUMNS.map(c => over[c.field] ?? ({
  name: 'ທົດລອງ ນຳເຂົ້າ', dept: 'ຄົວ', position: 'ພໍ່ຄົວ', startDate: '01/11/2026', baseSalary: '5,000,000'
} as Record<string, string>)[c.field] ?? '');

describe('reading the cells', () => {
  it('column letters', () => { expect(colIndex('A')).toBe(0); expect(colIndex('Z')).toBe(25); expect(colIndex('AA')).toBe(26); expect(colIndex('AB')).toBe(27); });
  it('dates people type, and the numbers Excel stores', () => {
    expect(parseDate('01/11/2026')).toBe('2026-11-01');
    expect(parseDate('1/2/2026')).toBe('2026-02-01');
    expect(parseDate('2026-11-01')).toBe('2026-11-01');
    expect(parseDate('46327')).toBe('2026-11-01'); // Excel serial
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('ມື້ວານ')).toBeNull();
  });
  it('money with separators and the kip sign', () => {
    expect(parseMoney('8,500,000')).toBe(8500000);
    expect(parseMoney('3 500 000 ₭')).toBe(3500000);
    expect(parseMoney('ຫ້າລ້ານ')).toBeNaN();
    expect(parseMoney('')).toBeNaN();
  });
  it('days off in Lao, one or several', () => {
    expect(parseDayOff('')).toEqual([0]);
    expect(parseDayOff('ອາທິດ')).toEqual([0]);
    expect(parseDayOff('ເສົາ, ອາທິດ')).toEqual([0, 6]);
    expect(parseDayOff('ວັນຈັນ')).toEqual([1]);
    expect(parseDayOff('ທຸກມື້')).toBeNull();
  });
  it('CSV from Excel, with quotes, a BOM and semicolons', () => {
    expect(readCsvRows('﻿a,"b, c",d\n1,"say ""hi""",3\n')).toEqual([['a', 'b, c', 'd'], ['1', 'say "hi"', '3']]);
    expect(readCsvRows('x;y\r\n1;2')).toEqual([['x', 'y'], ['1', '2']]);
  });
});

describe('the template round-trips through Excel format', () => {
  it('what we hand out can be read back, header and examples included', () => {
    const bytes = buildXlsx(staffTemplate({ branches, shifts }));
    const rows = readXlsxRows(bytes);
    expect(rows[0][1]).toBe('ຊື່ ແລະ ນາມສະກຸນ *');
    expect(rows[1][1]).toBe('ສົມສັກ ພົມມະຈັນ');
    const res = parseStaffRows(rows, { ...ctx, existing: [] });
    expect(res.missingColumns).toEqual([]);
    expect(res.ok.map(e => e.name)).toEqual(['ສົມສັກ ພົມມະຈັນ', 'ນາງ ແສງເດືອນ ສີວົງ']);
    expect(res.ok[1]).toMatchObject({ payMethod: 'cash', dayOff: [0, 6], startDate: '2026-11-15', homeBranchId: branches[0].id, shiftId: shifts[0].id });
    expect(res.ok[0]).toMatchObject({ payMethod: 'bank', bankName: 'LDB', bankAccount: '0201000123456', baseSalary: 5000000, allowance: 300000 });
  });
  it('reads a workbook written by Excel itself: shared strings, rich text, gaps between cells, numbers', () => {
    const xml = (s: string) => strToU8(s);
    const bytes = zipSync({
      'xl/workbook.xml': xml('<workbook xmlns:r="r"><sheets><sheet name="A" sheetId="1" r:id="rId9"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': xml('<Relationships><Relationship Id="rId9" Type="ws" Target="worksheets/data.xml"/></Relationships>'),
      'xl/sharedStrings.xml': xml('<sst><si><t>ຊື່</t></si><si><r><t>ສົມ</t></r><r><t xml:space="preserve"> ໃຈ</t></r></si><si><t>A&amp;B</t></si></sst>'),
      'xl/worksheets/data.xml': xml('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>2</v></c></row><row r="3"><c r="B3" t="s"><v>1</v></c><c r="C3"><v>46327</v></c></row></sheetData></worksheet>')
    });
    const rows = readXlsxRows(bytes);
    expect(rows[0]).toEqual(['ຊື່', '', 'A&B']);
    expect(rows[1]).toEqual([]);
    expect(rows[2]).toEqual(['', 'ສົມ ໃຈ', '46327']);
  });
  it('a file that is not a workbook says so in Lao', () => expect(() => readXlsxRows(new Uint8Array([1, 2, 3]))).toThrow('ອ່ານໄຟລ໌ບໍ່ໄດ້'));
});

describe('turning rows into new employees', () => {
  it('finds the header even under a title line, and gives codes after the existing ones', () => {
    const res = parseStaffRows([['ລາຍຊື່ພະນັກງານ ປີ 2026'], header, row(), row({ name: 'ຄົນທີສອງ' })], ctx);
    expect(res.headerLine).toBe(1);
    expect(res.ok).toHaveLength(2);
    const top = Math.max(...employees.map(e => parseInt(e.code.slice(3), 10)));
    expect(res.ok.map(e => e.code)).toEqual([`ST-${String(top + 1).padStart(3, '0')}`, `ST-${String(top + 2).padStart(3, '0')}`]);
    expect(res.ok.every(e => e.roles.length === 1 && e.roles[0] === 'employee')).toBe(true);
  });
  it('says which required columns are missing instead of guessing', () => {
    const res = parseStaffRows([['ຊື່ ແລະ ນາມສະກຸນ', 'ພະແນກ', 'ຕຳແໜ່ງ']], ctx);
    expect(res.missingColumns).toEqual(['ວັນເລີ່ມວຽກ', 'ເງິນເດືອນພື້ນຖານ']);
    expect(parseStaffRows([['x', 'y']], ctx).headerLine).toBeNull();
  });
  it('each bad row says what is wrong, in Lao, and is left out; the good rows still go in', () => {
    const res = parseStaffRows([header,
      row({ name: '' }),
      row({ name: 'ກ', branch: 'ສາຂາດາວອັງຄານ' }),
      row({ name: 'ຂ', shift: 'ກະເດິກ' }),
      row({ name: 'ຄ', startDate: '31/02/2026' }),
      row({ name: 'ງ', baseSalary: 'ບໍ່ຮູ້' }),
      row({ name: 'ຈ', payMethod: 'ໂອນ', bankAccount: '' }),
      row({ name: 'ສ', bankAccount: '2.01E+12' }),
      row({ name: 'ຊ', dayOff: 'ທຸກມື້' }),
      row({ name: 'ດີ' })
    ], ctx);
    const err = (line: number) => res.rows.find(r => r.line === line)!.errors.join(' | ');
    expect(err(2)).toMatch('ຕ້ອງໃສ່ຊື່');
    expect(err(3)).toMatch('ບໍ່ມີສາຂາ "ສາຂາດາວອັງຄານ"');
    expect(err(3)).not.toMatch('ເລືອກສາຂາຫຼັກ'); // one clear message, not two
    expect(err(4)).toMatch('ບໍ່ມີກະ "ກະເດິກ"');
    expect(err(5)).toMatch('ວັນເລີ່ມວຽກ "31/02/2026"');
    expect(err(6)).toMatch('ບໍ່ແມ່ນຕົວເລກ');
    expect(err(7)).toMatch('ເລກບັນຊີ');
    expect(err(8)).toMatch('ເລກວິທະຍາສາດ');
    expect(err(9)).toMatch('ວັນພັກ');
    expect(res.ok.map(e => e.name)).toEqual(['ດີ']);
  });
  it('the same person twice in the file, or someone already on the roster, is caught', () => {
    const someone = employees.find(e => !e.endDate)!;
    const res = parseStaffRows([header, row({ name: 'ສອງເທື່ອ' }), row({ name: 'ສອງເທື່ອ' }), row({ name: someone.name, dept: someone.dept }), row({ name: 'ລະຫັດຊ້ຳ', code: someone.code })], ctx);
    expect(res.rows[1].errors.join()).toMatch('ຊື່ ແລະ ພະແນກດຽວກັນ');
    expect(res.rows[2].errors.join()).toMatch('ຊື່ ແລະ ພະແນກດຽວກັນ');
    expect(res.rows[3].errors.join()).toMatch('ຊ້ຳ');
    expect(res.ok).toHaveLength(1);
  });
  it('blank lines are skipped, and branch / shift names match whatever the case or spacing', () => {
    const res = parseStaffRows([header, [], row({ branch: ` ${branches[0].name.toUpperCase()} `, shift: shifts[1].name }), ['', '', '']], ctx);
    expect(res.rows).toHaveLength(1);
    expect(res.ok[0]).toMatchObject({ homeBranchId: branches[0].id, shiftId: shifts[1].id });
  });
});
