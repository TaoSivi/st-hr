import { useMemo, useState } from 'react';
import { useHR } from '../app/state';
import { RECORD_KINDS, employeeDeleteBlock, fieldsFor, fromForm, toForm, type RecordKind } from '../domain/records';
import { PAY_ITEM_LABEL } from '../domain/payItems';
import { REQUEST_LABEL } from '../domain/requests';
import { KIND_LABEL } from './labels';
import { LEAVE_TYPES, hhmm, laoDate, money } from './format';

type Rec = Record<string, any>;
const STATUS: Record<string, string> = { pending: 'ລໍອະນຸມັດ', approved: 'ອະນຸມັດແລ້ວ', rejected: 'ປະຕິເສດ', cancelled: 'ຍົກເລີກແລ້ວ', ok: 'ປົກກະຕິ', draft: 'ຮ່າງ', prepared: 'ເປີດຢູ່', locked: 'ປິດງວດແລ້ວ' };
const tone = (s: string) => (s === 'approved' || s === 'ok' ? 'ok' : s === 'rejected' ? 'bad' : s === 'locked' ? 'dark' : s === 'pending' ? 'warn' : 'info');
const PAGE = 30;

/**
 * Edit or delete any record. For the Admin and the Super admin (the page is theirs alone).
 * An Admin's delete, pay change, payroll close/reopen or clock-in edit asks the Super admin for the PIN by itself (see SuperApproval).
 * Every deletion keeps the whole record in the audit log.
 */
export default function RecordsPage() {
  const hr = useHR();
  const me = hr.me!;
  const [kind, setKind] = useState<RecordKind>('leaves');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [edit, setEdit] = useState<{ id: string; form: Record<string, string> } | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const nameOf = (id?: string) => hr.employees.find(e => e.id === id)?.name ?? id ?? '—';
  const fields = useMemo(() => fieldsFor(kind, { branches: hr.branches, leaveTypes: LEAVE_TYPES, scanKinds: KIND_LABEL, payItemKinds: PAY_ITEM_LABEL }), [kind, hr.branches]);
  const coll = kind;

  const all: Rec[] = useMemo(() => {
    const by = <T,>(list: T[], key: (x: T) => string) => [...list].sort((a, b) => key(b).localeCompare(key(a)));
    switch (kind) {
      case 'employees': return by(hr.employees as Rec[], e => e.code);
      case 'leaves': return by(hr.leaves as Rec[], l => l.from);
      case 'advances': return by(hr.advances as Rec[], a => a.createdAt);
      case 'scans': return by(hr.scans as Rec[], s => s.deviceTime);
      case 'ots': return by(hr.ots as Rec[], o => o.date);
      case 'payItems': return by(hr.payItems as Rec[], p => p.month);
      case 'payrollRuns': return by(hr.payrollRuns as Rec[], r => r.id);
      case 'requests': return by(hr.requests as Rec[], r => r.createdAt);
    }
  }, [kind, hr.employees, hr.leaves, hr.advances, hr.scans, hr.ots, hr.payItems, hr.payrollRuns, hr.requests]);

  const title = (r: Rec): string => {
    switch (kind) {
      case 'employees': return `${r.code} · ${r.name}`;
      case 'leaves': return `${nameOf(r.employeeId)} · ${LEAVE_TYPES[r.type] ?? r.type}`;
      case 'advances': return `${nameOf(r.employeeId)} · ${money(r.amount)} ₭`;
      case 'scans': return `${nameOf(r.employeeId)} · ${KIND_LABEL[r.kind as keyof typeof KIND_LABEL] ?? r.kind}`;
      case 'ots': return `${nameOf(r.employeeId)} · ${r.minutes} ນາທີ`;
      case 'payItems': return `${nameOf(r.employeeId)} · ${r.label || PAY_ITEM_LABEL[r.kind as keyof typeof PAY_ITEM_LABEL]} · ${money(r.amount)} ₭`;
      case 'payrollRuns': return `ງວດ ${r.id}`;
      case 'requests': return `${nameOf(r.employeeId)} · ${REQUEST_LABEL[r.kind as keyof typeof REQUEST_LABEL] ?? r.kind}`;
    }
  };
  const detail = (r: Rec): string => {
    switch (kind) {
      case 'employees': return `${r.dept} · ${r.position}`;
      case 'leaves': return `${r.from} → ${r.to} · ${r.days} ມື້${r.reason ? ` · “${r.reason}”` : ''}`;
      case 'advances': return `${String(r.createdAt).slice(0, 10)} · ຜ່ອນ ${r.installments} ເດືອນ · ຄ້າງ ${money(r.remaining)} ₭`;
      case 'scans': return `${laoDate(new Date(r.deviceTime))} ${hhmm(r.deviceTime)}${r.offline ? ' · ອອບລາຍ' : ''}`;
      case 'ots': return r.date;
      case 'payItems': return `ເດືອນ ${r.month}`;
      case 'payrollRuns': return `${Object.keys(r.slips ?? {}).length} ສະລິບ`;
      case 'requests': return `${String(r.createdAt).slice(0, 10)}${r.reason ? ` · “${r.reason}”` : ''}`;
    }
  };

  const needle = q.trim().toLowerCase();
  const list = needle ? all.filter(r => `${title(r)} ${detail(r)}`.toLowerCase().includes(needle)) : all;

  const hasSuper = hr.employees.some(e => e.superAdmin);
  const gated = hr.online && hasSuper && !me.superAdmin;

  const open = (r: Rec) => { setErr(''); setMsg(''); setEdit({ id: r.id, form: toForm(r, fields) }); };
  const save = async () => {
    if (!edit) return;
    const rec = all.find(r => r.id === edit.id);
    if (!rec) return setEdit(null);
    const out = fromForm(rec, fields, edit.form);
    if ('error' in out) return setErr(out.error);
    setErr(''); setBusy(true);
    try {
      await hr.save(coll, out.next as any, 'record-edit');
      setMsg(`ບັນທຶກການແກ້ໄຂແລ້ວ · ${title(out.next)}`);
      setEdit(null);
    } catch (e: any) { setErr(e?.message || 'ບັນທຶກບໍ່ໄດ້'); }
    setBusy(false);
  };
  const remove = async (r: Rec) => {
    setErr(''); setMsg('');
    if (kind === 'employees') {
      const block = employeeDeleteBlock(r as { id: string }, { meId: me.id, has: { scans: hr.scans, leaves: hr.leaves, advances: hr.advances, payItems: hr.payItems, requests: hr.requests, ots: hr.ots } });
      if (block) return setErr(`ລຶບ ${r.name} ບໍ່ໄດ້: ${block}`);
    }
    if (!confirm(`ລຶບຖາວອນ: ${title(r)} ?\nລຶບແລ້ວກູ້ຄືນບໍ່ໄດ້ (ມີສຳເນົາທັງໝົດເກັບໄວ້ໃນ ບັນທຶກການແກ້ໄຂ).`)) return;
    setBusy(true);
    try {
      await hr.remove(coll, r.id, 'record-delete');
      setMsg(`ລຶບແລ້ວ · ${title(r)}`);
      if (edit?.id === r.id) setEdit(null);
    } catch (e: any) { setErr(e?.message || 'ລຶບບໍ່ໄດ້'); }
    setBusy(false);
  };

  const editing = edit ? all.find(r => r.id === edit.id) : undefined;
  return (
    <>
      <div className="col" style={{ gap: 0 }}><span className="muted">ສະເພາະ Admin ແລະ Super admin · ທຸກການແກ້ ແລະ ລຶບ ມີບັນທຶກ</span><h1>ຈັດການຂໍ້ມູນ</h1></div>
      {gated && <div className="small" style={{ background: 'var(--warn-bg)', color: 'var(--warn)', borderRadius: 14, padding: '10px 14px' }}>ລຶບຖາວອນ, ແກ້ເງິນເດືອນ / ເລກບັນຊີ, ປິດ-ເປີດງວດເງິນເດືອນ ແລະ ແກ້ການລົງເວລາຍ້ອນຫຼັງ ຕ້ອງໃຫ້ <b>Super admin</b> ໃສ່ PIN ອະນຸມັດ — ລະບົບຈະຖາມເອງເມື່ອກົດ. ອັນອື່ນເຮັດໄດ້ເລີຍ.</div>}
      <div className="tabs" role="tablist" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        {RECORD_KINDS.map(k => <button key={k.id} role="tab" aria-selected={kind === k.id} onClick={() => { setKind(k.id); setEdit(null); setQ(''); setShown(PAGE); setErr(''); setMsg(''); }}>{k.label}</button>)}
      </div>
      {msg && <div className="pill ok" role="status" style={{ alignSelf: 'flex-start', height: 'auto', padding: '6px 12px', whiteSpace: 'normal' }}>{msg}</div>}
      {err && <div className="error" role="alert">{err}</div>}
      <div className="card col">
        <div className="row wrap">
          <h2 className="grow">{RECORD_KINDS.find(k => k.id === kind)!.label} <span className="muted small">({list.length})</span></h2>
          <input className="input" style={{ maxWidth: 260 }} placeholder="ຄົ້ນຫາຊື່ / ວັນທີ" aria-label="ຄົ້ນຫາ" value={q} onChange={e => { setQ(e.target.value); setShown(PAGE); }} />
        </div>
        {kind === 'employees' && <span className="muted small">ແກ້ຂໍ້ມູນພະນັກງານໃນໜ້າ ພະນັກງານ. ຢູ່ນີ້ລຶບໄດ້ສະເພາະຄົນທີ່ຍັງບໍ່ມີປະຫວັດ (ລົງເວລາ, ລາ, ເບີກ ຯລຯ) — ຄົນທີ່ມີປະຫວັດໃຫ້ໃຊ້ "ປິດບັນຊີ".</span>}
        {list.length === 0 && <div className="empty">ບໍ່ມີລາຍການ</div>}
        {list.slice(0, shown).map(r => (
          <div key={r.id} className="row wrap rec-row">
            <div className="col grow" style={{ gap: 2, minWidth: 200 }}>
              <div className="row wrap" style={{ gap: 8 }}><b>{title(r)}</b>{r.status && <span className={`pill ${tone(r.status)}`}>{STATUS[r.status] ?? r.status}</span>}</div>
              <span className="muted small">{detail(r)}</span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              {fields.length > 0 && <button className="btn ghost" disabled={busy} onClick={() => open(r)}>✎ ແກ້ໄຂ</button>}
              <button className="btn danger" disabled={busy} aria-label={`ລຶບ ${title(r)}`} onClick={() => remove(r)}>🗑 ລຶບ</button>
            </div>
          </div>))}
        {list.length > shown && <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShown(n => n + PAGE)}>ສະແດງເພີ່ມ ({list.length - shown})</button>}
      </div>
      {edit && editing && (
        <div className="card col" style={{ maxWidth: 560 }} role="group" aria-label="ແກ້ໄຂ">
          <h2>ແກ້ໄຂ · {title(editing)}</h2>
          <div className="grid">
            {fields.map(f => (
              <label key={f.key} className="field">{f.label}{f.optional ? <span className="muted small" style={{ fontWeight: 400 }}> (ບໍ່ບັງຄັບ)</span> : null}
                {f.kind === 'select'
                  ? <select className="input" value={edit.form[f.key] ?? ''} onChange={e => setEdit({ ...edit, form: { ...edit.form, [f.key]: e.target.value } })}>{f.optional && <option value="">—</option>}{(f.options ?? []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  : <input className="input" type={f.kind === 'date' ? 'date' : f.kind === 'datetime' ? 'datetime-local' : 'text'} inputMode={f.kind === 'number' ? 'numeric' : undefined} value={edit.form[f.key] ?? ''} onChange={e => setEdit({ ...edit, form: { ...edit.form, [f.key]: e.target.value } })} />}
              </label>))}
          </div>
          <div className="row"><button className="btn ghost grow" disabled={busy} onClick={() => setEdit(null)}>ຍົກເລີກ</button><button className="btn grow" disabled={busy} onClick={save}>ບັນທຶກ</button></div>
        </div>)}
    </>
  );
}
