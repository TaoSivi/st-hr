import { describe, expect, it } from 'vitest';
import { employeeDeleteBlock, fieldsFor, fromForm, isoToLocalInput, toForm, RECORD_KINDS } from './records';

const ctx = { branches: [{ id: 'b1', name: 'ສາຂາຫຼັກ' }], leaveTypes: { annual: 'ລາປະຈຳປີ', sick: 'ລາປ່ວຍ' }, scanKinds: { in: 'ເຂົ້າວຽກ', out: 'ອອກວຽກ' }, payItemKinds: { bonus: 'ໂບນັດ' } };

describe('records: forms', () => {
  it('every kind but the person has something to edit, and each field has a label and a kind', () => {
    for (const k of RECORD_KINDS) {
      const f = fieldsFor(k.id, ctx);
      if (k.id === 'employees') expect(f).toEqual([]); else expect(f.length).toBeGreaterThan(0);
      for (const x of f) { expect(x.label).toBeTruthy(); if (x.kind === 'select') expect(x.options!.length).toBeGreaterThan(0); }
    }
  });
  it('a record goes into the form as text and comes back the same when nothing was touched', () => {
    const leave = { id: 'l1', type: 'annual', from: '2026-11-10', to: '2026-11-11', days: 2, status: 'approved', reason: 'ທຸລະ', approvals: [] };
    const f = fieldsFor('leaves', ctx);
    const r = fromForm(leave, f, toForm(leave, f));
    expect(r).toEqual({ next: leave });
  });
  it('a scan time survives the trip through the datetime box (to the minute)', () => {
    const iso = '2026-11-04T08:07:31.000Z';
    const scan = { id: 's', kind: 'in', deviceTime: iso, status: 'ok', reasons: [] };
    const f = fieldsFor('scans', ctx);
    const r = fromForm(scan, f, toForm(scan, f)) as { next: { deviceTime: string } };
    expect(new Date(r.next.deviceTime).getTime()).toBe(new Date(isoToLocalInput(iso)).getTime());
    expect(Math.abs(new Date(r.next.deviceTime).getTime() - new Date(iso).getTime())).toBeLessThan(60_000);
  });
  it('typed numbers, dates and choices are checked', () => {
    const f = fieldsFor('leaves', ctx);
    const form = { type: 'annual', from: '2026-11-10', to: '2026-11-09', days: '1', status: 'approved', reason: '' };
    expect(fromForm({ id: 'l' }, f, form)).toEqual({ error: 'ວັນທີເລີ່ມຕ້ອງບໍ່ຫຼັງວັນທີສິ້ນສຸດ' });
    expect(fromForm({ id: 'l' }, f, { ...form, to: '2026-11-12', days: '-1' })).toMatchObject({ error: expect.stringContaining('ຈຳນວນມື້') });
    expect(fromForm({ id: 'l' }, f, { ...form, to: '2026-11-12', from: '10/11' })).toMatchObject({ error: expect.stringContaining('ບໍ່ຖືກຕ້ອງ') });
    expect(fromForm({ id: 'l' }, f, { ...form, to: '2026-11-12', type: 'nope' })).toMatchObject({ error: expect.stringContaining('ປະເພດ') });
    expect(fromForm({ id: 'l' }, f, { ...form, to: '2026-11-12', status: '' })).toMatchObject({ error: expect.stringContaining('ສະຖານະ') });
  });
  it('an optional field left empty is removed; a required one is asked for', () => {
    const f = fieldsFor('leaves', ctx);
    const r = fromForm({ id: 'l', reason: 'x' }, f, { type: 'sick', from: '2026-11-10', to: '2026-11-10', days: '1', status: 'pending', reason: '' }) as { next: Record<string, unknown> };
    expect('reason' in r.next).toBe(false);
    expect(fromForm({ id: 'l' }, f, { type: 'sick', from: '', to: '', days: '1', status: 'pending', reason: '' })).toEqual({ error: 'ໃສ່ ຈາກວັນທີ' });
  });
  it('a pay month must be YYYY-MM', () => {
    const f = fieldsFor('payItems', ctx);
    const base = { kind: 'bonus', label: 'x', amount: '1000', month: '2026-13', status: 'approved', note: '' };
    expect(fromForm({ id: 'p' }, f, base)).toEqual({ error: 'ເດືອນຕ້ອງເປັນ YYYY-MM' });
    expect(fromForm({ id: 'p' }, f, { ...base, month: '2026-11' })).toMatchObject({ next: { month: '2026-11', amount: 1000 } });
  });
});

describe('records: removing a person', () => {
  const none = { scans: [], leaves: [], advances: [], payItems: [], requests: [], ots: [] };
  it('someone with nothing recorded can go', () => expect(employeeDeleteBlock({ id: 'e1' }, { meId: 'me', has: none })).toBeNull());
  it('not yourself', () => expect(employeeDeleteBlock({ id: 'me' }, { meId: 'me', has: none })).toContain('ຕົນເອງ'));
  it('a person with history is refused, naming what exists', () => {
    const msg = employeeDeleteBlock({ id: 'e1' }, { meId: 'me', has: { ...none, scans: [{ employeeId: 'e1' }], leaves: [{ employeeId: 'e1' }, { employeeId: 'x' }] } })!;
    expect(msg).toContain('ການລົງເວລາ');
    expect(msg).toContain('ການລາ');
    expect(msg).not.toContain('ເບີກເງິນ');
    expect(msg).toContain('ປິດບັນຊີ');
  });
  it('other people\'s records do not count', () => {
    expect(employeeDeleteBlock({ id: 'e1' }, { meId: 'me', has: { ...none, scans: [{ employeeId: 'zzz' }] } })).toBeNull();
  });
});
