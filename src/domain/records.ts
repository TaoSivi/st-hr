import type { Branch } from './types';

/**
 * The "manage records" page lets the Admin and the Super admin correct or remove any record. This file says which records, which of their fields can
 * be edited and how a typed value becomes the stored one, so the screen stays a plain list and form.
 */
export type RecordKind = 'employees' | 'leaves' | 'advances' | 'scans' | 'ots' | 'payItems' | 'payrollRuns' | 'requests';

export const RECORD_KINDS: { id: RecordKind; label: string }[] = [
  { id: 'leaves', label: 'ການລາ' },
  { id: 'scans', label: 'ການລົງເວລາ' },
  { id: 'advances', label: 'ເບີກເງິນ' },
  { id: 'ots', label: 'OT' },
  { id: 'payItems', label: 'ໂບນັດ / ລາຍການເງິນເດືອນ' },
  { id: 'payrollRuns', label: 'ງວດເງິນເດືອນ' },
  { id: 'requests', label: 'ຄຳຂໍອື່ນໆ' },
  { id: 'employees', label: 'ພະນັກງານ' }
];

export type FieldKind = 'text' | 'number' | 'date' | 'datetime' | 'select';
export interface Field { key: string; label: string; kind: FieldKind; options?: [string, string][]; optional?: boolean }

const STATUS3: [string, string][] = [['pending', 'ລໍອະນຸມັດ'], ['approved', 'ອະນຸມັດແລ້ວ'], ['rejected', 'ປະຕິເສດ']];

/** The editable fields of each kind (a person is edited on the Staff page, so it has none here). */
export function fieldsFor(kind: RecordKind, ctx: { branches: Pick<Branch, 'id' | 'name'>[]; leaveTypes: Record<string, string>; scanKinds: Record<string, string>; payItemKinds: Record<string, string> }): Field[] {
  switch (kind) {
    case 'leaves': return [
      { key: 'type', label: 'ປະເພດ', kind: 'select', options: Object.entries(ctx.leaveTypes) },
      { key: 'from', label: 'ຈາກວັນທີ', kind: 'date' }, { key: 'to', label: 'ເຖິງວັນທີ', kind: 'date' },
      { key: 'days', label: 'ຈຳນວນມື້', kind: 'number' },
      { key: 'status', label: 'ສະຖານະ', kind: 'select', options: [...STATUS3, ['cancelled', 'ຍົກເລີກແລ້ວ']] },
      { key: 'reason', label: 'ເຫດຜົນ', kind: 'text', optional: true }
    ];
    case 'advances': return [
      { key: 'amount', label: 'ຈຳນວນເງິນ (ກີບ)', kind: 'number' }, { key: 'installments', label: 'ຜ່ອນເດືອນ', kind: 'number' },
      { key: 'remaining', label: 'ຄ້າງຢູ່ (ກີບ)', kind: 'number' }, { key: 'status', label: 'ສະຖານະ', kind: 'select', options: STATUS3 }
    ];
    case 'scans': return [
      { key: 'kind', label: 'ປະເພດ', kind: 'select', options: Object.entries(ctx.scanKinds) },
      { key: 'deviceTime', label: 'ເວລາ', kind: 'datetime' },
      { key: 'branchId', label: 'ສາຂາ', kind: 'select', options: ctx.branches.map(b => [b.id, b.name] as [string, string]), optional: true },
      { key: 'status', label: 'ສະຖານະ', kind: 'select', options: [['ok', 'ປົກກະຕິ'], ['pending', 'ລໍກວດ'], ['approved', 'ຢືນຢັນແລ້ວ'], ['rejected', 'ປະຕິເສດ']] },
      { key: 'reviewNote', label: 'ໝາຍເຫດ', kind: 'text', optional: true }
    ];
    case 'ots': return [
      { key: 'date', label: 'ວັນທີ', kind: 'date' }, { key: 'minutes', label: 'ນາທີ', kind: 'number' },
      { key: 'status', label: 'ສະຖານະ', kind: 'select', options: STATUS3 }
    ];
    case 'payItems': return [
      { key: 'kind', label: 'ປະເພດ', kind: 'select', options: Object.entries(ctx.payItemKinds) },
      { key: 'label', label: 'ຊື່ລາຍການ', kind: 'text' }, { key: 'amount', label: 'ຈຳນວນເງິນ (ກີບ)', kind: 'number' },
      { key: 'month', label: 'ເດືອນ (YYYY-MM)', kind: 'text' }, { key: 'status', label: 'ສະຖານະ', kind: 'select', options: STATUS3 },
      { key: 'note', label: 'ໝາຍເຫດ', kind: 'text', optional: true }
    ];
    case 'payrollRuns': return [{ key: 'status', label: 'ສະຖານະງວດ', kind: 'select', options: [['draft', 'ຮ່າງ'], ['prepared', 'ຄິດແລ້ວ (ເປີດຢູ່)'], ['locked', 'ປິດງວດແລ້ວ']] }];
    case 'requests': return [{ key: 'status', label: 'ສະຖານະ', kind: 'select', options: STATUS3 }, { key: 'reason', label: 'ເຫດຜົນ', kind: 'text', optional: true }];
    case 'employees': return [];
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
/** An ISO time as the value a datetime-local box wants (the viewer's own clock). */
export const isoToLocalInput = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** A record as the strings the form shows. */
export function toForm(rec: Record<string, unknown>, fields: Field[]): Record<string, string> {
  return Object.fromEntries(fields.map(f => {
    const v = rec[f.key];
    return [f.key, v === undefined || v === null ? '' : f.kind === 'datetime' ? isoToLocalInput(String(v)) : String(v)];
  }));
}

/** The record with the typed values put in, or the first thing wrong with them. Untouched fields keep their stored value. */
export function fromForm(rec: Record<string, unknown>, fields: Field[], form: Record<string, string>): { next: Record<string, unknown> } | { error: string } {
  const next: Record<string, unknown> = { ...rec };
  for (const f of fields) {
    const raw = (form[f.key] ?? '').trim();
    if (raw === '') {
      if (!f.optional) return { error: `ໃສ່ ${f.label}` };
      delete next[f.key];
      continue;
    }
    if (f.kind === 'number') {
      const n = Number(raw.replace(/,/g, ''));
      if (!Number.isFinite(n) || n < 0) return { error: `${f.label} ຕ້ອງເປັນຕົວເລກບໍ່ຕິດລົບ` };
      next[f.key] = n;
    } else if (f.kind === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(new Date(raw).getTime())) return { error: `${f.label} ບໍ່ຖືກຕ້ອງ` };
      next[f.key] = raw;
    } else if (f.kind === 'datetime') {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return { error: `${f.label} ບໍ່ຖືກຕ້ອງ` };
      next[f.key] = d.toISOString();
    } else if (f.kind === 'select') {
      if (!(f.options ?? []).some(([v]) => v === raw)) return { error: `${f.label} ບໍ່ຖືກຕ້ອງ` };
      next[f.key] = raw;
    } else next[f.key] = raw;
  }
  if (typeof next.from === 'string' && typeof next.to === 'string' && next.from > next.to) return { error: 'ວັນທີເລີ່ມຕ້ອງບໍ່ຫຼັງວັນທີສິ້ນສຸດ' };
  if ('month' in next && typeof next.month === 'string' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(next.month)) return { error: 'ເດືອນຕ້ອງເປັນ YYYY-MM' };
  return { next };
};

/** Why a person cannot be removed from the roster for good (everything recorded for them would be left pointing at nobody), or null. */
export function employeeDeleteBlock(
  e: { id: string },
  ctx: { meId: string; has: Record<'scans' | 'leaves' | 'advances' | 'payItems' | 'requests' | 'ots', { employeeId: string }[]> }
): string | null {
  if (e.id === ctx.meId) return 'ລຶບບັນຊີຂອງຕົນເອງບໍ່ໄດ້';
  const names: Record<string, string> = { scans: 'ການລົງເວລາ', leaves: 'ການລາ', advances: 'ເບີກເງິນ', payItems: 'ລາຍການເງິນເດືອນ', requests: 'ຄຳຂໍ', ots: 'OT' };
  const used = (Object.keys(names) as (keyof typeof names)[]).filter(k => (ctx.has as Record<string, { employeeId: string }[]>)[k].some(r => r.employeeId === e.id));
  return used.length ? `ມີປະຫວັດ (${used.map(k => names[k]).join(', ')}) — ລຶບບໍ່ໄດ້ ເພາະບັນທຶກເກົ່າຈະບໍ່ມີເຈົ້າຂອງ. ໃຊ້ "ປິດບັນຊີ" ໃນໜ້າ ພະນັກງານ ແທນ` : null;
}
