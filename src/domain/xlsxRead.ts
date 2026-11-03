import { strFromU8, unzipSync } from 'fflate';

/**
 * Reads the first worksheet of an .xlsx file into rows of text, the way it looks in Excel's cells.
 * Small and dependency-light like the writer: shared strings, inline strings, numbers and booleans; formulas give their cached value.
 * Works without a browser DOM, so it can be tested in Node.
 */
const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');

/** All the text runs of one <si> or <is>, joined (rich text is split into several <t>). Phonetic hints (<rPh>) are not cell text. */
const textOf = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map(m => unescape(m[1] ?? '')).join('');

/** "A" → 0, "Z" → 25, "AA" → 26 */
export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function readXlsxRows(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch { throw new Error('ອ່ານໄຟລ໌ບໍ່ໄດ້ — ກະລຸນາບັນທຶກເປັນ Excel (.xlsx)'); }
  const text = (path: string) => (files[path] ? strFromU8(files[path]) : '');

  // the first sheet in workbook order, found through the workbook's relationships (it is not always sheet1.xml)
  const wb = text('xl/workbook.xml');
  const rels = text('xl/_rels/workbook.xml.rels');
  const firstRid = wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const target = firstRid ? rels.match(new RegExp(`<Relationship\\b[^>]*Id="${firstRid}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${firstRid}"`))?.[1] : undefined;
  const sheetPath = target ? (target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '')) : 'xl/worksheets/sheet1.xml';
  const sheet = text(sheetPath) || text('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('ບໍ່ພົບແຜ່ນງານໃນໄຟລ໌');

  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1]));
  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const attrs = rm[1] ?? rm[3] ?? '';
    const r = Number(attrs.match(/\br="(\d+)"/)?.[1] ?? rows.length + 1) - 1;
    const row: string[] = [];
    let next = 0;
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = cm[1];
      const ref = a.match(/\br="([A-Z]+)\d+"/)?.[1];
      const col = ref ? colIndex(ref) : next;
      next = col + 1;
      const type = a.match(/\bt="([^"]+)"/)?.[1];
      const inner = cm[2] ?? '';
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = textOf(inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? '');
      else if (type === 'b') value = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
      else if (v !== undefined) value = unescape(v);
      row[col] = value;
    }
    rows[r] = Array.from(row, x => x ?? '');
  }
  return Array.from(rows, x => x ?? []);
}

/** Comma- or semicolon-separated text (Excel's "Save as CSV"), with quoted fields. A UTF-8 BOM is ignored. */
export function readCsvRows(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const firstLine = s.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
