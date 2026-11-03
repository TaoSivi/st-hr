import { useState } from 'react';
import { useHR } from '../app/state';
import { submitRequest } from '../app/workflow';
import { REQUEST_LABEL, validateRequest, type HRRequest, type RequestKind, type RequestPayloads } from '../domain/requests';
import type { ScanKind } from '../domain/types';
import { KIND_LABEL } from './labels';
import { LEAVE_TYPES, money, ymd } from './format';
import { getDeviceId, deviceLabel } from '../device/deviceId';
import { deviceChangeBlock } from '../domain/device';
import { faceResetBlock, POSES } from '../domain/face';
import { shiftRange } from '../domain/leavePart';

export const EXPENSE_CATEGORIES = ['ເດີນທາງ', 'ອາຫານ / ຮັບແຂກ', 'ຊື້ເຄື່ອງໃຫ້ຮ້ານ', 'ໂທລະສັບ / ອິນເຕີເນັດ', 'ອື່ນໆ'];

/** One sheet for every request kind; the fields change, the submit path and rules do not. */
export function RequestSheet({ kind, onClose, initial }: { kind: RequestKind; onClose: () => void; initial?: { date?: string; date2?: string; scanKind?: ScanKind; time?: string; leaveId?: string } }) {
  const hr = useHR();
  const me = hr.me!;
  const today = ymd(new Date());
  const [date, setDate] = useState(initial?.date ?? today);
  const [date2, setDate2] = useState(initial?.date2 ?? today);
  const [time, setTime] = useState(initial?.time ?? '08:00');
  const [scanKind, setScanKind] = useState<ScanKind>(initial?.scanKind ?? 'in');
  const [minutes, setMinutes] = useState('60');
  const [withId, setWithId] = useState('');
  const [shiftId, setShiftId] = useState(hr.shifts[0].id);
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState('');
  const [receipt, setReceipt] = useState<string | undefined>();
  const [certType, setCertType] = useState<'salary' | 'employment'>('employment');
  const [leaveId, setLeaveId] = useState(initial?.leaveId ?? '');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const datesBetween = (a: string, b: string) => {
    const out: string[] = [];
    for (let d = new Date(a + 'T12:00:00'); ymd(d) <= b && out.length < 31; d.setDate(d.getDate() + 1)) out.push(ymd(d));
    return out;
  };
  const payload = (): any => {
    switch (kind) {
      case 'clockFix': return { date, kind: scanKind, time };
      case 'ot': return { date, minutes: Number(minutes) || 0 };
      case 'shiftSwap': return { date, withEmployeeId: withId };
      case 'dayOffSwap': return { fromDate: date, toDate: date2 };
      case 'schedule': return { dates: date2 >= date ? datesBetween(date, date2) : [], shiftId };
      case 'expense': return { date, category, amount: Number(amount.replace(/\D/g, '')) || 0, receipt };
      case 'certificate': return { type: certType, purpose: reason };
      case 'leaveCancel': return { leaveId };
      case 'deviceChange': return { newDeviceId: getDeviceId(), label: deviceLabel() };
      case 'faceReset': return {};
    }
  };
  const submit = async () => {
    setErr('');
    const p = payload();
    const v = validateRequest(kind, p, today) ?? (kind === 'deviceChange' ? deviceChangeBlock(me.deviceId, p.newDeviceId) : kind === 'faceReset' ? faceResetBlock(me) : null);
    if (v) return setErr(v);
    if (kind !== 'certificate' && !reason.trim()) return setErr('ກະລຸນາໃສ່ເຫດຜົນ');
    if (hr.requests.some(r => r.employeeId === me.id && r.kind === kind && r.status === 'pending' && JSON.stringify(r.payload) === JSON.stringify(p))) return setErr('ສົ່ງຄຳຂໍນີ້ໄປແລ້ວ ລໍອະນຸມັດຢູ່');
    setBusy(true);
    await submitRequest(hr, kind, p, reason);
    onClose();
  };
  const onFile = (f?: File) => {
    if (!f) return;
    if (f.size > 3_000_000) return setErr('ຮູບໃຫຍ່ເກີນ 3 MB');
    const r = new FileReader();
    r.onload = () => setReceipt(String(r.result));
    r.readAsDataURL(f);
  };
  const colleagues = hr.employees.filter(e => e.id !== me.id && e.baseSalary > 0 && !e.endDate);
  const myLeaves = hr.leaves.filter(l => l.employeeId === me.id && (l.status === 'approved' || l.status === 'pending') && l.to >= today);

  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet col" onClick={e => e.stopPropagation()} role="dialog" aria-label={REQUEST_LABEL[kind]}>
        <h2>{REQUEST_LABEL[kind]}</h2>
        {kind === 'clockFix' && <>
          <span className="muted small">ໃຊ້ເມື່ອລືມສະແກນ ຫຼື ສະແກນບໍ່ໄດ້. ຫົວໜ້າຕ້ອງອະນຸມັດກ່ອນຈຶ່ງນັບ.</span>
          <div className="row wrap">{(['in', 'breakStart', 'breakEnd', 'out'] as ScanKind[]).map(k => <button key={k} className={`btn ${scanKind === k ? '' : 'ghost'}`} aria-pressed={scanKind === k} onClick={() => setScanKind(k)}>{KIND_LABEL[k]}</button>)}</div>
          <div className="row"><label className="field grow">ວັນທີ<input className="input" type="date" max={today} value={date} onChange={e => setDate(e.target.value)} /></label>
            <label className="field grow">ເວລາ<input className="input" type="time" value={time} onChange={e => setTime(e.target.value)} /></label></div>
        </>}
        {kind === 'deviceChange' && <span className="muted small">ຂໍຜູກບັນຊີນີ້ກັບ <b>ເຄື່ອງທີ່ກຳລັງໃຊ້ຢູ່ນີ້</b> ({deviceLabel()}). ເຈົ້າຂອງຕ້ອງອະນຸມັດ ແລະ ຫຼັງຈາກນັ້ນຕ້ອງລົງທະບຽນໃບໜ້າໃໝ່ໃນເຄື່ອງນີ້. ກະລຸນາສົ່ງຄຳຂໍຈາກເຄື່ອງໃໝ່.</span>}
        {kind === 'faceReset' && <span className="muted small">ໃຊ້ເມື່ອໜ້າປ່ຽນໄປ (ຈ່ອຍລົງ, ຕຸ້ຍຂຶ້ນ, ໃສ່ແວ່ນ, ໄວ້ຫນວດ) ແລະ ສະແກນບໍ່ຕິດ. ຫົວໜ້າ ຫຼື ເຈົ້າຂອງອະນຸມັດ ແລ້ວການກົດເຂົ້າວຽກເທື່ອຕໍ່ໄປຈະໃຫ້ຖ່າຍໃບໜ້າໃໝ່ {POSES.length} ທ່າ. ຈົນກວ່າຈະຖ່າຍໃໝ່ ໃບໜ້າເກົ່າຍັງໃຊ້ໄດ້.</span>}
        {kind === 'ot' && <div className="row">
          <label className="field grow">ວັນທີ<input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <label className="field" style={{ width: 120 }}>ນາທີ<input className="input" inputMode="numeric" value={minutes} onChange={e => setMinutes(e.target.value.replace(/\D/g, ''))} /></label></div>}
        {kind === 'shiftSwap' && <>
          <label className="field">ວັນທີ<input className="input" type="date" min={today} value={date} onChange={e => setDate(e.target.value)} /></label>
          <label className="field">ສະລັບກັບ<select className="input" value={withId} onChange={e => setWithId(e.target.value)}><option value="">— ເລືອກ —</option>{colleagues.map(c => <option key={c.id} value={c.id}>{c.name} · {c.dept}</option>)}</select></label>
          <span className="muted small">ກະຂອງທັງສອງຄົນໃນມື້ນັ້ນຈະແລກກັນ ເມື່ອຫົວໜ້າອະນຸມັດ</span>
        </>}
        {kind === 'dayOffSwap' && <div className="row">
          <label className="field grow">ມາວຽກວັນທີ (ວັນພັກເດີມ)<input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <label className="field grow">ພັກແທນວັນທີ<input className="input" type="date" value={date2} onChange={e => setDate2(e.target.value)} /></label></div>}
        {kind === 'schedule' && <>
          <div className="row"><label className="field grow">ແຕ່ວັນທີ<input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
            <label className="field grow">ຫາວັນທີ<input className="input" type="date" value={date2} onChange={e => setDate2(e.target.value)} /></label></div>
          <div className="row wrap">{[...hr.shifts.map(s => [s.id, `${s.name} ${shiftRange(s)}`]), ['off', 'ພັກ']].map(([id, label]) =>
            <button key={id} className={`btn ${shiftId === id ? '' : 'ghost'}`} aria-pressed={shiftId === id} onClick={() => setShiftId(id)}>{label}</button>)}</div>
        </>}
        {kind === 'expense' && <>
          <div className="row"><label className="field grow">ວັນທີ<input className="input" type="date" max={today} value={date} onChange={e => setDate(e.target.value)} /></label>
            <label className="field grow">ຈຳນວນເງິນ (ກີບ)<input className="input" inputMode="numeric" value={amount} onChange={e => { const d = e.target.value.replace(/\D/g, ''); setAmount(d ? money(+d) : ''); }} /></label></div>
          <label className="field">ປະເພດ<select className="input" value={category} onChange={e => setCategory(e.target.value)}>{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
          <label className="field">ຮູບໃບບິນ<input className="input" type="file" accept="image/*" capture="environment" onChange={e => onFile(e.target.files?.[0])} /></label>
          {receipt && <img src={receipt} alt="ໃບບິນ" style={{ maxHeight: 140, borderRadius: 12, alignSelf: 'flex-start' }} />}
          <span className="muted small">ອະນຸມັດແລ້ວ ຈະຈ່າຍຄືນພ້ອມເງິນເດືອນ (ບໍ່ຄິດອາກອນ)</span>
        </>}
        {kind === 'certificate' && <div className="row wrap">
          <button className={`btn ${certType === 'employment' ? '' : 'ghost'}`} aria-pressed={certType === 'employment'} onClick={() => setCertType('employment')}>ຮັບຮອງການເຮັດວຽກ</button>
          <button className={`btn ${certType === 'salary' ? '' : 'ghost'}`} aria-pressed={certType === 'salary'} onClick={() => setCertType('salary')}>ຮັບຮອງເງິນເດືອນ</button></div>}
        {kind === 'leaveCancel' && <label className="field">ການລາທີ່ຈະຍົກເລີກ<select className="input" value={leaveId} onChange={e => setLeaveId(e.target.value)}>
          <option value="">— ເລືອກ —</option>{myLeaves.map(l => <option key={l.id} value={l.id}>{LEAVE_TYPES[l.type]} · {l.from} → {l.to}</option>)}</select></label>}
        <label className="field">{kind === 'certificate' ? 'ຈຸດປະສົງ (ເຊັ່ນ: ຍື່ນກູ້ທະນາຄານ, ຂໍວີຊາ)' : 'ເຫດຜົນ'}<input className="input" value={reason} onChange={e => setReason(e.target.value)} /></label>
        {err && <div className="error" role="alert">{err}</div>}
        <div className="row"><button className="btn ghost grow" onClick={onClose}>ຍົກເລີກ</button><button className="btn grow" disabled={busy} onClick={submit}>ສົ່ງຄຳຂໍ</button></div>
      </div>
    </div>
  );
}

export function statusPill(s: string) {
  const label: Record<string, string> = { pending: 'ລໍອະນຸມັດ', approved: 'ອະນຸມັດແລ້ວ', rejected: 'ບໍ່ອະນຸມັດ', cancelled: 'ຍົກເລີກແລ້ວ' };
  return <span className={`status-pill ${s}`}>{label[s] ?? s}</span>;
}

export function describeRequest(r: HRRequest, nameOf: (id: string) => string, shiftName: (id: string) => string = id => id): string {
  const p: any = r.payload;
  switch (r.kind) {
    case 'clockFix': return `${KIND_LABEL[p.kind as ScanKind]} ${p.time} · ${p.date}`;
    case 'ot': return `${p.minutes} ນາທີ · ${p.date}`;
    case 'shiftSwap': return `ກັບ ${nameOf(p.withEmployeeId)} · ${p.date}`;
    case 'dayOffSwap': return `ມາວຽກ ${p.fromDate} · ພັກ ${p.toDate}`;
    case 'schedule': return `${p.shiftId === 'off' ? 'ພັກ' : shiftName(p.shiftId)} · ${p.dates[0]}${p.dates.length > 1 ? ` → ${p.dates[p.dates.length - 1]} (${p.dates.length} ມື້)` : ''}`;
    case 'expense': return `${p.category} · ${money(p.amount)} ₭ · ${p.date}`;
    case 'certificate': return `${p.type === 'salary' ? 'ຮັບຮອງເງິນເດືອນ' : 'ຮັບຮອງການເຮັດວຽກ'} · ${p.purpose}`;
    case 'leaveCancel': return `ການລາ ${p.leaveId}`;
    case 'deviceChange': return `ຜູກກັບເຄື່ອງໃໝ່: ${p.label || p.newDeviceId}`;
    case 'faceReset': return 'ຖ່າຍໃບໜ້າໃໝ່ທັງໝົດ (ສະແກນບໍ່ຕິດ / ໜ້າປ່ຽນ)';
  }
}

/** My requests of the given kinds, with a button to file a new one. */
export function MyRequests({ kinds, onPrint }: { kinds: RequestKind[]; onPrint?: (r: HRRequest<'certificate'>) => void }) {
  const hr = useHR();
  const [sheet, setSheet] = useState<RequestKind | null>(null);
  const mine = hr.requests.filter(r => r.employeeId === hr.me!.id && kinds.includes(r.kind)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const nameOf = (id: string) => hr.employees.find(e => e.id === id)?.name ?? id;
  return (
    <div className="screen">
      <div className="row wrap">{kinds.map(k => <button key={k} className="btn" onClick={() => setSheet(k)}>+ {REQUEST_LABEL[k]}</button>)}</div>
      {mine.length === 0 && <div className="empty">ຍັງບໍ່ມີຄຳຂໍ</div>}
      {mine.map(r => (
        <div key={r.id} className="card col" style={{ gap: 4 }}>
          <div className="row"><b className="grow">{REQUEST_LABEL[r.kind]}</b>{statusPill(r.status)}</div>
          <span>{describeRequest(r, nameOf, id => hr.shifts.find(s => s.id === id)?.name ?? id)}</span>
          {r.reason && r.kind !== 'certificate' && <span className="muted small">“{r.reason}”</span>}
          {r.kind === 'expense' && (r.payload as RequestPayloads['expense']).receipt && <img src={(r.payload as RequestPayloads['expense']).receipt} alt="ໃບບິນ" style={{ maxHeight: 90, borderRadius: 10, alignSelf: 'flex-start' }} />}
          {r.approvals.filter(a => a.note).map(a => <span key={a.at} className="small" style={{ color: 'var(--bad)' }}>{nameOf(a.by)}: {a.note}</span>)}
          {r.kind === 'certificate' && r.status === 'approved' && onPrint && <button className="btn ghost" onClick={() => onPrint(r as HRRequest<'certificate'>)}>ເປີດ / ພິມໜັງສືຮັບຮອງ</button>}
        </div>
      ))}
      {sheet && <RequestSheet kind={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}
