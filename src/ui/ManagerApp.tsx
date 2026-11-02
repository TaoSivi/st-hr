import { useEffect, useMemo, useState } from 'react';
import { useHR, type PayrollRun } from '../app/state';
import type { Advance, Employee, LeaveRequest, Role, ScanRecord, Settings, Shift, TaxBracket } from '../domain/types';
import { ASSIGNABLE_APPROVER_ROLES, validateSettings, validateShifts } from '../domain/settingsCheck';
import { ACTION_ROLES, approvalAccess, canDo, canGrantRoles, canViewPage, isReadOnly, roleChangeBlock, scopeBlock, type ManagerPage } from '../domain/permissions';
import { deptOf, inMyScope } from '../app/scope';
import { dailySample, lateMinutes } from '../domain/attendance';
import { approvalBlock, decide, isEscalated } from '../domain/leave';
import { bankCsv, changeNeedsSecondPerson, payrollLockBlock } from '../domain/payroll';
import { employedFraction, isActiveOn, nextEmployeeCode, terminationBlock, validateNewEmployee } from '../domain/hiring';
import { monthKey, summarize } from '../app/payrun';
import { getPosition } from '../device/geo';
import { uid } from '../data/store';
import { KIND_LABEL } from './labels';
import Approvals, { actionableCount, NoAccess, SECTION_LABEL, visibleSections, type ApprovalSection } from './Approvals';
import { Reports, TeamMap } from './Pages';
import { downloadText,hhmm, LEAVE_TYPES, laoDate, laoMonth, money, ROLE_NAMES, sameDay, ymd } from './format';

type Page = ManagerPage;
const PAGE_LABEL: Record<Page, string> = {
  overview: 'ພາບລວມ', review: 'ກວດການລົງເວລາ', approvals: 'ອະນຸມັດຄຳຂໍ', time: 'ລົງເວລາມື້ນີ້', reports: 'ລາຍງານທີມ', map: 'ແຜນທີ່',
  leave: 'ລາພັກ & ເບີກ', staff: 'ພະນັກງານ', pay: 'ເງິນເດືອນ', settings: 'ຕັ້ງຄ່າ', audit: 'Audit log'
};
const PAGE_ORDER = Object.keys(PAGE_LABEL) as Page[];

const nameOf = (emps: Employee[], id?: string) => emps.find(e => e.id === id)?.name ?? id ?? '—';

export default function ManagerApp({ onSwitch, onEmployeeView }: { onSwitch: () => void; onEmployeeView: () => void }) {
  const hr = useHR();
  const me = hr.me!;
  const pages = PAGE_ORDER.filter(p => canViewPage(me.roles, p, hr.settings));
  const [page, setPage] = useState<Page>(pages[0]);
  const readOnly = isReadOnly(me.roles);
  // badges count only what this person could decide: a head's own departments
  const inScope = (id: string, roles: Role[]) => inMyScope(me, hr.employees, id, roles);
  const pendingScans = hr.scans.filter(s => s.status === 'pending' && inScope(s.employeeId, ACTION_ROLES['scan.review'])).length + hr.ots.filter(o => o.status === 'pending' && inScope(o.employeeId, ACTION_ROLES['scan.review'])).length;
  const pendingLeave = hr.leaves.filter(l => l.status === 'pending' && inScope(l.employeeId, hr.settings.leaveApproverRoles)).length + hr.advances.filter(a => a.status === 'pending' && inScope(a.employeeId, ACTION_ROLES['advance.decide'])).length;
  const reqCount = (['shift', 'schedule', 'ot', 'expense', 'certificate', 'leaveCancel', 'scan'] as ApprovalSection[]).reduce((a, s) => a + (s === 'scan' ? hr.requests.filter(r => r.kind === 'clockFix' && r.status === 'pending').length : actionableCount(hr, s)), 0);
  const badge: Partial<Record<Page, number>> = { review: pendingScans, leave: pendingLeave, approvals: reqCount };

  return (
    <div className="mgr">
      <nav aria-label="ເມນູ HR">
        <div className="brand"><span className="logo">ST</span><div className="col" style={{ gap: 0 }}><b style={{ color: '#fff', fontSize: 17 }}>ST HR</b><span className="small" style={{ color: '#7fbdb9' }}>{me.name} · {me.roles.filter(r => r !== 'employee').map(r => ROLE_NAMES[r]).join(', ')}</span></div></div>
        {pages.map(p => (
          <button key={p} aria-current={page === p ? 'page' : undefined} onClick={() => setPage(p)}>
            <span>{PAGE_LABEL[p]}</span>{!!badge[p] && <span className="badge">{badge[p]}</span>}
          </button>
        ))}
        <div style={{ height: 12 }} />
        <button onClick={onEmployeeView}>‹ ກັບໜ້າລົງເວລາ</button>
        <button onClick={onSwitch}>ປ່ຽນຜູ້ໃຊ້</button>
      </nav>
      <main>
        {readOnly && <div className="pill info" style={{ alignSelf: 'flex-start' }}>ໂໝດອ່ານຢ່າງດຽວ (ຜູ້ກວດສອບ)</div>}
        {!canViewPage(me.roles, page, hr.settings) && <NoAccess />}
        {canViewPage(me.roles, page, hr.settings) && <>
          {page === 'overview' && <Overview />}
          {page === 'review' && <Review readOnly={!canDo(me.roles, 'scan.review')} />}
          {page === 'approvals' && <ApprovalsHub />}
          {page === 'time' && <TimeToday />}
          {page === 'reports' && <><h1>ລາຍງານທີມ</h1><Reports team /></>}
          {page === 'map' && <><h1>ແຜນທີ່ການສະແກນມື້ນີ້</h1><TeamMap /></>}
          {page === 'leave' && <Leaves />}
          {page === 'staff' && <Staff />}
          {page === 'pay' && <Payroll />}
          {page === 'settings' && <SettingsPage readOnly={!canDo(me.roles, 'settings.edit')} />}
          {page === 'audit' && <Audit />}
        </>}
      </main>
    </div>
  );
}

function Overview() {
  const hr = useHR();
  const now = new Date();
  const today = hr.scans.filter(s => sameDay(s.deviceTime, now));
  const present = new Set(today.filter(s => s.kind === 'in').map(s => s.employeeId));
  const staff = hr.employees.filter(e => isActiveOn(e, ymd(now)) && e.baseSalary > 0);
  const onLeave = hr.leaves.filter(l => l.status === 'approved' && l.from <= ymd(now) && l.to >= ymd(now)).length;
  let late = 0;
  for (const s of today.filter(s => s.kind === 'in')) {
    const e = hr.employees.find(x => x.id === s.employeeId);
    if (e && lateMinutes(e.shiftId === 'evening' ? '14:00' : '06:00', new Date(s.deviceTime), hr.settings.graceMinutes) > 0) late++;
  }
  const k = (label: string, v: number | string, tone = '') => <div className={`card ${tone}`}><span className={tone ? 'small' : 'muted small'} style={tone ? { color: '#9fd8d4' } : undefined}>{label}</span><div className="big-num">{v}</div></div>;
  return (
    <>
      <div className="col" style={{ gap: 0 }}><span className="muted">{laoDate(now)}</span><h1>ພາບລວມພະນັກງານ</h1></div>
      <div className="grid">
        {k('ມາວຽກມື້ນີ້', `${present.size} / ${staff.length}`, 'dark')}
        {k('ມາຊ້າ', late)}
        {k('ລາພັກມື້ນີ້', onLeave)}
        {k('ລໍກວດ', hr.scans.filter(s => s.status === 'pending').length)}
      </div>
      <div className="card col">
        <h2>ການລົງເວລາລ່າສຸດ</h2>
        {today.length === 0 ? <div className="empty">ມື້ນີ້ຍັງບໍ່ມີໃຜສະແກນ</div> :
          <div className="scroll-x"><table className="t"><thead><tr><th>ເວລາ</th><th>ພະນັກງານ</th><th>ປະເພດ</th><th>ສະຖານະ</th></tr></thead><tbody>
            {[...today].reverse().slice(0, 12).map(s => <tr key={s.id}><td>{hhmm(s.deviceTime)}</td><td>{nameOf(hr.employees, s.employeeId)}</td><td>{KIND_LABEL[s.kind]}</td><td><StatusPill s={s} /></td></tr>)}
          </tbody></table></div>}
      </div>
    </>
  );
}

function ApprovalsHub() {
  const hr = useHR();
  // leave requests have their own page; everything else the user may see or decide is a tab here
  const sections: ApprovalSection[] = visibleSections(hr).filter(s => s !== 'leave');
  const [sec, setSec] = useState<ApprovalSection>(sections[0]);
  if (!sections.length) return <NoAccess />;
  return (
    <>
      <div className="col" style={{ gap: 0 }}><span className="muted">ຫ້າມອະນຸມັດຂອງຕົນເອງ · ຕ້ອງອະນຸມັດ {hr.settings.leaveApproversRequired} ຄົນ</span><h1>ອະນຸມັດຄຳຂໍ</h1></div>
      <div className="tabs" role="tablist">{sections.map(s => {
        const n = actionableCount(hr, s);
        return <button key={s} role="tab" aria-selected={sec === s} onClick={() => setSec(s)}>{SECTION_LABEL[s].replace('ອະນຸມັດ', '')}{n ? ` (${n})` : ''}</button>;
      })}</div>
      <Approvals key={sec} section={sec} />
    </>
  );
}

function StatusPill({ s }: { s: ScanRecord }) {
  const m: Record<string, [string, string]> = { ok: ['ok', 'ຜ່ານ'], pending: ['warn', 'ລໍກວດ'], approved: ['ok', 'ຢືນຢັນແລ້ວ'], rejected: ['bad', 'ປະຕິເສດ'] };
  return <span className={`pill ${m[s.status][0]}`}>{m[s.status][1]}</span>;
}

function Review({ readOnly }: { readOnly: boolean }) {
  const hr = useHR();
  const me = hr.me!;
  const [tab, setTab] = useState<'pending' | 'sample' | 'ot'>('pending');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const todayKey = ymd(new Date());
  const sample = useMemo(() => dailySample(hr.scans.filter(s => s.status === 'ok' && sameDay(s.deviceTime, new Date())), hr.settings.randomSamplePerDay, todayKey), [hr.scans, hr.settings.randomSamplePerDay, todayKey]);
  const mine = (id: string) => inMyScope(me, hr.employees, id, ACTION_ROLES['scan.review']);
  const list = tab === 'pending' ? hr.scans.filter(s => s.status === 'pending' && mine(s.employeeId)) : tab === 'sample' ? sample.filter(s => mine(s.employeeId)) : [];
  const [selId, setSelId] = useState<string | null>(null);
  const sel = list.find(s => s.id === selId) ?? list[0];

  const decideScan = async (s: ScanRecord, ok: boolean) => {
    setErr('');
    const sb = scopeBlock(me, deptOf(hr.employees, s.employeeId), ACTION_ROLES['scan.review']);
    if (sb) return setErr(sb);
    if (s.employeeId === me.id) return setErr('ກວດການລົງເວລາຂອງຕົນເອງບໍ່ໄດ້');
    if (!ok && !note.trim()) return setErr('ຕ້ອງໃສ່ໝາຍເຫດເມື່ອປະຕິເສດ');
    await hr.save('scans', { ...s, status: ok ? 'approved' : 'rejected', reviewedBy: me.id, reviewNote: note.trim() || undefined }, ok ? 'scan-approve' : 'scan-reject');
    setNote('');
  };

  return (
    <>
      <div className="row wrap"><div className="col grow" style={{ gap: 0 }}><span className="muted">ລາຍການທີ່ລະບົບບໍ່ແນ່ໃຈ · ຫົວໜ້າເປັນຄົນຢືນຢັນ</span><h1>ກວດການລົງເວລາ</h1></div>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'pending'} onClick={() => setTab('pending')}>ລໍກວດ ({hr.scans.filter(s => s.status === 'pending' && mine(s.employeeId)).length})</button>
          <button role="tab" aria-selected={tab === 'sample'} onClick={() => setTab('sample')}>ສຸ່ມກວດມື້ນີ້ ({sample.length})</button>
          <button role="tab" aria-selected={tab === 'ot'} onClick={() => setTab('ot')}>OT ({hr.ots.filter(o => o.status === 'pending').length})</button>
        </div></div>
      {err && <div className="error" role="alert">{err}</div>}
      {tab === 'ot' ? <OtList readOnly={readOnly} /> : (
        <div className="row wrap" style={{ alignItems: 'flex-start' }}>
          <div className="col" style={{ flex: '1 1 320px' }}>
            {list.length === 0 && <div className="card empty">ບໍ່ມີລາຍການ</div>}
            {list.map(s => (
              <button key={s.id} className="card row" onClick={() => setSelId(s.id)} style={{ border: `2px solid ${sel?.id === s.id ? 'var(--accent)' : 'transparent'}`, textAlign: 'left' }}>
                {s.photo ? <img src={s.photo} alt="" width={52} height={52} style={{ borderRadius: 14, objectFit: 'cover' }} /> : <span className="logo" style={{ width: 52, height: 52 }}>?</span>}
                <div className="col grow" style={{ gap: 0 }}><b>{nameOf(hr.employees, s.employeeId)}</b><span className="muted small">{KIND_LABEL[s.kind]} · {hhmm(s.deviceTime)}{s.offline ? ' · ອອບລາຍ' : ''}</span></div>
                <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>{s.reasons.length ? s.reasons.map(r => <span key={r} className="pill warn">{r}</span>) : <span className="pill info">ສຸ່ມກວດ</span>}</div>
              </button>
            ))}
          </div>
          {sel && (
            <div className="card col" style={{ flex: '1 1 340px' }}>
              <div className="row"><div className="col grow" style={{ gap: 0 }}><b style={{ fontSize: 18 }}>{nameOf(hr.employees, sel.employeeId)}</b><span className="muted small">{laoDate(new Date(sel.deviceTime))} {hhmm(sel.deviceTime)}</span></div><StatusPill s={sel} /></div>
              {sel.photo ? <img src={sel.photo} alt="ຮູບຕອນສະແກນ" style={{ width: '100%', maxWidth: 280, borderRadius: 16, alignSelf: 'center' }} /> : <div className="empty">ບໍ່ມີຮູບ (ກ້ອງບໍ່ໄດ້ເປີດ)</div>}
              <div className="row"><span className="grow muted">ໃບໜ້າກົງກັນ</span><b>{sel.faceScore != null ? sel.faceScore + '%' : '—'}</b></div>
              <div className="row"><span className="grow muted">ໄລຍະຫ່າງຈາກຮ້ານ</span><b>{sel.distanceM != null ? sel.distanceM + ' ມ.' : 'ບໍ່ມີ GPS'}</b></div>
              <div className="row"><span className="grow muted">ໂມງໂທລະສັບ / server</span><b>{hhmm(sel.deviceTime)} / {sel.serverTime ? hhmm(sel.serverTime) : 'ຍັງບໍ່ sync'}</b></div>
              {sel.reviewedBy && <div className="muted small">ກວດໂດຍ {nameOf(hr.employees, sel.reviewedBy)}{sel.reviewNote ? ` · ${sel.reviewNote}` : ''}</div>}
              {!readOnly && (sel.status === 'pending' || sel.status === 'ok') && (
                <>
                  <label className="field">ໝາຍເຫດ (ຕ້ອງໃສ່ຖ້າປະຕິເສດ)<input className="input" value={note} onChange={e => setNote(e.target.value)} /></label>
                  <div className="row"><button className="btn danger grow" onClick={() => decideScan(sel, false)}>ປະຕິເສດ</button>
                    {sel.status === 'pending' && <button className="btn grow" onClick={() => decideScan(sel, true)}>ຢືນຢັນວ່າຖືກຕ້ອງ</button>}</div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function OtList({ readOnly }: { readOnly: boolean }) {
  const hr = useHR();
  const me = hr.me!;
  const mine = hr.employees.filter(e => isActiveOn(e, ymd(new Date())) && inMyScope(me, hr.employees, e.id, ACTION_ROLES['ot.preapprove']));
  const [emp, setEmp] = useState(mine[0]?.id ?? '');
  const [mins, setMins] = useState('60');
  const pending = hr.ots.filter(o => o.status === 'pending' && mine.some(e => e.id === o.employeeId));
  return (
    <div className="card col">
      {!readOnly && (
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <label className="field grow">ສັ່ງ OT ໃຫ້<select className="input" value={emp} onChange={e => setEmp(e.target.value)}>{mine.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <label className="field" style={{ width: 120 }}>ນາທີ<input className="input" inputMode="numeric" value={mins} onChange={e => setMins(e.target.value.replace(/\D/g, ''))} /></label>
          <button className="btn" disabled={emp === me.id} onClick={() => hr.save('ots', { id: uid(), companyId: me.companyId, employeeId: emp, date: ymd(new Date()), minutes: Number(mins) || 0, status: 'approved', reviewedBy: me.id }, 'ot-preapprove')}>ອະນຸມັດລ່ວງໜ້າ</button>
        </div>
      )}
      {pending.length === 0 ? <div className="empty">ບໍ່ມີ OT ລໍອະນຸມັດ</div> : pending.map(o => (
        <div key={o.id} className="row"><span className="grow">{nameOf(hr.employees, o.employeeId)} · {o.date} · {o.minutes} ນາທີ</span>
          {!readOnly && o.employeeId !== me.id && <><button className="btn ghost" onClick={() => hr.save('ots', { ...o, status: 'rejected', reviewedBy: me.id }, 'ot-reject')}>ປະຕິເສດ</button>
            <button className="btn" onClick={() => hr.save('ots', { ...o, status: 'approved', reviewedBy: me.id }, 'ot-approve')}>ອະນຸມັດ</button></>}
        </div>
      ))}
    </div>
  );
}

function TimeToday() {
  const hr = useHR();
  const now = new Date();
  return (
    <>
      <div className="col" style={{ gap: 0 }}><span className="muted">{laoDate(now)}</span><h1>ລົງເວລາມື້ນີ້</h1></div>
      <div className="card scroll-x"><table className="t"><thead><tr><th>ພະນັກງານ</th><th>ກະ</th><th>ເຂົ້າ</th><th>ອອກ</th><th>ມາຊ້າ</th><th>ສະຖານະ</th></tr></thead><tbody>
        {hr.employees.filter(e => e.baseSalary > 0 && isActiveOn(e, ymd(now))).map(e => {
          const mine = hr.scans.filter(s => s.employeeId === e.id && sameDay(s.deviceTime, now)).sort((a, b) => a.deviceTime.localeCompare(b.deviceTime));
          const fin = mine.find(s => s.kind === 'in');
          const fout = [...mine].reverse().find(s => s.kind === 'out');
          const shift = hr.shifts.find(s => s.id === e.shiftId)!;
          const late = fin ? lateMinutes(shift.start, new Date(fin.deviceTime), hr.settings.graceMinutes) : 0;
          const leave = hr.leaves.find(l => l.employeeId === e.id && l.status === 'approved' && l.from <= ymd(now) && l.to >= ymd(now));
          return <tr key={e.id}><td><b>{e.name}</b><div className="muted small">{e.dept}</div></td><td>{shift.name}</td><td>{fin ? hhmm(fin.deviceTime) : '—'}</td><td>{fout ? hhmm(fout.deviceTime) : '—'}</td>
            <td>{late ? <span className="pill warn">{late} ນາທີ</span> : '—'}</td>
            <td>{leave ? <span className="pill info">{LEAVE_TYPES[leave.type]}</span> : fin ? <StatusPill s={fin} /> : <span className="pill">ຍັງບໍ່ມາ</span>}</td></tr>;
        })}
      </tbody></table></div>
    </>
  );
}

function Leaves() {
  const hr = useHR();
  const me = hr.me!;
  const [note, setNote] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const now = new Date();
  // leave and advances have different approvers: Settings decides the first, the permission table the second
  const readOnly = approvalAccess(me.roles, 'leave', hr.settings) !== 'act';
  const advReadOnly = !canDo(me.roles, 'advance.decide');
  const act = async (l: LeaveRequest, d: 'approve' | 'reject') => {
    setErr('');
    try {
      const n = decide(l, me, d, hr.settings, now, note[l.id], deptOf(hr.employees, l.employeeId));
      await hr.save('leaves', n, 'leave-' + d);
      if (n.status !== 'pending') await hr.notify([l.employeeId], n.status === 'approved' ? 'ການລາ — ອະນຸມັດແລ້ວ' : `ການລາ — ບໍ່ອະນຸມັດ: ${note[l.id]}`, 'leave');
    } catch (e: any) { setErr(e.message); }
  };
  const actAdv = async (a: Advance, d: 'approve' | 'reject') => {
    setErr('');
    if (!canDo(me.roles, 'advance.decide')) return setErr('ບໍ່ມີສິດອະນຸມັດ');
    const sb = scopeBlock(me, deptOf(hr.employees, a.employeeId), ACTION_ROLES['advance.decide']);
    if (sb) return setErr(sb);
    if (a.employeeId === me.id) return setErr('ອະນຸມັດຄຳຂໍຂອງຕົນເອງບໍ່ໄດ້');
    if (a.approvals.some(x => x.by === me.id)) return setErr('ທ່ານອະນຸມັດແລ້ວ');
    if (d === 'reject' && !note[a.id]?.trim()) return setErr('ຕ້ອງໃສ່ເຫດຜົນເມື່ອປະຕິເສດ');
    const approvals = [...a.approvals, { by: me.id, at: now.toISOString(), decision: d }];
    const status = d === 'reject' ? 'rejected' : approvals.filter(x => x.decision === 'approve').length >= hr.settings.leaveApproversRequired ? 'approved' : 'pending';
    await hr.save('advances', { ...a, approvals, status }, 'advance-' + d);
    if (status !== 'pending') await hr.notify([a.employeeId], status === 'approved' ? 'ເບີກເງິນລ່ວງໜ້າ — ອະນຸມັດແລ້ວ' : `ເບີກເງິນລ່ວງໜ້າ — ບໍ່ອະນຸມັດ: ${note[a.id]}`, 'advance');
  };
  const seeMine = (id: string, roles: Role[]) => inMyScope(me, hr.employees, id, roles);
  const pend = hr.leaves.filter(l => l.status === 'pending' && seeMine(l.employeeId, hr.settings.leaveApproverRoles));
  const done = hr.leaves.filter(l => l.status !== 'pending' && seeMine(l.employeeId, hr.settings.leaveApproverRoles)).slice(-10).reverse();
  return (
    <>
      <div className="col" style={{ gap: 0 }}><span className="muted">ຕ້ອງອະນຸມັດ {hr.settings.leaveApproversRequired} ຄົນ · ສົ່ງຫາເຈົ້າຂອງຫຼັງ {hr.settings.escalateAfterHours} ຊມ</span><h1>ລາພັກ & ເບີກເງິນ</h1></div>
      {err && <div className="error" role="alert">{err}</div>}
      <div className="card col">
        <h2>ຄຳຂໍລາ ລໍອະນຸມັດ</h2>
        {pend.length === 0 && <div className="empty">ບໍ່ມີຄຳຂໍ</div>}
        {pend.map(l => {
          const block = approvalBlock(l, me, hr.settings, now, deptOf(hr.employees, l.employeeId));
          return (
            <div key={l.id} className="row wrap" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
              <div className="col grow" style={{ gap: 2 }}>
                <div className="row wrap"><b>{nameOf(hr.employees, l.employeeId)}</b><span className="pill ok">{LEAVE_TYPES[l.type]}</span>{isEscalated(l, hr.settings, now) && <span className="pill bad">ເກີນ {hr.settings.escalateAfterHours} ຊມ → ເຈົ້າຂອງ</span>}</div>
                <span className="muted small">{l.from} → {l.to} · {l.days} ມື້ · “{l.reason}” · ອະນຸມັດແລ້ວ {l.approvals.length}/{hr.settings.leaveApproversRequired}</span>
              </div>
              {!readOnly && (block ? <span className="muted small">{block}</span> : <>
                <input className="input" style={{ width: 180 }} placeholder="ເຫດຜົນ (ຖ້າປະຕິເສດ)" value={note[l.id] ?? ''} onChange={e => setNote({ ...note, [l.id]: e.target.value })} aria-label="ເຫດຜົນ" />
                <button className="btn danger" onClick={() => act(l, 'reject')}>ປະຕິເສດ</button>
                <button className="btn" onClick={() => act(l, 'approve')}>ອະນຸມັດ</button></>)}
            </div>
          );
        })}
      </div>
      <div className="card col">
        <h2>ຄຳຂໍເບີກເງິນລ່ວງໜ້າ</h2>
        {hr.advances.filter(a => a.status === 'pending' && seeMine(a.employeeId, ACTION_ROLES['advance.decide'])).length === 0 && <div className="empty">ບໍ່ມີຄຳຂໍ</div>}
        {hr.advances.filter(a => a.status === 'pending' && seeMine(a.employeeId, ACTION_ROLES['advance.decide'])).map(a => (
          <div key={a.id} className="row wrap"><span className="grow"><b>{nameOf(hr.employees, a.employeeId)}</b> · {money(a.amount)} ₭ · {a.createdAt.slice(0, 10)}</span>
            {!advReadOnly && a.employeeId !== me.id && <>
              <input className="input" style={{ width: 180 }} placeholder="ເຫດຜົນ (ຖ້າປະຕິເສດ)" value={note[a.id] ?? ''} onChange={e => setNote({ ...note, [a.id]: e.target.value })} aria-label="ເຫດຜົນ" />
              <button className="btn danger" onClick={() => actAdv(a, 'reject')}>ປະຕິເສດ</button><button className="btn" onClick={() => actAdv(a, 'approve')}>ອະນຸມັດ</button></>}</div>
        ))}
      </div>
      <div className="card col">
        <h2>ຕັດສິນແລ້ວ</h2>
        {done.length === 0 ? <div className="empty">ຍັງບໍ່ມີ</div> : done.map(l => (
          <div key={l.id} className="row"><span className="grow">{nameOf(hr.employees, l.employeeId)} · {LEAVE_TYPES[l.type]} · {l.from}</span>
            <span className={`pill ${l.status === 'approved' ? 'ok' : l.status === 'cancelled' ? 'info' : 'bad'}`}>{l.status === 'approved' ? 'ອະນຸມັດ' : l.status === 'cancelled' ? 'ຍົກເລີກແລ້ວ' : 'ປະຕິເສດ'}</span>
            <span className="muted small">{l.approvals.map(a => nameOf(hr.employees, a.by)).join(', ')}</span></div>
        ))}
      </div>
    </>
  );
}

interface ChangeRequest { id: string; companyId: string; employeeId: string; field: 'baseSalary' | 'bankAccount' | 'hire' | 'terminate'; from: string; to: string; by: string; at: string; status: 'pending' | 'approved' | 'rejected'; approvedBy?: string }

function changeText(c: ChangeRequest, emps: Employee[]) {
  if (c.field === 'hire') { const e = JSON.parse(c.to) as Employee; return <><b>ຈ້າງໃໝ່: {e.name}</b> ({e.code}) · {e.dept} · ເລີ່ມ {e.startDate} · {money(e.baseSalary)} ₭</>; }
  if (c.field === 'terminate') return <><b>{nameOf(emps, c.employeeId)}</b> · ປິດບັນຊີ / ລາອອກ ວັນທີ {c.to}</>;
  return <><b>{nameOf(emps, c.employeeId)}</b> · {c.field === 'baseSalary' ? 'ເງິນເດືອນ' : 'ເລກບັນຊີ'}: {c.field === 'baseSalary' ? `${money(+c.from)} → ${money(+c.to)}` : `${c.from || '—'} → ${c.to}`}</>;
}

function Staff() {
  const hr = useHR();
  const me = hr.me!;
  const [edit, setEdit] = useState<Employee | null>(null);
  const [salary, setSalary] = useState('');
  const [acct, setAcct] = useState('');
  const [msg, setMsg] = useState('');
  const [changes, setChanges] = useState<ChangeRequest[]>([]);
  useEffect(() => { hr.store.list<ChangeRequest>('changes').then(setChanges); }, [hr.store, hr.employees, msg]);
  const canEdit = canDo(me.roles, 'staff.edit');
  const canDecideChange = canDo(me.roles, 'staff.change.decide');

  const [shiftSel, setShiftSel] = useState('');
  const [dayOffSel, setDayOffSel] = useState<number[]>([0]);
  const [rolesSel, setRolesSel] = useState<Role[]>(['employee']);
  const [headSel, setHeadSel] = useState<string[]>([]);
  const depts = [...new Set(hr.employees.map(e => e.dept))];
  const canRoles = canGrantRoles(me.roles);
  const [hire, setHire] = useState<Employee | null>(null);
  const [endDate, setEndDate] = useState(ymd(new Date()));
  const today = ymd(new Date());
  const startHire = () => { setEdit(null); setMsg(''); setHire({ id: uid(), companyId: me.companyId, code: nextEmployeeCode(hr.employees), name: '', dept: '', position: '', roles: ['employee'], homeBranchId: hr.branches[0]?.id ?? '', shiftId: hr.shifts[0]?.id ?? '', dayOff: [0], startDate: today, baseSalary: 0, allowance: 0, payMethod: 'bank', bankName: 'LDB', bankAccount: '' }); };
  const setH = (patch: Partial<Employee>) => setHire(h => (h ? { ...h, ...patch } : h));
  const notifyOwners = (text: string) => hr.notify(hr.employees.filter(x => x.roles.includes('owner') && !x.endDate && x.id !== me.id).map(x => x.id), text, 'profile');
  const request = (employeeId: string, field: ChangeRequest['field'], from: string, to: string): ChangeRequest => ({ id: uid(), companyId: me.companyId, employeeId, field, from, to, by: me.id, at: new Date().toISOString(), status: 'pending' });
  const submitHire = async () => {
    if (!hire) return;
    const clean: Employee = { ...hire, name: hire.name.trim(), code: hire.code.trim(), dept: hire.dept.trim(), position: hire.position.trim(), bankName: hire.payMethod === 'bank' ? hire.bankName : undefined, bankAccount: hire.payMethod === 'bank' ? hire.bankAccount?.trim() : undefined };
    const errs = validateNewEmployee(clean, hr.employees, hr.shifts, hr.branches);
    if (errs.length) return setMsg(errs.join(' · '));
    if (changeNeedsSecondPerson(hr.settings)) {
      await hr.save('changes', request(clean.id, 'hire', '', JSON.stringify(clean)), 'change-request');
      setMsg(`ສົ່ງການຈ້າງ ${clean.name} ໃຫ້ອີກຄົນອະນຸມັດແລ້ວ (ກວດ 2 ຄົນ)`);
    } else {
      await hr.save('employees', clean, 'employee-hire');
      await notifyOwners(`ເພີ່ມພະນັກງານໃໝ່: ${clean.name} (${clean.code}) ເລີ່ມ ${clean.startDate}`);
      setMsg(`ເພີ່ມ ${clean.name} ແລ້ວ`);
    }
    setHire(null);
  };
  const submitTerminate = async () => {
    if (!edit) return;
    const block = terminationBlock(edit, hr.employees, endDate, me.id);
    if (block) return setMsg(block);
    if (changeNeedsSecondPerson(hr.settings)) {
      await hr.save('changes', request(edit.id, 'terminate', '', endDate), 'change-request');
      setMsg(`ສົ່ງການປິດບັນຊີ ${edit.name} ໃຫ້ອີກຄົນອະນຸມັດແລ້ວ`);
    } else {
      await hr.save('employees', { ...edit, endDate }, 'employee-terminate');
      await notifyOwners(`${edit.name} ສິ້ນສຸດການເຮັດວຽກວັນທີ ${endDate}`);
      setMsg(`ປິດບັນຊີ ${edit.name} ວັນທີ ${endDate} ແລ້ວ`);
    }
    setEdit(null);
  };
  const open = (e: Employee) => { setEdit(e); setSalary(String(e.baseSalary)); setAcct(e.bankAccount ?? ''); setShiftSel(e.shiftId); setDayOffSel(e.dayOff ?? [0]); setRolesSel(e.roles); setHeadSel(e.headOf ?? [e.dept]); setMsg(''); };
  const sameSet = (a: unknown[], b: unknown[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const submit = async () => {
    if (!edit) return;
    // schedule and roles are not pay data, so they apply at once (audited); salary and bank account may need a second person
    const direct: Partial<Employee> = {};
    if (shiftSel !== edit.shiftId) direct.shiftId = shiftSel;
    if (!sameSet(dayOffSel, edit.dayOff ?? [0])) direct.dayOff = dayOffSel;
    if (canRoles && !sameSet(rolesSel, edit.roles)) {
      const block = roleChangeBlock(hr.employees, edit.id, rolesSel, me.id);
      if (block) return setMsg(block);
      direct.roles = rolesSel;
    }
    if (canRoles && rolesSel.includes('head') && !sameSet(headSel, edit.headOf ?? [edit.dept])) direct.headOf = headSel.includes('*') ? ['*'] : headSel;
    const reqs: ChangeRequest[] = [];
    if (Number(salary) !== edit.baseSalary) reqs.push({ id: uid(), companyId: me.companyId, employeeId: edit.id, field: 'baseSalary', from: String(edit.baseSalary), to: String(Number(salary)), by: me.id, at: new Date().toISOString(), status: 'pending' });
    if (acct !== (edit.bankAccount ?? '')) reqs.push({ id: uid(), companyId: me.companyId, employeeId: edit.id, field: 'bankAccount', from: edit.bankAccount ?? '', to: acct, by: me.id, at: new Date().toISOString(), status: 'pending' });
    if (!reqs.length && !Object.keys(direct).length) return setMsg('ບໍ່ມີການປ່ຽນແປງ');
    const notes: string[] = [];
    if (Object.keys(direct).length) {
      await hr.save('employees', { ...edit, ...direct }, direct.roles ? 'employee-roles' : 'employee-schedule');
      notes.push('ບັນທຶກກະ / ວັນພັກ / ບົດບາດແລ້ວ');
      if (direct.roles) {
        const owners = hr.employees.filter(x => x.roles.includes('owner') && x.id !== me.id).map(x => x.id);
        await hr.notify([edit.id, ...owners], `ບົດບາດຂອງ ${edit.name} ຖືກປ່ຽນເປັນ: ${direct.roles.filter(r => r !== 'employee').map(r => ROLE_NAMES[r]).join(', ') || 'ພະນັກງານ'}`, 'profile');
      }
    }
    if (reqs.length) {
      if (changeNeedsSecondPerson(hr.settings)) {
        for (const r of reqs) await hr.save('changes', r, 'change-request');
        notes.push('ສົ່ງເງິນເດືອນ / ເລກບັນຊີ ໃຫ້ອີກຄົນອະນຸມັດແລ້ວ (ກວດ 2 ຄົນ)');
      } else {
        const current = hr.employees.find(x => x.id === edit.id)!; // includes the schedule change just saved
        await hr.save('employees', { ...current, ...direct, baseSalary: Number(salary), bankAccount: acct }, 'employee-update');
        notes.push('ບັນທຶກເງິນເດືອນ / ເລກບັນຊີແລ້ວ');
      }
    }
    setMsg(notes.join(' · '));
    setEdit(null);
  };
  const decideChange = async (c: ChangeRequest, ok: boolean) => {
    if (!canDecideChange) return setMsg('ບໍ່ມີສິດອະນຸມັດ');
    if (c.by === me.id) return setMsg('ຄົນສ້າງຄຳຂໍ ອະນຸມັດເອງບໍ່ໄດ້');
    if (c.field === 'hire' || c.field === 'terminate') {
      if (ok) {
        // re-check at approval time: the roster may have changed since the request was made
        if (c.field === 'hire') {
          const emp = JSON.parse(c.to) as Employee;
          const errs = validateNewEmployee(emp, hr.employees, hr.shifts, hr.branches);
          if (errs.length) return setMsg(`ອະນຸມັດບໍ່ໄດ້: ${errs.join(' · ')}`);
          await hr.save('employees', emp, 'apply-hire');
          await notifyOwners(`ເພີ່ມພະນັກງານໃໝ່: ${emp.name} (${emp.code}) ເລີ່ມ ${emp.startDate}`);
        } else {
          const t = hr.employees.find(x => x.id === c.employeeId);
          const block = t ? terminationBlock(t, hr.employees, c.to, c.by) : 'ບໍ່ພົບພະນັກງານ';
          if (block) return setMsg(`ອະນຸມັດບໍ່ໄດ້: ${block}`);
          await hr.save('employees', { ...t!, endDate: c.to }, 'apply-terminate');
          await notifyOwners(`${t!.name} ສິ້ນສຸດການເຮັດວຽກວັນທີ ${c.to}`);
        }
      }
      await hr.save('changes', { ...c, status: ok ? 'approved' : 'rejected', approvedBy: me.id }, ok ? 'change-approve' : 'change-reject');
      return;
    }
    const e = hr.employees.find(x => x.id === c.employeeId)!;
    if (ok) await hr.save('employees', { ...e, [c.field]: c.field === 'baseSalary' ? Number(c.to) : c.to }, `apply-${c.field}`);
    await hr.save('changes', { ...c, status: ok ? 'approved' : 'rejected', approvedBy: me.id }, ok ? 'change-approve' : 'change-reject');
    // demo stand-in for the push notification the employee gets when their bank account changes
    if (ok && c.field === 'bankAccount') setMsg(`ແຈ້ງເຕືອນ ${e.name} ແລ້ວວ່າເລກບັນຊີຖືກປ່ຽນ`);
  };

  return (
    <>
      <div className="row wrap"><h1 className="grow">ພະນັກງານ</h1>{canEdit && <button className="btn" onClick={startHire}>+ ເພີ່ມພະນັກງານ</button>}</div>
      {msg && <div className="pill info" style={{ alignSelf: 'flex-start', height: 'auto', padding: '6px 12px' }}>{msg}</div>}
      {changes.filter(c => c.status === 'pending').length > 0 && (
        <div className="card col"><h2>ຄຳຂໍປ່ຽນແປງ ລໍອະນຸມັດ (ກວດ 2 ຄົນ)</h2>
          {changes.filter(c => c.status === 'pending').map(c => (
            <div key={c.id} className="row wrap"><span className="grow">{changeText(c, hr.employees)} · ໂດຍ {nameOf(hr.employees, c.by)}</span>
              {canDecideChange && c.by !== me.id && <><button className="btn danger" onClick={() => decideChange(c, false)}>ປະຕິເສດ</button><button className="btn" onClick={() => decideChange(c, true)}>ອະນຸມັດ</button></>}
              {c.by === me.id && <span className="muted small">ລໍຄົນອື່ນອະນຸມັດ</span>}</div>))}
        </div>)}
      <div className="card scroll-x"><table className="t"><thead><tr><th>ລະຫັດ</th><th>ຊື່</th><th>ພະແນກ</th><th>ບົດບາດ</th><th className="num">ເງິນເດືອນ</th><th>ຮັບເງິນ</th><th>ໃບໜ້າ</th><th /></tr></thead><tbody>
        {hr.employees.map(e => <tr key={e.id}><td>{e.code}</td><td><b>{e.name}</b> {!isActiveOn(e, today) && <span className="pill">{e.endDate && e.startDate <= today ? `ສິ້ນສຸດ ${e.endDate}` : `ເລີ່ມ ${e.startDate}`}</span>}<div className="muted small">{e.position}</div></td><td>{e.dept}</td><td className="small">{e.roles.map(r => ROLE_NAMES[r]).join(', ')}</td>
          <td className="num">{money(e.baseSalary)}</td><td className="small">{e.payMethod === 'cash' ? 'ເງິນສົດ' : `${e.bankName} ${e.bankAccount ?? ''}`}</td>
          <td>{e.faceEnrolled ? <span className="pill ok">ລົງທະບຽນແລ້ວ</span> : <span className="pill">ຍັງ</span>}</td>
          <td>{canEdit && !(e.endDate && e.endDate < today) && <button className="btn ghost" onClick={() => { setHire(null); open(e); }}>ແກ້ໄຂ</button>}</td></tr>)}
      </tbody></table></div>
      {edit && (
        <div className="card col" style={{ maxWidth: 480 }}>
          <h2>ແກ້ໄຂ: {edit.name}</h2>
          <label className="field">ເງິນເດືອນພື້ນຖານ<input className="input" inputMode="numeric" value={salary} onChange={e => setSalary(e.target.value.replace(/\D/g, ''))} /></label>
          <label className="field">ເລກບັນຊີທະນາຄານ<input className="input" value={acct} onChange={e => setAcct(e.target.value)} /></label>
          <label className="field">ກະປະຈຳ<select className="input" value={shiftSel} onChange={e => setShiftSel(e.target.value)}>{hr.shifts.map(s => <option key={s.id} value={s.id}>{s.name} {s.start}–{s.end}</option>)}</select></label>
          <fieldset style={{ border: '1.5px solid var(--line-2)', borderRadius: 14, padding: '6px 12px' }}><legend className="small muted">ວັນພັກປະຈຳອາທິດ</legend>
            <div className="row wrap">{['ອາ', 'ຈ', 'ອ', 'ພ', 'ພຫ', 'ສຸ', 'ເສ'].map((d, i) => <label key={d} className="row" style={{ minHeight: 40 }}><input type="checkbox" checked={dayOffSel.includes(i)} onChange={() => setDayOffSel(dayOffSel.includes(i) ? dayOffSel.filter(x => x !== i) : [...dayOffSel, i])} />{d}</label>)}</div></fieldset>
          {canRoles && <fieldset style={{ border: '1.5px solid var(--line-2)', borderRadius: 14, padding: '6px 12px' }}><legend className="small muted">ບົດບາດ (ສະເພາະເຈົ້າຂອງ ກຳນົດໄດ້ · ມີຜົນທັນທີ ແລະ ເກັບໃນ audit log)</legend>
            <div className="row wrap">{(['head', 'accountant', 'owner', 'auditor'] as Role[]).map(r => <label key={r} className="row" style={{ minHeight: 40 }}><input type="checkbox" disabled={edit.id === me.id} checked={rolesSel.includes(r)} onChange={() => setRolesSel(rolesSel.includes(r) ? rolesSel.filter(x => x !== r) : [...rolesSel, r])} />{ROLE_NAMES[r]}</label>)}</div>
            {edit.id === me.id && <span className="muted small">ແກ້ບົດບາດຂອງຕົນເອງບໍ່ໄດ້</span>}</fieldset>}
          {canRoles && rolesSel.includes('head') && <fieldset style={{ border: '1.5px solid var(--line-2)', borderRadius: 14, padding: '6px 12px' }}><legend className="small muted">ຫົວໜ້າດູແລພະແນກ (ອະນຸມັດໄດ້ສະເພາະພະແນກເຫຼົ່ານີ້)</legend>
            <div className="row wrap"><label className="row" style={{ minHeight: 40 }}><input type="checkbox" checked={headSel.includes('*')} onChange={() => setHeadSel(headSel.includes('*') ? [edit.dept] : ['*'])} />ທຸກພະແນກ</label>
              {depts.map(d => <label key={d} className="row" style={{ minHeight: 40 }}><input type="checkbox" disabled={headSel.includes('*')} checked={headSel.includes('*') || headSel.includes(d)} onChange={() => setHeadSel(headSel.includes(d) ? headSel.filter(x => x !== d) : [...headSel, d])} />{d}</label>)}</div></fieldset>}
          <div className="row"><button className="btn ghost" onClick={() => setEdit(null)}>ຍົກເລີກ</button><button className="btn" onClick={submit}>{changeNeedsSecondPerson(hr.settings) ? 'ສົ່ງໃຫ້ອະນຸມັດ' : 'ບັນທຶກ'}</button></div>
          {!edit.endDate && <fieldset style={{ border: '1.5px solid var(--line-2)', borderRadius: 14, padding: '6px 12px' }}><legend className="small muted">ລາອອກ / ປິດບັນຊີ</legend>
            <div className="row wrap"><label className="field grow">ວັນສຸດທ້າຍຂອງການເຮັດວຽກ<input className="input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></label>
              <button className="btn danger" onClick={submitTerminate}>ປິດບັນຊີ</button></div>
            <span className="muted small">ເງິນເດືອນເດືອນສຸດທ້າຍຄິດຕາມສັດສ່ວນວັນ · ປະຫວັດການລົງເວລາຍັງຢູ່ຄົບ</span></fieldset>}
        </div>)}
      {hire && (
        <div className="card col" style={{ maxWidth: 480 }}>
          <h2>ເພີ່ມພະນັກງານໃໝ່</h2>
          <label className="field">ລະຫັດ<input className="input" value={hire.code} onChange={e => setH({ code: e.target.value })} /></label>
          <label className="field">ຊື່-ນາມສະກຸນ<input className="input" value={hire.name} onChange={e => setH({ name: e.target.value })} /></label>
          <label className="field">ພະແນກ<input className="input" list="dept-list" value={hire.dept} onChange={e => setH({ dept: e.target.value })} /><datalist id="dept-list">{depts.map(d => <option key={d} value={d} />)}</datalist></label>
          <label className="field">ຕຳແໜ່ງ<input className="input" value={hire.position} onChange={e => setH({ position: e.target.value })} /></label>
          <label className="field">ວັນເລີ່ມວຽກ<input className="input" type="date" value={hire.startDate} onChange={e => setH({ startDate: e.target.value })} /></label>
          <label className="field">ສາຂາຫຼັກ<select className="input" value={hire.homeBranchId} onChange={e => setH({ homeBranchId: e.target.value })}>{hr.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label className="field">ກະປະຈຳ<select className="input" value={hire.shiftId} onChange={e => setH({ shiftId: e.target.value })}>{hr.shifts.map(s => <option key={s.id} value={s.id}>{s.name} {s.start}–{s.end}</option>)}</select></label>
          <label className="field">ເງິນເດືອນພື້ນຖານ<input className="input" inputMode="numeric" value={hire.baseSalary || ''} onChange={e => setH({ baseSalary: Number(e.target.value.replace(/\D/g, '')) })} /></label>
          <label className="field">ເບ້ຍລ້ຽງ<input className="input" inputMode="numeric" value={hire.allowance || ''} onChange={e => setH({ allowance: Number(e.target.value.replace(/\D/g, '')) })} /></label>
          <label className="field">ຮັບເງິນ<select className="input" value={hire.payMethod} onChange={e => setH({ payMethod: e.target.value as Employee['payMethod'] })}><option value="bank">ໂອນທະນາຄານ</option><option value="cash">ເງິນສົດ</option></select></label>
          {hire.payMethod === 'bank' && <>
            <label className="field">ທະນາຄານ<select className="input" value={hire.bankName} onChange={e => setH({ bankName: e.target.value })}>{['LDB', 'JDB', 'ST Bank'].map(b => <option key={b}>{b}</option>)}</select></label>
            <label className="field">ເລກບັນຊີ<input className="input" value={hire.bankAccount ?? ''} onChange={e => setH({ bankAccount: e.target.value })} /></label></>}
          <span className="muted small">ບົດບາດເລີ່ມຕົ້ນເປັນ "ພະນັກງານ" ເທົ່ານັ້ນ — ເຈົ້າຂອງກຳນົດບົດບາດອື່ນພາຍຫຼັງ</span>
          <div className="row"><button className="btn ghost" onClick={() => setHire(null)}>ຍົກເລີກ</button><button className="btn" onClick={submitHire}>{changeNeedsSecondPerson(hr.settings) ? 'ສົ່ງໃຫ້ອະນຸມັດ' : 'ບັນທຶກ'}</button></div>
        </div>)}
    </>
  );
}

function Payroll() {
  const hr = useHR();
  const me = hr.me!;
  const now = new Date();
  const key = monthKey(now);
  const run: PayrollRun = hr.payrollRuns.find(r => r.id === key) ?? { id: key, companyId: me.companyId, status: 'draft', lateConfirmed: [] };
  const [msg, setMsg] = useState('');
  const staff = hr.employees.filter(e => e.baseSalary > 0 && employedFraction(e, now.getFullYear(), now.getMonth()) > 0);
  const rows = staff.map(e => summarize(hr, e, key, run.lateConfirmed.includes(e.id)));
  const total = rows.reduce((a, r) => a + r.slip.net, 0);
  const locked = run.status === 'locked';
  const canPrepare = canDo(me.roles, 'payroll.prepare');
  const canLock = canDo(me.roles, 'payroll.lock');
  const canConfirmLate = canDo(me.roles, 'payroll.confirmLate');

  const toggleLate = (id: string) => hr.save('payrollRuns', { ...run, lateConfirmed: run.lateConfirmed.includes(id) ? run.lateConfirmed.filter(x => x !== id) : [...run.lateConfirmed, id] }, 'late-confirm');
  const prepare = () => hr.save('payrollRuns', { ...run, status: 'prepared', preparedBy: me.id }, 'payroll-prepare');
  const lock = async () => {
    const block = payrollLockBlock(run.preparedBy, me.id, hr.settings); if (block) return setMsg(block);
    await hr.save('payrollRuns', { ...run, status: 'locked', approvedBy: me.id, slips: Object.fromEntries(rows.map(r => [r.employee.id, r.slip.net])) }, 'payroll-lock');
    // advances are settled only when the period is locked
    for (const r of rows) for (const a of hr.advances.filter(a => a.employeeId === r.employee.id && a.status === 'approved' && a.remaining > 0)) {
      await hr.save('advances', { ...a, remaining: Math.max(0, a.remaining - Math.ceil(a.amount / a.installments)) }, 'advance-deduct');
    }
  };
  const exportBank = () => downloadText(`ໂອນເງິນເດືອນ_${key}.csv`, bankCsv(rows.filter(r => r.employee.payMethod === 'bank').map(r => ({ code: r.employee.code, name: r.employee.name, bank: r.employee.bankName ?? '', account: r.employee.bankAccount ?? '', amount: r.slip.net }))));
  const exportCash = () => downloadText(`ໃບເຊັນຮັບເງິນສົດ_${key}.csv`, bankCsv(rows.filter(r => r.employee.payMethod === 'cash').map(r => ({ code: r.employee.code, name: r.employee.name, bank: 'ເງິນສົດ', account: '(ເຊັນຮັບ)', amount: r.slip.net }))));

  return (
    <>
      <div className="row wrap">
        <div className="col grow" style={{ gap: 0 }}>
          <span className="muted">ງວດ {key} · {run.status === 'draft' ? 'ຮ່າງ' : run.status === 'prepared' ? `ກະກຽມໂດຍ ${nameOf(hr.employees, run.preparedBy)} · ລໍອະນຸມັດ` : `ລັອກແລ້ວ · ອະນຸມັດໂດຍ ${nameOf(hr.employees, run.approvedBy)}`}</span>
          <h1>ເງິນເດືອນ {laoMonth(now.getFullYear(), now.getMonth())}</h1>
        </div>
        <button className="btn ghost" onClick={exportBank}>Export ໂອນທະນາຄານ</button>
        <button className="btn ghost" onClick={exportCash}>Export ເງິນສົດ</button>
        {canPrepare && run.status === 'draft' && <button className="btn" onClick={prepare}>ກະກຽມ & ສົ່ງອະນຸມັດ</button>}
        {canLock && run.status === 'prepared' && <button className="btn" onClick={lock}>ອະນຸມັດ & ລັອກງວດ</button>}
      </div>
      {msg && <div className="error" role="alert">{msg}</div>}
      <div className="grid"><div className="card dark"><span className="small" style={{ color: '#9fd8d4' }}>ຈ່າຍສຸດທິ · {rows.length} ຄົນ</span><div className="big-num">{money(total)} ₭</div></div>
        <div className="card"><span className="muted small">ປະກັນສັງຄົມ {hr.settings.ssRate * 100}%</span><div className="big-num">{money(rows.reduce((a, r) => a + r.slip.socialSecurity, 0))}</div></div>
        <div className="card"><span className="muted small">ອາກອນ</span><div className="big-num">{money(rows.reduce((a, r) => a + r.slip.tax, 0))}</div></div></div>
      <div className="card scroll-x"><table className="t"><thead><tr><th>ພະນັກງານ</th><th className="num">ພື້ນຖານ</th><th className="num">OT</th><th>ມາຊ້າ (ຢືນຢັນ?)</th><th className="num">ປະກັນ</th><th className="num">ອາກອນ</th><th className="num">ເບີກ</th><th className="num">ສຸດທິ</th></tr></thead><tbody>
        {rows.map(r => <tr key={r.employee.id}><td><b>{r.employee.name}</b><div className="muted small">{r.employee.payMethod === 'cash' ? 'ເງິນສົດ' : r.employee.bankName}</div></td>
          <td className="num">{money(r.slip.base)}</td><td className="num">{money(r.slip.ot)}</td>
          <td>{r.lateMin ? <label className="row small"><input type="checkbox" disabled={locked || !canConfirmLate} checked={r.lateConfirmed} onChange={() => toggleLate(r.employee.id)} />{r.lateMin} ນທ → −{money(r.lateMin * hr.settings.lateDeductPerMinute)}</label> : '—'}</td>
          <td className="num">{money(r.slip.socialSecurity)}</td><td className="num">{money(r.slip.tax)}</td><td className="num">{money(r.slip.advance)}</td><td className="num"><b>{money(r.slip.net)}</b></td></tr>)}
      </tbody></table></div>
      {locked && <div className="muted small">ງວດນີ້ລັອກແລ້ວ: ການແກ້ໄຂທີ່ພົບພາຍຫຼັງ ຈະເປັນລາຍການປັບໃນເດືອນຖັດໄປ.</div>}
    </>
  );
}

function SettingsPage({ readOnly }: { readOnly: boolean }) {
  const hr = useHR();
  const me = hr.me!;
  const [s, setS] = useState<Settings>(hr.settings);
  const [radii, setRadii] = useState<Record<string, number>>(() => Object.fromEntries(hr.branches.map(b => [b.id, b.radiusM])));
  const [shiftRows, setShiftRows] = useState<Shift[]>(hr.shifts);
  const [newHoliday, setNewHoliday] = useState('');
  const [msg, setMsg] = useState('');
  // follow the stored values when they change underneath (saved, or demo data reset), but not on every reload
  const stored = JSON.stringify([hr.settings, hr.branches.map(b => b.radiusM), hr.shifts]);
  useEffect(() => { setS(hr.settings); setShiftRows(hr.shifts); setRadii(Object.fromEntries(hr.branches.map(b => [b.id, b.radiusM]))); }, [stored]); // eslint-disable-line react-hooks/exhaustive-deps
  const setShift = (id: string, patch: Partial<Shift>) => setShiftRows(rows => rows.map(r => r.id === id ? { ...r, ...patch } : r));
  const errors = [
    ...validateSettings(s),
    ...validateShifts(shiftRows),
    ...hr.branches.filter(b => !(Number.isInteger(radii[b.id]) && radii[b.id] >= 10 && radii[b.id] <= 2000)).map(b => `ລັດສະໝີ ${b.name} ຕ້ອງເປັນເລກເຕັມ 10–2000 ແມັດ`)
  ];
  const dirty = JSON.stringify(s) !== JSON.stringify(hr.settings) || hr.branches.some(b => radii[b.id] !== b.radiusM) || JSON.stringify(shiftRows) !== JSON.stringify(hr.shifts);
  // show 0.07×100 as 7, not 7.000000000000001
  const shown = (v: number, scale: number) => (Number.isFinite(v) ? Math.round(v * scale * 1e6) / 1e6 : '');
  const num = (k: keyof Settings, label: string, step = 1, scale = 1) => (
    <label className="field">{label}<input className="input" type="number" step={step} disabled={readOnly} value={shown(Number(s[k]), scale)}
      onChange={e => setS({ ...s, [k]: e.target.value === '' ? NaN : Number(e.target.value) / scale })} /></label>);
  const setBracket = (i: number, patch: Partial<TaxBracket>) => setS({ ...s, taxBrackets: s.taxBrackets.map((b, j) => j === i ? { ...b, ...patch } : b) });
  const toggleRole = (r: Role) => setS({ ...s, leaveApproverRoles: s.leaveApproverRoles.includes(r) ? s.leaveApproverRoles.filter(x => x !== r) : [...s.leaveApproverRoles, r] });
  const addHoliday = () => {
    if (!newHoliday || s.holidays.includes(newHoliday)) return;
    setS({ ...s, holidays: [...s.holidays, newHoliday].sort() });
    setNewHoliday('');
  };
  const useHere = async (branchId: string) => {
    if (!canDo(me.roles, 'settings.edit')) return;
    const p = await getPosition();
    if (!p) return setMsg('ອ່ານ GPS ບໍ່ໄດ້ (ກວດສິດຕຳແໜ່ງ)');
    const b = hr.branches.find(x => x.id === branchId)!;
    await hr.save('branches', { ...b, lat: p.lat, lng: p.lng }, 'branch-gps');
    setMsg(`ຕັ້ງ ${b.name} = ຕຳແໜ່ງນີ້ແລ້ວ (±${Math.round(p.accuracyM)} ມ.)`);
  };
  const saveAll = async () => {
    if (!canDo(me.roles, 'settings.edit') || errors.length) return;
    await hr.save('settings', { ...s, id: s.companyId }, 'settings-update');
    for (const b of hr.branches) if (radii[b.id] !== b.radiusM) await hr.save('branches', { ...b, radiusM: radii[b.id] }, 'branch-radius');
    for (const sh of shiftRows) if (JSON.stringify(sh) !== JSON.stringify(hr.shifts.find(x => x.id === sh.id))) await hr.save('shifts', sh, 'shift-update');
    setMsg('ບັນທຶກການຕັ້ງຄ່າແລ້ວ');
  };
  return (
    <>
      <h1>ຕັ້ງຄ່າ</h1>
      {msg && <div className="pill info" role="status" style={{ alignSelf: 'flex-start', height: 'auto', padding: '6px 12px' }}>{msg}</div>}
      <div className="card col"><h2>ສາຂາ & GPS</h2>
        {hr.branches.map(b => <div key={b.id} className="row wrap"><b className="grow">{b.name}</b><span className="muted small">{b.lat.toFixed(5)}, {b.lng.toFixed(5)}</span>
          <label className="row small">ລັດສະໝີ (ມ.)<input className="input" style={{ width: 90 }} type="number" disabled={readOnly} value={Number.isFinite(radii[b.id]) ? radii[b.id] : ''} aria-label={`ລັດສະໝີ ${b.name}`}
            onChange={e => setRadii({ ...radii, [b.id]: e.target.value === '' ? NaN : Number(e.target.value) })} /></label>
          {!readOnly && <button className="btn ghost" onClick={() => useHere(b.id)}>ໃຊ້ຕຳແໜ່ງຂ້ອຍຕອນນີ້</button>}</div>)}
      </div>
      <div className="card col"><h2>ກະວຽກ</h2>
        <span className="muted small">ເວລາເລີ່ມຂອງກະ ໃຊ້ຄິດມາຊ້າ. ການປ່ຽນມີຜົນກັບການຄິດມາຊ້າທັງໝົດທີ່ຍັງບໍ່ລັອກງວດ</span>
        {shiftRows.map(sh => (
          <div key={sh.id} className="row wrap" style={{ alignItems: 'flex-end' }}>
            <label className="field grow" style={{ minWidth: 120 }}>ຊື່ກະ<input className="input" disabled={readOnly} value={sh.name} onChange={e => setShift(sh.id, { name: e.target.value })} /></label>
            {([['start', 'ເລີ່ມ'], ['end', 'ເລີກ'], ['breakStart', 'ເລີ່ມພັກ'], ['breakEnd', 'ເສັດພັກ']] as const).map(([k, l]) => (
              <label key={k} className="field">{l}<input className="input" type="time" disabled={readOnly} value={sh[k]} aria-label={`${sh.name} ${l}`} onChange={e => setShift(sh.id, { [k]: e.target.value })} /></label>))}
          </div>))}
      </div>
      <div className="card col"><h2>ເວລາ & ສະແກນ</h2><div className="grid">
        {num('graceMinutes', 'ຜ່ອນຜັນມາຊ້າ (ນາທີ)')}{num('lateDeductPerMinute', 'ຫັກມາຊ້າ (ກີບ/ນາທີ)', 100)}{num('otRate', 'ອັດຕາ OT (ເທົ່າ)', 0.1)}
        {num('faceMinScore', 'ໃບໜ້າຂັ້ນຕ່ຳ (%)')}{num('maxClockSkewMin', 'ໂມງຕ່າງໄດ້ສູງສຸດ (ນາທີ)')}{num('randomSamplePerDay', 'ສຸ່ມກວດຕໍ່ມື້')}{num('photoRetentionDays', 'ເກັບຮູບ (ມື້)')}
      </div></div>
      <div className="card col"><h2>ລາພັກ & ອະນຸມັດ</h2><div className="grid">
        {num('leaveDaysPerYear', 'ມື້ລາພັກ/ປີ')}{num('leaveCarryOverMax', 'ຍົກໄປປີໜ້າສູງສຸດ (ມື້)')}{num('escalateAfterHours', 'ສົ່ງຫາເຈົ້າຂອງຫຼັງ (ຊົ່ວໂມງ)')}
        <label className="field">ວິທີໄດ້ສິດລາ<select className="input" disabled={readOnly} value={s.leaveAccrual} onChange={e => setS({ ...s, leaveAccrual: e.target.value as Settings['leaveAccrual'] })}>
          <option value="monthly">ສະສົມເປັນເດືອນ</option><option value="yearStart">ໄດ້ເຕັມຕົ້ນປີ</option><option value="anniversary">ຕາມວັນຄົບຮອບ</option></select></label>
        <label className="field">ຕ້ອງອະນຸມັດຈັກຄົນ<select className="input" disabled={readOnly} value={s.leaveApproversRequired} onChange={e => setS({ ...s, leaveApproversRequired: Number(e.target.value) as 1 | 2 })}><option value={1}>1 ຄົນ</option><option value={2}>2 ຄົນ</option></select></label>
        <label className="row" style={{ minHeight: 44 }}><input type="checkbox" disabled={readOnly} checked={s.makerChecker} onChange={e => setS({ ...s, makerChecker: e.target.checked })} />ເງິນເດືອນ / ເລກບັນຊີ ຕ້ອງກວດ 2 ຄົນ</label>
      </div>
        <fieldset style={{ border: '1.5px solid var(--line-2)', borderRadius: 14, padding: '8px 14px' }}><legend className="small muted">ໃຜອະນຸມັດການລາໄດ້ (ເຈົ້າຂອງຊ່ວຍໄດ້ຫຼັງເກີນເວລາ)</legend>
          <div className="row wrap">{ASSIGNABLE_APPROVER_ROLES.map(r => <label key={r} className="row" style={{ minHeight: 40 }}><input type="checkbox" disabled={readOnly} checked={s.leaveApproverRoles.includes(r)} onChange={() => toggleRole(r)} />{ROLE_NAMES[r]}</label>)}</div></fieldset>
        <div className="grid">{num('advanceMaxPctOfEarned', 'ເບີກລ່ວງໜ້າສູງສຸດ (% ຂອງເງິນທີ່ໄດ້ແລ້ວ)', 5, 100)}</div>
      </div>
      <div className="card col"><h2>ວັນພັກລັດຖະການ</h2>
        <span className="muted small">ວັນເຫຼົ່ານີ້ບໍ່ນັບເປັນຂາດ ແລະ ບໍ່ນັບເປັນມື້ລາ</span>
        <div className="row wrap">{s.holidays.length === 0 && <span className="muted">ຍັງບໍ່ມີ</span>}{s.holidays.map(d => (
          <span key={d} className="pill info" style={{ height: 34 }}>{d.split('-').reverse().join('/')}{!readOnly && <button aria-label={`ລຶບ ${d}`} onClick={() => setS({ ...s, holidays: s.holidays.filter(x => x !== d) })} style={{ border: 'none', background: 'none', marginLeft: 6, fontWeight: 800 }}>×</button>}</span>))}</div>
        {!readOnly && <div className="row"><input className="input" type="date" aria-label="ເພີ່ມວັນພັກ" value={newHoliday} onChange={e => setNewHoliday(e.target.value)} style={{ maxWidth: 200 }} /><button className="btn ghost" onClick={addHoliday} disabled={!newHoliday}>+ ເພີ່ມວັນພັກ</button></div>}
      </div>
      <div className="card col"><h2>ປະກັນສັງຄົມ & ອາກອນ</h2>
        <div className="pill warn" style={{ alignSelf: 'flex-start', height: 'auto', padding: '6px 12px', whiteSpace: 'normal' }}>ຄ່າເລີ່ມຕົ້ນເປັນຕົວຢ່າງ — ກວດກັບກົດໝາຍປັດຈຸບັນກ່ອນໃຊ້ຈິງ</div>
        <div className="grid">{num('ssRate', 'ປະກັນສັງຄົມພະນັກງານ (%)', 0.1, 100)}{num('workHoursPerMonth', 'ຊົ່ວໂມງວຽກ/ເດືອນ')}</div>
        <table className="t"><thead><tr><th>ລາຍໄດ້ເຖິງ (ກີບ)</th><th>ອັດຕາ (%)</th></tr></thead><tbody>
          {s.taxBrackets.map((b, i) => <tr key={i}><td>{b.upTo == null ? 'ຂຶ້ນໄປ' : <input className="input" type="number" disabled={readOnly} value={Number.isFinite(b.upTo) ? b.upTo : ''} onChange={e => setBracket(i, { upTo: e.target.value === '' ? NaN : Number(e.target.value) })} aria-label="ລາຍໄດ້ເຖິງ" />}</td>
            <td><input className="input" type="number" step="0.5" disabled={readOnly} value={shown(b.rate, 100)} onChange={e => setBracket(i, { rate: e.target.value === '' ? NaN : Number(e.target.value) / 100 })} aria-label="ອັດຕາ" /></td></tr>)}
        </tbody></table>
      </div>
      {!readOnly && errors.length > 0 && <div className="error" role="alert"><b>ບັນທຶກບໍ່ໄດ້ — ກະລຸນາແກ້:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{errors.map(e => <li key={e}>{e}</li>)}</ul></div>}
      {!readOnly && <div className="row"><button className="btn" disabled={errors.length > 0 || !dirty} onClick={saveAll}>ບັນທຶກການຕັ້ງຄ່າ</button>
        {dirty && <span className="pill warn">ມີການແກ້ໄຂທີ່ຍັງບໍ່ບັນທຶກ</span>}
        <button className="btn danger" onClick={() => { if (confirm('ລ້າງຂໍ້ມູນສາທິດທັງໝົດ?')) hr.resetDemo(); }}>ລ້າງຂໍ້ມູນສາທິດ</button></div>}
    </>
  );
}

function Audit() {
  const hr = useHR();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof hr.store.audit>>>([]);
  useEffect(() => { hr.store.audit().then(r => setRows([...r].reverse())); }, [hr.store, hr.employees, hr.scans, hr.leaves, hr.payrollRuns, hr.settings]);
  return (
    <>
      <div className="col" style={{ gap: 0 }}><span className="muted">ບັນທຶກທຸກການປ່ຽນແປງ · ລຶບ ແລະ ແກ້ບໍ່ໄດ້</span><h1>Audit log</h1></div>
      <div className="card scroll-x"><table className="t"><thead><tr><th>ເວລາ</th><th>ໂດຍ</th><th>ການກະທຳ</th><th>ຂໍ້ມູນ</th><th>ID</th></tr></thead><tbody>
        {rows.filter(r => r.action !== 'seed').slice(0, 200).map(r => <tr key={r.id}><td className="small">{ymd(new Date(r.at))} {new Date(r.at).toTimeString().slice(0, 8)}</td><td>{nameOf(hr.employees, r.by)}</td><td><span className="pill info">{r.action}</span></td><td>{r.entity}</td><td className="small muted">{r.entityId}</td></tr>)}
      </tbody></table>{rows.filter(r => r.action !== 'seed').length === 0 && <div className="empty">ຍັງບໍ່ມີການປ່ຽນແປງ</div>}</div>
    </>
  );
}
