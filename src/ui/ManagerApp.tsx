import { useEffect, useMemo, useState } from 'react';
import { useHR, type PayrollRun } from '../app/state';
import type { Advance, AuditEntry, Branch, Employee, LeaveRequest, Role, ScanRecord, Settings, Shift, TaxBracket } from '../domain/types';
import { ASSIGNABLE_APPROVER_ROLES, validateSettings, validateShifts } from '../domain/settingsCheck';
import { actionRoles, approvalAccess, canDo, canDoIn, canGrantRoles, canViewPage, isReadOnly, roleChangeBlock, scopeBlock, type ManagerPage } from '../domain/permissions';
import { deptOf, inMyScope } from '../app/scope';
import { dailySample, lateMinutes } from '../domain/attendance';
import { approvalBlock, decide, isEscalated } from '../domain/leave';
import { bankCsv, changeNeedsSecondPerson, payrollLockBlock } from '../domain/payroll';
import { branchDeleteBlock, validateBranch } from '../domain/branches';
import { exportPayrollXlsx } from '../app/exportPayroll';
import { PayslipView, type PayslipData } from './PayslipView';
import { employedFraction, isActiveOn, nextEmployeeCode, terminationBlock, validateNewEmployee } from '../domain/hiring';
import { lateStartOn, monthKey, summarize } from '../app/payrun';
import { leaveSpan, shiftRange } from '../domain/leavePart';
import { planSettlement, settlementItem } from '../app/settlement';
import { branchBlock, countedEmployees, featureBlock, hireBlock } from '../domain/company';
import { PlanCard } from './PlanCard';
import { commissionAmount, initialPayItemStatus, PAY_ITEM_LABEL, payItemDecisionBlock, pendingPayItemsBlock, validatePayItem, type PayItem, type PayItemKind } from '../domain/payItems';
import { closesAtFor } from '../domain/missedOut';
import { activeSession, scansOn, toSessions } from '../domain/sessions';
import { effectiveShift } from '../domain/requests';
import { getPosition } from '../device/geo';
import { uid } from '../data/store';
import { faceTemplates } from '../domain/face';
import { KIND_LABEL } from './labels';
import Approvals, { actionableCount, NoAccess, SECTION_LABEL, visibleSections, type ApprovalSection } from './Approvals';
import { Reports, TeamMap } from './Pages';
import Icon, { type IconName } from './Icon';
import StaffImport from './StaffImport';
import BackupCard from './BackupCard';
import AccessPage from './AccessPage';
import { profileProblems, type ProfileEdit } from '../domain/hiring';
import { bulkTargets, makePersonalShift, personalShiftId, personalShiftProblems, sharedShifts, shiftDeleteBlock, type Hours } from '../domain/personalShift';
import { recordChanges, RULE_LABEL, ruleChanges, rulesSummary, type RulesTab } from '../domain/rules';
import { downloadText,hhmm, LEAVE_TYPES, laoDate, laoMonth, money, ROLE_NAMES, sameDay, ymd } from './format';

type Page = ManagerPage;
const PAGE_LABEL: Record<Page, string> = {
  overview: 'ພາບລວມ', review: 'ກວດການລົງເວລາ', approvals: 'ອະນຸມັດຄຳຂໍ', time: 'ລົງເວລາມື້ນີ້', reports: 'ລາຍງານທີມ', map: 'ແຜນທີ່',
  leave: 'ລາພັກ & ເບີກ', staff: 'ພະນັກງານ', pay: 'ເງິນເດືອນ', access: 'ສິດ & ການອະນຸມັດ', settings: 'ກົດເກນ & ຕັ້ງຄ່າ', audit: 'Audit log'
};
const PAGE_ORDER = Object.keys(PAGE_LABEL) as Page[];
const PAGE_ICON: Record<Page, IconName> = { overview: 'dashboard', review: 'scan', approvals: 'ot', time: 'clock', reports: 'reports', map: 'map', leave: 'leave', staff: 'directory', pay: 'pay', access: 'privacy', settings: 'settings', audit: 'audit' };

/** A blocking message as a list, so it can be spread next to other messages (spreading the string itself would split it into letters). */
const asList = (m: string | null) => (m ? [m] : []);

const nameOf = (emps: Employee[], id?: string) => emps.find(e => e.id === id)?.name ?? id ?? '—';

export default function ManagerApp({ onSwitch, onEmployeeView }: { onSwitch: () => void; onEmployeeView: () => void }) {
  const hr = useHR();
  const me = hr.me!;
  const pages = PAGE_ORDER.filter(p => canViewPage(me.roles, p, hr.settings));
  const [page, setPage] = useState<Page>(pages[0]);
  const readOnly = isReadOnly(me.roles);
  // badges count only what this person could decide: a head's own departments
  const inScope = (id: string, roles: Role[]) => inMyScope(me, hr.employees, id, roles);
  const pendingScans = hr.scans.filter(s => s.status === 'pending' && inScope(s.employeeId, actionRoles('scan.review', hr.settings))).length + hr.ots.filter(o => o.status === 'pending' && inScope(o.employeeId, actionRoles('scan.review', hr.settings))).length;
  const pendingLeave = hr.leaves.filter(l => l.status === 'pending' && inScope(l.employeeId, hr.settings.leaveApproverRoles)).length + hr.advances.filter(a => a.status === 'pending' && inScope(a.employeeId, actionRoles('advance.decide', hr.settings))).length;
  const reqCount = (['shift', 'schedule', 'ot', 'expense', 'certificate', 'leaveCancel', 'device', 'face', 'scan'] as ApprovalSection[]).reduce((a, s) => a + (s === 'scan' ? hr.requests.filter(r => r.kind === 'clockFix' && r.status === 'pending').length : actionableCount(hr, s)), 0);
  const badge: Partial<Record<Page, number>> = { review: pendingScans, leave: pendingLeave, approvals: reqCount };

  return (
    <div className="mgr">
      <nav aria-label="ເມນູ HR">
        <div className="brand"><span className="logo">ST</span><div className="col" style={{ gap: 0 }}><b style={{ color: '#fff', fontSize: 17 }}>ST HR</b><span className="small" style={{ color: '#7fbdb9' }}>{me.name} · {me.roles.filter(r => r !== 'employee').map(r => ROLE_NAMES[r]).join(', ')}</span></div></div>
        {pages.map(p => (
          <button key={p} aria-current={page === p ? 'page' : undefined} onClick={() => setPage(p)}>
            <span className="nav-l"><Icon name={PAGE_ICON[p]} size={20} />{PAGE_LABEL[p]}</span>{!!badge[p] && <span className="badge">{badge[p]}</span>}
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
          {page === 'review' && <Review readOnly={!canDoIn(me.roles, 'scan.review', hr.settings)} />}
          {page === 'approvals' && <ApprovalsHub />}
          {page === 'time' && <TimeToday />}
          {page === 'reports' && <><h1>ລາຍງານທີມ</h1><Reports team /></>}
          {page === 'map' && <><h1>ແຜນທີ່ການສະແກນມື້ນີ້</h1><TeamMap /></>}
          {page === 'leave' && <Leaves />}
          {page === 'staff' && <Staff />}
          {page === 'pay' && <Payroll />}
          {page === 'access' && <AccessPage />}
          {page === 'settings' && <SettingsPage readOnly={!canDo(me.roles, 'settings.edit')} />}
          {page === 'audit' && <Audit />}
        </>}
      </main>
    </div>
  );
}

/** One employee's current work day: the calendar day, or the day an unfinished night shift began. */
function workDayOf(hr: ReturnType<typeof useHR>, e: Employee, now: Date) {
  const closesOf = (date: string) => closesAtFor(date, hr.shifts.find(x => x.id === effectiveShift(e, date, hr.overrides)));
  const sessions = toSessions(hr.scans.filter(s => s.employeeId === e.id), closesOf);
  const date = activeSession(sessions, now, closesOf)?.workDate ?? ymd(now);
  return { date, scans: scansOn(sessions, date) };
}

function Overview() {
  const hr = useHR();
  const now = new Date();
  const today = hr.scans.filter(s => sameDay(s.deviceTime, now));
  const staff = hr.employees.filter(e => isActiveOn(e, ymd(now)) && e.baseSalary > 0);
  // someone still on a night shift that began yesterday is present today too
  const present = new Set(staff.filter(e => workDayOf(hr, e, now).scans.some(s => s.kind === 'in')).map(e => e.id));
  const onLeave = hr.leaves.filter(l => l.status === 'approved' && !l.part && l.from <= ymd(now) && l.to >= ymd(now)).length;
  let late = 0;
  for (const e of staff) {
    const wd = workDayOf(hr, e, now);
    const first = wd.scans.find(s => s.kind === 'in');
    const start = first && lateStartOn(hr, e, wd.date);
    if (first && start && lateMinutes(start, new Date(first.deviceTime), hr.settings.graceMinutes) > 0) late++;
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
  const mine = (id: string) => inMyScope(me, hr.employees, id, actionRoles('scan.review', hr.settings));
  const list = tab === 'pending' ? hr.scans.filter(s => s.status === 'pending' && mine(s.employeeId)) : tab === 'sample' ? sample.filter(s => mine(s.employeeId)) : [];
  const [selId, setSelId] = useState<string | null>(null);
  const sel = list.find(s => s.id === selId) ?? list[0];

  const decideScan = async (s: ScanRecord, ok: boolean) => {
    setErr('');
    const sb = scopeBlock(me, deptOf(hr.employees, s.employeeId), actionRoles('scan.review', hr.settings));
    if (sb) return setErr(sb);
    if (s.employeeId === me.id && !hr.approver!.selfOk) return setErr('ກວດການລົງເວລາຂອງຕົນເອງບໍ່ໄດ້');
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
  const mine = hr.employees.filter(e => isActiveOn(e, ymd(new Date())) && inMyScope(me, hr.employees, e.id, actionRoles('ot.preapprove')));
  const [emp, setEmp] = useState(mine[0]?.id ?? '');
  const [mins, setMins] = useState('60');
  const pending = hr.ots.filter(o => o.status === 'pending' && mine.some(e => e.id === o.employeeId));
  return (
    <div className="card col">
      {!readOnly && (
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <label className="field grow">ສັ່ງ OT ໃຫ້<select className="input" value={emp} onChange={e => setEmp(e.target.value)}>{mine.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <label className="field" style={{ width: 120 }}>ນາທີ<input className="input" inputMode="numeric" value={mins} onChange={e => setMins(e.target.value.replace(/\D/g, ''))} /></label>
          <button className="btn" disabled={emp === me.id && !hr.approver!.selfOk} onClick={() => hr.save('ots', { id: uid(), companyId: me.companyId, employeeId: emp, date: ymd(new Date()), minutes: Number(mins) || 0, status: 'approved', reviewedBy: me.id }, 'ot-preapprove')}>ອະນຸມັດລ່ວງໜ້າ</button>
        </div>
      )}
      {pending.length === 0 ? <div className="empty">ບໍ່ມີ OT ລໍອະນຸມັດ</div> : pending.map(o => (
        <div key={o.id} className="row"><span className="grow">{nameOf(hr.employees, o.employeeId)} · {o.date} · {o.minutes} ນາທີ</span>
          {!readOnly && (o.employeeId !== me.id || hr.approver!.selfOk) && <><button className="btn ghost" onClick={() => hr.save('ots', { ...o, status: 'rejected', reviewedBy: me.id }, 'ot-reject')}>ປະຕິເສດ</button>
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
          const wd = workDayOf(hr, e, now);
          const mine = wd.scans;
          const fin = mine.find(s => s.kind === 'in');
          const fout = [...mine].reverse().find(s => s.kind === 'out');
          const shift = hr.shifts.find(s => s.id === (effectiveShift(e, wd.date, hr.overrides) ?? e.shiftId))!;
          const lateFrom = lateStartOn(hr, e, wd.date); // null: day off or flexible hours, so never late
          const late = fin && lateFrom ? lateMinutes(lateFrom, new Date(fin.deviceTime), hr.settings.graceMinutes) : 0;
          const leave = hr.leaves.find(l => l.employeeId === e.id && l.status === 'approved' && !l.part && l.from <= ymd(now) && l.to >= ymd(now));
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
  const advReadOnly = !canDoIn(me.roles, 'advance.decide', hr.settings);
  const act = async (l: LeaveRequest, d: 'approve' | 'reject') => {
    setErr('');
    try {
      const n = decide(l, hr.approver!, d, hr.settings, now, note[l.id], deptOf(hr.employees, l.employeeId));
      await hr.save('leaves', n, 'leave-' + d);
      if (n.status !== 'pending') await hr.notify([l.employeeId], n.status === 'approved' ? 'ການລາ — ອະນຸມັດແລ້ວ' : `ການລາ — ບໍ່ອະນຸມັດ: ${note[l.id]}`, 'leave');
    } catch (e: any) { setErr(e.message); }
  };
  const actAdv = async (a: Advance, d: 'approve' | 'reject') => {
    setErr('');
    if (!canDoIn(me.roles, 'advance.decide', hr.settings)) return setErr('ບໍ່ມີສິດອະນຸມັດ');
    const sb = scopeBlock(me, deptOf(hr.employees, a.employeeId), actionRoles('advance.decide', hr.settings));
    if (sb) return setErr(sb);
    const own = a.employeeId === me.id;
    if (own && !hr.approver!.selfOk) return setErr('ອະນຸມັດຄຳຂໍຂອງຕົນເອງບໍ່ໄດ້');
    if (a.approvals.some(x => x.by === me.id)) return setErr('ທ່ານອະນຸມັດແລ້ວ');
    if (d === 'reject' && !note[a.id]?.trim()) return setErr('ຕ້ອງໃສ່ເຫດຜົນເມື່ອປະຕິເສດ');
    const approvals = [...a.approvals, { by: me.id, at: now.toISOString(), decision: d }];
    const status = d === 'reject' ? 'rejected' : approvals.filter(x => x.decision === 'approve').length >= (own && hr.approver!.selfOk ? 1 : hr.settings.leaveApproversRequired) ? 'approved' : 'pending';
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
          const block = approvalBlock(l, hr.approver!, hr.settings, now, deptOf(hr.employees, l.employeeId));
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
        {hr.advances.filter(a => a.status === 'pending' && seeMine(a.employeeId, actionRoles('advance.decide', hr.settings))).length === 0 && <div className="empty">ບໍ່ມີຄຳຂໍ</div>}
        {hr.advances.filter(a => a.status === 'pending' && seeMine(a.employeeId, actionRoles('advance.decide', hr.settings))).map(a => (
          <div key={a.id} className="row wrap"><span className="grow"><b>{nameOf(hr.employees, a.employeeId)}</b> · {money(a.amount)} ₭ · {a.createdAt.slice(0, 10)}</span>
            {!advReadOnly && (a.employeeId !== me.id || hr.approver!.selfOk) && <>
              <input className="input" style={{ width: 180 }} placeholder="ເຫດຜົນ (ຖ້າປະຕິເສດ)" value={note[a.id] ?? ''} onChange={e => setNote({ ...note, [a.id]: e.target.value })} aria-label="ເຫດຜົນ" />
              <button className="btn danger" onClick={() => actAdv(a, 'reject')}>ປະຕິເສດ</button><button className="btn" onClick={() => actAdv(a, 'approve')}>ອະນຸມັດ</button></>}</div>
        ))}
      </div>
      <div className="card col">
        <h2>ຕັດສິນແລ້ວ</h2>
        {done.length === 0 ? <div className="empty">ຍັງບໍ່ມີ</div> : done.map(l => (
          <div key={l.id} className="row"><span className="grow">{nameOf(hr.employees, l.employeeId)} · {LEAVE_TYPES[l.type]} · {leaveSpan(l)} · {l.from}</span>
            <span className={`pill ${l.status === 'approved' ? 'ok' : l.status === 'cancelled' ? 'info' : 'bad'}`}>{l.status === 'approved' ? 'ອະນຸມັດ' : l.status === 'cancelled' ? 'ຍົກເລີກແລ້ວ' : 'ປະຕິເສດ'}</span>
            <span className="muted small">{l.approvals.map(a => nameOf(hr.employees, a.by)).join(', ')}</span></div>
        ))}
      </div>
    </>
  );
}

interface ChangeRequest { id: string; companyId: string; employeeId: string; field: 'baseSalary' | 'bankAccount' | 'allowance' | 'payMethod' | 'hire' | 'terminate'; from: string; to: string; by: string; at: string; status: 'pending' | 'approved' | 'rejected'; approvedBy?: string }

function changeText(c: ChangeRequest, emps: Employee[]) {
  if (c.field === 'hire') { const e = JSON.parse(c.to) as Employee; return <><b>ຈ້າງໃໝ່: {e.name}</b> ({e.code}) · {e.dept} · ເລີ່ມ {e.startDate} · {money(e.baseSalary)} ₭</>; }
  if (c.field === 'terminate') return <><b>{nameOf(emps, c.employeeId)}</b> · ປິດບັນຊີ / ລາອອກ ວັນທີ {c.to}{c.from === 'payout' ? ' · ຈ່າຍວັນລາພັກຄ້າງ' : ''}</>;
  if (c.field === 'payMethod') { const a = JSON.parse(c.from) as { payMethod: string; bankName?: string }, b = JSON.parse(c.to) as { payMethod: string; bankName?: string }; const t = (x: typeof a) => (x.payMethod === 'cash' ? 'ເງິນສົດ' : `ໂອນ ${x.bankName ?? ''}`); return <><b>{nameOf(emps, c.employeeId)}</b> · ວິທີຮັບເງິນ: {t(a)} → {t(b)}</>; }
  const num = c.field === 'baseSalary' || c.field === 'allowance';
  return <><b>{nameOf(emps, c.employeeId)}</b> · {c.field === 'baseSalary' ? 'ເງິນເດືອນ' : c.field === 'allowance' ? 'ເງິນອຸດໜູນ' : 'ເລກບັນຊີ'}: {num ? `${money(+c.from)} → ${money(+c.to)}` : `${c.from || '—'} → ${c.to}`}</>;
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
  // own hours for this one person (shown when the shift list is set to "own hours")
  const CUSTOM = '__custom';
  const [own, setOwn] = useState<Hours>({ start: '08:00', end: '17:00', breakStart: '12:00', breakEnd: '13:00' });
  const [prof, setProf] = useState<ProfileEdit | null>(null);
  const [bulk, setBulk] = useState<{ dept: string; shiftId: string; dayOff: number[] | null } | null>(null);
  const [rolesSel, setRolesSel] = useState<Role[]>(['employee']);
  const [headSel, setHeadSel] = useState<string[]>([]);
  const depts = [...new Set(hr.employees.map(e => e.dept))];
  const canRoles = canGrantRoles(me.roles);
  const [hire, setHire] = useState<Employee | null>(null);
  const [importing, setImporting] = useState(false);
  const [endDate, setEndDate] = useState(ymd(new Date()));
  const [payout, setPayout] = useState(true);
  const today = ymd(new Date());
  const startHire = () => { const lim = hireBlock(hr.company, countedEmployees(hr.employees, today), today); if (lim) return setMsg(lim); setEdit(null); setMsg(''); setHire({ id: uid(), companyId: me.companyId, code: nextEmployeeCode(hr.employees), name: '', dept: '', position: '', roles: ['employee'], homeBranchId: hr.branches[0]?.id ?? '', shiftId: hr.shifts[0]?.id ?? '', dayOff: [0], startDate: today, baseSalary: 0, allowance: 0, payMethod: 'bank', bankName: 'LDB', bankAccount: '' }); };
  const setH = (patch: Partial<Employee>) => setHire(h => (h ? { ...h, ...patch } : h));
  const notifyOwners = (text: string) => hr.notify(hr.employees.filter(x => x.roles.includes('owner') && !x.endDate && x.id !== me.id).map(x => x.id), text, 'profile');
  const request = (employeeId: string, field: ChangeRequest['field'], from: string, to: string): ChangeRequest => ({ id: uid(), companyId: me.companyId, employeeId, field, from, to, by: me.id, at: new Date().toISOString(), status: 'pending' });
  const submitHire = async () => {
    if (!hire) return;
    const clean: Employee = { ...hire, name: hire.name.trim(), code: hire.code.trim(), dept: hire.dept.trim(), position: hire.position.trim(), bankName: hire.payMethod === 'bank' ? hire.bankName : undefined, bankAccount: hire.payMethod === 'bank' ? hire.bankAccount?.trim() : undefined };
    const errs = [...validateNewEmployee(clean, hr.employees, hr.shifts, hr.branches), ...asList(hireBlock(hr.company, countedEmployees(hr.employees, today), today))];
    if (errs.length) return setMsg(errs.join(' · '));
    if ((changeNeedsSecondPerson(hr.settings) && !hr.approver!.selfOk)) {
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
    if ((changeNeedsSecondPerson(hr.settings) && !hr.approver!.selfOk)) {
      // 'from' carries whether to pay out unused leave; the amount is worked out again when the second person approves
      await hr.save('changes', request(edit.id, 'terminate', payout ? 'payout' : '', endDate), 'change-request');
      setMsg(`ສົ່ງການປິດບັນຊີ ${edit.name} ໃຫ້ອີກຄົນອະນຸມັດແລ້ວ`);
    } else {
      const item = payout ? settlementItem(hr, edit, planSettlement(hr, edit, endDate, new Date()), me.id, new Date()) : null;
      await hr.save('employees', { ...edit, endDate }, 'employee-terminate');
      if (item) await hr.save('payItems', item, 'pay-item-settlement');
      await notifyOwners(`${edit.name} ສິ້ນສຸດການເຮັດວຽກວັນທີ ${endDate}`);
      setMsg(`ປິດບັນຊີ ${edit.name} ວັນທີ ${endDate} ແລ້ວ${item ? ` · ຈ່າຍວັນລາພັກຄ້າງ ${money(item.amount)} ₭ ໃນເງິນເດືອນ ${item.month}` : ''}`);
    }
    setEdit(null);
  };
  const open = (e: Employee) => { setProf({ name: e.name, code: e.code, dept: e.dept, position: e.position, homeBranchId: e.homeBranchId, startDate: e.startDate, allowance: e.allowance, payMethod: e.payMethod, bankName: e.bankName }); const cur = hr.shifts.find(s => s.id === e.shiftId); setEdit(e); setSalary(String(e.baseSalary)); setAcct(e.bankAccount ?? ''); setShiftSel(cur?.personal ? CUSTOM : e.shiftId); if (cur?.personal) setOwn({ start: cur.start, end: cur.end, breakStart: cur.breakStart, breakEnd: cur.breakEnd, flexible: cur.flexible, dailyHours: cur.dailyHours, allowance: cur.allowance }); setDayOffSel(e.dayOff ?? [0]); setRolesSel(e.roles); setHeadSel(e.headOf ?? [e.dept]); setMsg(''); };
  const sameSet = (a: unknown[], b: unknown[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const submit = async () => {
    if (!edit) return;
    // schedule and roles are not pay data, so they apply at once (audited); salary and bank account may need a second person
    const direct: Partial<Employee> = {};
    if (shiftSel === CUSTOM) {
      const p = makePersonalShift(edit, own);
      const problems = personalShiftProblems(p, hr.shifts);
      if (problems.length) return setMsg(problems.join(' · '));
      const before = hr.shifts.find(s => s.id === p.id);
      if (JSON.stringify(before) !== JSON.stringify(p)) await hr.save('shifts', p, before ? 'shift-personal-update' : 'shift-personal');
      if (edit.shiftId !== p.id) direct.shiftId = p.id;
    } else if (shiftSel !== edit.shiftId) direct.shiftId = shiftSel;
    const ownChanged = shiftSel === CUSTOM && JSON.stringify(hr.shifts.find(s => s.id === personalShiftId(edit.id))) !== JSON.stringify(makePersonalShift(edit, own));
    if (!sameSet(dayOffSel, edit.dayOff ?? [0])) direct.dayOff = dayOffSel;
    if (canRoles && !sameSet(rolesSel, edit.roles)) {
      const block = roleChangeBlock(hr.employees, edit.id, rolesSel, me.id);
      if (block) return setMsg(block);
      direct.roles = rolesSel;
    }
    if (canRoles && rolesSel.includes('head') && !sameSet(headSel, edit.headOf ?? [edit.dept])) direct.headOf = headSel.includes('*') ? ['*'] : headSel;
    // profile: name, code, department, position, branch and start date apply at once (audited); allowance and how someone is paid follow the salary rules
    const pay: Partial<Employee> = {};
    if (prof) {
      const problems = profileProblems(prof, hr.employees.filter(x => x.id !== edit.id), hr.branches, acct);
      if (problems.length) return setMsg(problems.join(' · '));
      const plain = { name: prof.name.trim(), code: prof.code.trim(), dept: prof.dept.trim(), position: prof.position.trim(), homeBranchId: prof.homeBranchId, startDate: prof.startDate } as const;
      for (const k of Object.keys(plain) as (keyof typeof plain)[]) if (plain[k] !== edit[k]) (direct as Record<string, unknown>)[k] = plain[k];
      if (prof.allowance !== edit.allowance) pay.allowance = prof.allowance;
      if (prof.payMethod !== edit.payMethod || (prof.payMethod === 'bank' && (prof.bankName ?? '') !== (edit.bankName ?? ''))) { pay.payMethod = prof.payMethod; pay.bankName = prof.payMethod === 'bank' ? (prof.bankName ?? '').trim() : undefined; }
    }
    const reqs: ChangeRequest[] = [];
    const asReq = (field: ChangeRequest['field'], from: string, to: string): ChangeRequest => ({ id: uid(), companyId: me.companyId, employeeId: edit.id, field, from, to, by: me.id, at: new Date().toISOString(), status: 'pending' });
    if (pay.allowance !== undefined) reqs.push(asReq('allowance', String(edit.allowance), String(pay.allowance)));
    if ('payMethod' in pay) reqs.push(asReq('payMethod', JSON.stringify({ payMethod: edit.payMethod, bankName: edit.bankName }), JSON.stringify({ payMethod: pay.payMethod, bankName: pay.bankName })));
    if (Number(salary) !== edit.baseSalary) reqs.push({ id: uid(), companyId: me.companyId, employeeId: edit.id, field: 'baseSalary', from: String(edit.baseSalary), to: String(Number(salary)), by: me.id, at: new Date().toISOString(), status: 'pending' });
    if (acct !== (edit.bankAccount ?? '')) reqs.push({ id: uid(), companyId: me.companyId, employeeId: edit.id, field: 'bankAccount', from: edit.bankAccount ?? '', to: acct, by: me.id, at: new Date().toISOString(), status: 'pending' });
    if (!reqs.length && !Object.keys(direct).length) { setMsg(ownChanged || shiftSel === CUSTOM ? 'ບັນທຶກເວລາເຂົ້າ-ອອກສະເພາະຄົນແລ້ວ' : 'ບໍ່ມີການປ່ຽນແປງ'); if (shiftSel === CUSTOM) setEdit(null); return; }
    const notes: string[] = [];
    if (Object.keys(direct).length) {
      await hr.save('employees', { ...edit, ...direct }, direct.roles ? 'employee-roles' : 'name' in direct || 'code' in direct || 'dept' in direct || 'position' in direct || 'homeBranchId' in direct || 'startDate' in direct ? 'employee-profile' : 'employee-schedule');
      notes.push('ບັນທຶກຂໍ້ມູນ / ກະ / ວັນພັກ / ບົດບາດແລ້ວ');
      if (direct.roles) {
        const owners = hr.employees.filter(x => x.roles.includes('owner') && x.id !== me.id).map(x => x.id);
        await hr.notify([edit.id, ...owners], `ບົດບາດຂອງ ${edit.name} ຖືກປ່ຽນເປັນ: ${direct.roles.filter(r => r !== 'employee').map(r => ROLE_NAMES[r]).join(', ') || 'ພະນັກງານ'}`, 'profile');
      }
    }
    if (reqs.length) {
      if ((changeNeedsSecondPerson(hr.settings) && !hr.approver!.selfOk)) {
        for (const r of reqs) await hr.save('changes', r, 'change-request');
        notes.push('ສົ່ງເງິນເດືອນ / ເລກບັນຊີ / ເງິນອຸດໜູນ / ວິທີຮັບເງິນ ໃຫ້ອີກຄົນອະນຸມັດແລ້ວ (ກວດ 2 ຄົນ)');
      } else {
        const current = hr.employees.find(x => x.id === edit.id)!; // includes the schedule change just saved
        await hr.save('employees', { ...current, ...direct, ...pay, baseSalary: Number(salary), bankAccount: acct }, 'employee-update');
        notes.push('ບັນທຶກເງິນເດືອນ / ເລກບັນຊີແລ້ວ');
      }
    }
    setMsg(notes.join(' · '));
    setEdit(null);
  };
  const decideChange = async (c: ChangeRequest, ok: boolean) => {
    if (!canDecideChange) return setMsg('ບໍ່ມີສິດອະນຸມັດ');
    if (c.by === me.id && (changeNeedsSecondPerson(hr.settings) && !hr.approver!.selfOk)) return setMsg('ຄົນສ້າງຄຳຂໍ ອະນຸມັດເອງບໍ່ໄດ້ (ເປີດກວດ 2 ຄົນຢູ່)');
    if (c.field === 'hire' || c.field === 'terminate') {
      if (ok) {
        // re-check at approval time: the roster may have changed since the request was made
        if (c.field === 'hire') {
          const emp = JSON.parse(c.to) as Employee;
          const errs = [...validateNewEmployee(emp, hr.employees, hr.shifts, hr.branches), ...asList(hireBlock(hr.company, countedEmployees(hr.employees, ymd(new Date())), ymd(new Date())))];
          if (errs.length) return setMsg(`ອະນຸມັດບໍ່ໄດ້: ${errs.join(' · ')}`);
          await hr.save('employees', emp, 'apply-hire');
          await notifyOwners(`ເພີ່ມພະນັກງານໃໝ່: ${emp.name} (${emp.code}) ເລີ່ມ ${emp.startDate}`);
        } else {
          const t = hr.employees.find(x => x.id === c.employeeId);
          const block = t ? terminationBlock(t, hr.employees, c.to, c.by) : 'ບໍ່ພົບພະນັກງານ';
          if (block) return setMsg(`ອະນຸມັດບໍ່ໄດ້: ${block}`);
          // settlement first: its leave balance is measured while the person is still on the roster
          const item = c.from === 'payout' ? settlementItem(hr, t!, planSettlement(hr, t!, c.to, new Date()), c.by, new Date()) : null;
          await hr.save('employees', { ...t!, endDate: c.to }, 'apply-terminate');
          if (item) await hr.save('payItems', item, 'pay-item-settlement');
          await notifyOwners(`${t!.name} ສິ້ນສຸດການເຮັດວຽກວັນທີ ${c.to}`);
        }
      }
      await hr.save('changes', { ...c, status: ok ? 'approved' : 'rejected', approvedBy: me.id }, ok ? 'change-approve' : 'change-reject');
      return;
    }
    const e = hr.employees.find(x => x.id === c.employeeId)!;
    if (ok) await hr.save('employees', c.field === 'payMethod' ? { ...e, ...(JSON.parse(c.to) as Pick<Employee, 'payMethod' | 'bankName'>) } : { ...e, [c.field]: c.field === 'baseSalary' || c.field === 'allowance' ? Number(c.to) : c.to }, `apply-${c.field}`);
    await hr.save('changes', { ...c, status: ok ? 'approved' : 'rejected', approvedBy: me.id }, ok ? 'change-approve' : 'change-reject');
    // demo stand-in for the push notification the employee gets when their bank account changes
    if (ok && c.field === 'bankAccount') setMsg(`ແຈ້ງເຕືອນ ${e.name} ແລ້ວວ່າເລກບັນຊີຖືກປ່ຽນ`);
  };

  const pendingHires = changes.filter(c => c.status === 'pending' && c.field === 'hire' && (c.by !== me.id || !(changeNeedsSecondPerson(hr.settings) && !hr.approver!.selfOk)));
  const otherDecider = hr.employees.some(x => x.id !== me.id && !x.endDate && canDo(x.roles, 'staff.change.decide'));
  const [approvingAll, setApprovingAll] = useState(false);
  const approveAllHires = async () => {
    setApprovingAll(true);
    let done = 0;
    const accepted: Employee[] = [];
    for (const c of pendingHires) {
      const emp = JSON.parse(c.to) as Employee;
      // checked against the roster plus the hires just approved in this batch, so a duplicate inside the batch is still refused
      const errs = [...validateNewEmployee(emp, [...hr.employees, ...accepted], hr.shifts, hr.branches), ...asList(hireBlock(hr.company, countedEmployees([...hr.employees, ...accepted], today), today))];
      if (errs.length) continue;
      await hr.save('employees', emp, 'apply-hire');
      await hr.save('changes', { ...c, status: 'approved', approvedBy: me.id }, 'change-approve');
      accepted.push(emp);
      done++;
    }
    if (done) await notifyOwners(`ເພີ່ມພະນັກງານໃໝ່ ${done} ຄົນ (ອະນຸມັດທັງໝົດ)`);
    setApprovingAll(false);
    setMsg(done === pendingHires.length ? `ອະນຸມັດການຈ້າງ ${done} ຄົນແລ້ວ` : `ອະນຸມັດ ${done} ຈາກ ${pendingHires.length} ຄົນ — ທີ່ເຫຼືອມີບັນຫາ ໃຫ້ກົດອະນຸມັດທີລະຄົນເພື່ອເບິ່ງເຫດຜົນ`);
  };

  return (
    <>
      <div className="row wrap"><h1 className="grow">ພະນັກງານ</h1>{canEdit && <button className="btn ghost" onClick={() => { setHire(null); setEdit(null); setImporting(true); }}>⬆ ນຳເຂົ້າຈາກ Excel</button>}{canEdit && <button className="btn" onClick={() => { setImporting(false); startHire(); }}>+ ເພີ່ມພະນັກງານ</button>}</div>
      {canEdit && !bulk && <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => { setEdit(null); setHire(null); setBulk({ dept: '*', shiftId: sharedShifts(hr.shifts)[0]?.id ?? '', dayOff: null }); }}>🕘 ຕັ້ງເວລາເຂົ້າ-ອອກໃຫ້ຫຼາຍຄົນ</button>}
      {bulk && (() => { const who = bulkTargets(hr.employees, bulk.dept, today); return (
        <div className="card col">
          <div className="row"><h2 className="grow">ຕັ້ງກະ / ເວລາເຂົ້າ-ອອກ ໃຫ້ຫຼາຍຄົນພ້ອມກັນ</h2><button className="btn ghost" onClick={() => setBulk(null)}>ປິດ</button></div>
          <span className="muted small">ໃຊ້ກະດຽວກັນກັບທັງອົງກອນ ຫຼື ທັງພະແນກ. ຢາກປ່ຽນເວລາຂອງກະເອງ (ເຊັ່ນ 08:00 → 07:30) ໃຫ້ແກ້ໃນ ກົດເກນ & ຕັ້ງຄ່າ → ກະວຽກ — ທຸກຄົນໃນກະນັ້ນປ່ຽນຕາມ. ຄົນທີ່ມີເວລາສະເພາະ ຈະຖືກຍ້າຍມາໃຊ້ກະນີ້.</span>
          <div className="row wrap">
            <label className="field">ໃຜ<select className="input" value={bulk.dept} onChange={e => setBulk({ ...bulk, dept: e.target.value })}><option value="*">ທຸກຄົນ</option>{depts.map(d => <option key={d} value={d}>ພະແນກ {d}</option>)}</select></label>
            <label className="field">ກະ<select className="input" value={bulk.shiftId} onChange={e => setBulk({ ...bulk, shiftId: e.target.value })}>{sharedShifts(hr.shifts).map(s => <option key={s.id} value={s.id}>{s.name} {shiftRange(s)}</option>)}</select></label>
          </div>
          <label className="row" style={{ minHeight: 40 }}><input type="checkbox" checked={bulk.dayOff !== null} onChange={e => setBulk({ ...bulk, dayOff: e.target.checked ? [0] : null })} />ປ່ຽນວັນພັກປະຈຳອາທິດນຳ</label>
          {bulk.dayOff && <div className="row wrap">{['ອາ', 'ຈ', 'ອ', 'ພ', 'ພຫ', 'ສຸ', 'ເສ'].map((d, i) => <label key={d} className="row" style={{ minHeight: 40 }}><input type="checkbox" checked={bulk.dayOff!.includes(i)} onChange={() => setBulk({ ...bulk, dayOff: bulk.dayOff!.includes(i) ? bulk.dayOff!.filter(x => x !== i) : [...bulk.dayOff!, i] })} />{d}</label>)}</div>}
          <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={!who.length || !bulk.shiftId} onClick={async () => {
            if (!confirm(`ຕັ້ງກະນີ້ໃຫ້ ${who.length} ຄົນ?`)) return;
            for (const e of who) await hr.save('employees', { ...e, shiftId: bulk.shiftId, ...(bulk.dayOff ? { dayOff: bulk.dayOff } : {}) }, 'shift-bulk');
            setMsg(`ຕັ້ງກະໃຫ້ ${who.length} ຄົນແລ້ວ`); setBulk(null);
          }}>ໃຊ້ກັບ {who.length} ຄົນ</button>
        </div>); })()}
      {importing && <StaffImport onClose={() => setImporting(false)} onDone={m => { setImporting(false); setMsg(m); }} />}
      {msg && <div className="pill info" style={{ alignSelf: 'flex-start', height: 'auto', padding: '6px 12px' }}>{msg}</div>}
      {changes.filter(c => c.status === 'pending').length > 0 && (
        <div className="card col"><div className="row wrap"><h2 className="grow">ຄຳຂໍປ່ຽນແປງ ລໍອະນຸມັດ (ກວດ 2 ຄົນ)</h2>
          {canDecideChange && pendingHires.length > 1 && <button className="btn" disabled={approvingAll} onClick={approveAllHires}>{approvingAll ? 'ກຳລັງອະນຸມັດ…' : `ອະນຸມັດການຈ້າງທັງໝົດ (${pendingHires.length})`}</button>}</div>
          {changes.filter(c => c.status === 'pending').map(c => (
            <div key={c.id} className="row wrap"><span className="grow">{changeText(c, hr.employees)} · ໂດຍ {nameOf(hr.employees, c.by)}</span>
              {canDecideChange && c.by !== me.id && <><button className="btn danger" onClick={() => decideChange(c, false)}>ປະຕິເສດ</button><button className="btn" onClick={() => decideChange(c, true)}>ອະນຸມັດ</button></>}
              {c.by === me.id && (changeNeedsSecondPerson(hr.settings) && !hr.approver!.selfOk) && <span className="muted small">ລໍຄົນອື່ນອະນຸມັດ</span>}
              {c.by === me.id && !(changeNeedsSecondPerson(hr.settings) && !hr.approver!.selfOk) && canDecideChange && <><button className="btn danger" onClick={() => decideChange(c, false)}>ຍົກເລີກຄຳຂໍ</button><button className="btn" onClick={() => decideChange(c, true)}>ນຳໃຊ້ເລີຍ</button></>}</div>))}
          {(changeNeedsSecondPerson(hr.settings) && !hr.approver!.selfOk) && !otherDecider && changes.some(c => c.status === 'pending' && c.by === me.id) && (
            <div className="row wrap" style={{ background: 'var(--warn-bg)', borderRadius: 12, padding: '8px 12px' }}>
              <span className="grow small">ບໍ່ມີຄົນອື່ນທີ່ອະນຸມັດໄດ້ (ເຈົ້າຂອງ ຫຼື ບັນຊີ). ຖ້າບໍ່ຕ້ອງການກວດ 2 ຄົນ ໃຫ້ປິດ ແລ້ວກົດ "ນຳໃຊ້ເລີຍ" — ມີບັນທຶກໃນ Audit log.</span>
              {canDo(me.roles, 'settings.edit') && <button className="btn" onClick={async () => { await hr.save('settings', { ...hr.settings, makerChecker: false, id: hr.settings.companyId }, 'settings-update'); setMsg('ປິດການກວດ 2 ຄົນແລ້ວ — ກົດ "ນຳໃຊ້ເລີຍ" ໄດ້'); }}>ປິດການກວດ 2 ຄົນ</button>}
            </div>)}
        </div>)}
      <div className="card scroll-x"><table className="t"><thead><tr><th>ລະຫັດ</th><th>ຊື່</th><th>ພະແນກ</th><th>ບົດບາດ</th><th className="num">ເງິນເດືອນ</th><th>ຮັບເງິນ</th><th>ໃບໜ້າ</th><th /></tr></thead><tbody>
        {hr.employees.map(e => <tr key={e.id}><td>{e.code}</td><td><b>{e.name}</b> {!isActiveOn(e, today) && <span className="pill">{e.endDate && e.startDate <= today ? `ສິ້ນສຸດ ${e.endDate}` : `ເລີ່ມ ${e.startDate}`}</span>}<div className="muted small">{e.position}</div></td><td>{e.dept}</td><td className="small">{e.roles.map(r => ROLE_NAMES[r]).join(', ')}</td>
          <td className="num">{money(e.baseSalary)}</td><td className="small">{e.payMethod === 'cash' ? 'ເງິນສົດ' : `${e.bankName} ${e.bankAccount ?? ''}`}</td>
          <td>{e.faceEnrolled ? <span className="pill ok">ລົງທະບຽນແລ້ວ · {faceTemplates(e).length} ທ່າ</span> : <span className="pill">ຍັງ</span>}</td>
          <td>{canEdit && !(e.endDate && e.endDate < today) && <button className="btn ghost" onClick={() => { setHire(null); open(e); }}>ແກ້ໄຂ</button>}</td></tr>)}
      </tbody></table></div>
      {edit && (
        <div className="card col" style={{ maxWidth: 480 }}>
          <h2>ແກ້ໄຂ: {edit.name}</h2>
          {prof && <>
            <div className="row wrap">
              <label className="field grow">ຊື່ ແລະ ນາມສະກຸນ<input className="input" value={prof.name} onChange={e => setProf({ ...prof, name: e.target.value })} /></label>
              <label className="field" style={{ width: 110 }}>ລະຫັດ<input className="input" value={prof.code} onChange={e => setProf({ ...prof, code: e.target.value })} /></label></div>
            <div className="row wrap">
              <label className="field grow">ພະແນກ<input className="input" list="dept-list" value={prof.dept} onChange={e => setProf({ ...prof, dept: e.target.value })} /></label>
              <label className="field grow">ຕຳແໜ່ງ<input className="input" value={prof.position} onChange={e => setProf({ ...prof, position: e.target.value })} /></label></div>
            <datalist id="dept-list">{depts.map(d => <option key={d} value={d} />)}</datalist>
            <div className="row wrap">
              <label className="field grow">ສາຂາຫຼັກ<select className="input" value={prof.homeBranchId} onChange={e => setProf({ ...prof, homeBranchId: e.target.value })}>{hr.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              <label className="field grow">ວັນເລີ່ມວຽກ<input className="input" type="date" value={prof.startDate} onChange={e => setProf({ ...prof, startDate: e.target.value })} /></label></div>
            <div className="row wrap">
              <label className="field grow">ເງິນອຸດໜູນ (ກີບ)<input className="input" inputMode="numeric" value={Number.isFinite(prof.allowance) ? prof.allowance : ''} onChange={e => setProf({ ...prof, allowance: e.target.value === '' ? NaN : Number(e.target.value.replace(/\D/g, '')) })} /></label>
              <label className="field grow">ວິທີຮັບເງິນ<select className="input" value={prof.payMethod} onChange={e => setProf({ ...prof, payMethod: e.target.value as Employee['payMethod'] })}><option value="bank">ໂອນທະນາຄານ</option><option value="cash">ເງິນສົດ</option></select></label>
              {prof.payMethod === 'bank' && <label className="field" style={{ width: 120 }}>ທະນາຄານ<input className="input" value={prof.bankName ?? ''} onChange={e => setProf({ ...prof, bankName: e.target.value })} /></label>}</div>
          </>}
          <label className="field">ເງິນເດືອນພື້ນຖານ<input className="input" inputMode="numeric" value={salary} onChange={e => setSalary(e.target.value.replace(/\D/g, ''))} /></label>
          <label className="field">ເລກບັນຊີທະນາຄານ<input className="input" value={acct} onChange={e => setAcct(e.target.value)} /></label>
          <label className="field">ກະປະຈຳ / ເວລາເຂົ້າ-ອອກ<select className="input" value={shiftSel} onChange={e => setShiftSel(e.target.value)}>{sharedShifts(hr.shifts).map(s => <option key={s.id} value={s.id}>{s.name} {shiftRange(s)}</option>)}<option value={CUSTOM}>ກຳນົດເວລາສະເພາະຄົນນີ້…</option></select></label>
          {shiftSel === CUSTOM && (
            <div className="col" style={{ border: '1.5px solid var(--line-2)', borderRadius: 14, padding: 12, gap: 8 }}>
              <span className="muted small">ເວລາເຂົ້າ-ອອກຂອງ {edit.name} ຄົນດຽວ. ຄິດມາຊ້າ, OT ແລະ ລືມລົງເວລາອອກ ຈາກເວລານີ້. ອອກກາຍທ່ຽງຄືນໄດ້ (ເຊັ່ນ 22:00 → 06:00).</span>
              <label className="row" style={{ minHeight: 40 }}><input type="checkbox" checked={!!own.flexible} onChange={e => setOwn({ ...own, flexible: e.target.checked, dailyHours: own.dailyHours ?? 8 })} />ຢືດຢຸ່ນ (ບໍ່ກຳນົດເວລາ, ບໍ່ຄິດມາຊ້າ)</label>
              {own.flexible
                ? <label className="field" style={{ maxWidth: 160 }}>ຊົ່ວໂມງ/ມື້<input className="input" inputMode="decimal" value={Number.isFinite(own.dailyHours) ? own.dailyHours : ''} onChange={e => setOwn({ ...own, dailyHours: e.target.value === '' ? NaN : Number(e.target.value.replace(/[^\d.]/g, '')) })} /></label>
                : <div className="row wrap">{([['start', 'ເຂົ້າ'], ['end', 'ອອກ'], ['breakStart', 'ເລີ່ມພັກ'], ['breakEnd', 'ເສັດພັກ']] as const).map(([k, l]) => (
                  <label key={k} className="field">{l}<input className="input" type="time" value={own[k]} onChange={e => setOwn({ ...own, [k]: e.target.value })} /></label>))}</div>}
            </div>)}
          <fieldset style={{ border: '1.5px solid var(--line-2)', borderRadius: 14, padding: '6px 12px' }}><legend className="small muted">ວັນພັກປະຈຳອາທິດ</legend>
            <div className="row wrap">{['ອາ', 'ຈ', 'ອ', 'ພ', 'ພຫ', 'ສຸ', 'ເສ'].map((d, i) => <label key={d} className="row" style={{ minHeight: 40 }}><input type="checkbox" checked={dayOffSel.includes(i)} onChange={() => setDayOffSel(dayOffSel.includes(i) ? dayOffSel.filter(x => x !== i) : [...dayOffSel, i])} />{d}</label>)}</div></fieldset>
          {canRoles && <fieldset style={{ border: '1.5px solid var(--line-2)', borderRadius: 14, padding: '6px 12px' }}><legend className="small muted">ບົດບາດ (ສະເພາະເຈົ້າຂອງ ກຳນົດໄດ້ · ມີຜົນທັນທີ ແລະ ເກັບໃນ audit log)</legend>
            <div className="row wrap">{(['head', 'accountant', 'owner', 'auditor'] as Role[]).map(r => <label key={r} className="row" style={{ minHeight: 40 }}><input type="checkbox" disabled={edit.id === me.id} checked={rolesSel.includes(r)} onChange={() => setRolesSel(rolesSel.includes(r) ? rolesSel.filter(x => x !== r) : [...rolesSel, r])} />{ROLE_NAMES[r]}</label>)}</div>
            {edit.id === me.id && <span className="muted small">ແກ້ບົດບາດຂອງຕົນເອງບໍ່ໄດ້</span>}</fieldset>}
          {canRoles && rolesSel.includes('head') && <fieldset style={{ border: '1.5px solid var(--line-2)', borderRadius: 14, padding: '6px 12px' }}><legend className="small muted">ຫົວໜ້າດູແລພະແນກ (ອະນຸມັດໄດ້ສະເພາະພະແນກເຫຼົ່ານີ້)</legend>
            <div className="row wrap"><label className="row" style={{ minHeight: 40 }}><input type="checkbox" checked={headSel.includes('*')} onChange={() => setHeadSel(headSel.includes('*') ? [edit.dept] : ['*'])} />ທຸກພະແນກ</label>
              {depts.map(d => <label key={d} className="row" style={{ minHeight: 40 }}><input type="checkbox" disabled={headSel.includes('*')} checked={headSel.includes('*') || headSel.includes(d)} onChange={() => setHeadSel(headSel.includes(d) ? headSel.filter(x => x !== d) : [...headSel, d])} />{d}</label>)}</div></fieldset>}
          <div className="row"><button className="btn ghost" onClick={() => setEdit(null)}>ຍົກເລີກ</button><button className="btn" onClick={submit}>{(changeNeedsSecondPerson(hr.settings) && !hr.approver!.selfOk) ? 'ສົ່ງໃຫ້ອະນຸມັດ' : 'ບັນທຶກ'}</button></div>
          {edit.deviceId && <div className="row wrap"><span className="grow small muted">ຜູກກັບເຄື່ອງແລ້ວ ({edit.deviceBoundAt?.slice(0, 10)}). ລ້າງເພື່ອໃຫ້ເຄື່ອງທຳອິດທີ່ສະແກນ ຖືກຜູກໃໝ່.</span><button className="btn ghost" onClick={async () => { await hr.save('employees', { ...edit, deviceId: undefined, deviceBoundAt: undefined }, 'device-reset'); setMsg(`ລ້າງເຄື່ອງທີ່ຜູກຂອງ ${edit.name} ແລ້ວ`); setEdit(null); }}>ລ້າງເຄື່ອງທີ່ຜູກ</button></div>}
          {!edit.endDate && <fieldset style={{ border: '1.5px solid var(--line-2)', borderRadius: 14, padding: '6px 12px' }}><legend className="small muted">ລາອອກ / ປິດບັນຊີ</legend>
            <div className="row wrap"><label className="field grow">ວັນສຸດທ້າຍຂອງການເຮັດວຽກ<input className="input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></label>
              <button className="btn danger" onClick={submitTerminate}>ປິດບັນຊີ</button></div>
            {(() => {
              const plan = planSettlement(hr, edit, endDate, new Date());
              const days = plan.annualDays + plan.compDays;
              return <>
                <label className="row" style={{ minHeight: 44 }}><input type="checkbox" checked={payout} disabled={!hr.settings.leavePayoutOnExit || plan.amount <= 0} onChange={e => setPayout(e.target.checked)} />
                  ຈ່າຍວັນລາພັກຄ້າງ: {days} ມື້ × {money(plan.dailyRate)} = <b>{money(plan.amount)} ₭</b></label>
                {!hr.settings.leavePayoutOnExit && days > 0 && <span className="muted small">ຕັ້ງຄ່າປິດການຈ່າຍວັນລາພັກຄ້າງໄວ້ ({days} ມື້ບໍ່ຖືກຈ່າຍ)</span>}
                {plan.amount > 0 && !plan.month && <span className="small" style={{ color: 'var(--bad, #c0392b)' }}>ງວດທີ່ກ່ຽວຂ້ອງລັອກແລ້ວ: ຕ້ອງໃສ່ເປັນລາຍການເອງຫຼັງເປີດງວດ</span>}
              </>;
            })()}
            <span className="muted small">ເງິນເດືອນເດືອນສຸດທ້າຍຄິດຕາມສັດສ່ວນວັນ · ປະຫວັດການລົງເວລາຍັງຢູ່ຄົບ · ຍອດວັນລາພັກຄ້າງເປັນລາຍການ "ອື່ນໆ" ທີ່ຜ່ານການກວດ 2 ຄົນ</span></fieldset>}
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
          <label className="field">ກະປະຈຳ<select className="input" value={hire.shiftId} onChange={e => setH({ shiftId: e.target.value })}>{sharedShifts(hr.shifts).map(s => <option key={s.id} value={s.id}>{s.name} {shiftRange(s)}</option>)}</select></label>
          <label className="field">ເງິນເດືອນພື້ນຖານ<input className="input" inputMode="numeric" value={hire.baseSalary || ''} onChange={e => setH({ baseSalary: Number(e.target.value.replace(/\D/g, '')) })} /></label>
          <label className="field">ເບ້ຍລ້ຽງ<input className="input" inputMode="numeric" value={hire.allowance || ''} onChange={e => setH({ allowance: Number(e.target.value.replace(/\D/g, '')) })} /></label>
          <label className="field">ຮັບເງິນ<select className="input" value={hire.payMethod} onChange={e => setH({ payMethod: e.target.value as Employee['payMethod'] })}><option value="bank">ໂອນທະນາຄານ</option><option value="cash">ເງິນສົດ</option></select></label>
          {hire.payMethod === 'bank' && <>
            <label className="field">ທະນາຄານ<select className="input" value={hire.bankName} onChange={e => setH({ bankName: e.target.value })}>{['LDB', 'JDB', 'ST Bank'].map(b => <option key={b}>{b}</option>)}</select></label>
            <label className="field">ເລກບັນຊີ<input className="input" value={hire.bankAccount ?? ''} onChange={e => setH({ bankAccount: e.target.value })} /></label></>}
          <span className="muted small">ບົດບາດເລີ່ມຕົ້ນເປັນ "ພະນັກງານ" ເທົ່ານັ້ນ — ເຈົ້າຂອງກຳນົດບົດບາດອື່ນພາຍຫຼັງ</span>
          <div className="row"><button className="btn ghost" onClick={() => setHire(null)}>ຍົກເລີກ</button><button className="btn" onClick={submitHire}>{(changeNeedsSecondPerson(hr.settings) && !hr.approver!.selfOk) ? 'ສົ່ງໃຫ້ອະນຸມັດ' : 'ບັນທຶກ'}</button></div>
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
  const [slipOf, setSlipOf] = useState<PayslipData | null>(null);
  const blankItem = { employeeId: '', kind: 'bonus' as PayItemKind, label: '', amount: '', base: '', rate: '', taxable: true };
  const [pi, setPi] = useState<typeof blankItem | null>(null);
  const [piMsg, setPiMsg] = useState('');
  const [exporting, setExporting] = useState(false);
  const staff = hr.employees.filter(e => e.baseSalary > 0 && (employedFraction(e, now.getFullYear(), now.getMonth()) > 0 || (hr.payItems ?? []).some(i => i.employeeId === e.id && i.month === key && i.status === 'approved')));
  const rows = staff.map(e => summarize(hr, e, key, run.lateConfirmed.includes(e.id)));
  const total = rows.reduce((a, r) => a + r.slip.net, 0);
  const locked = run.status === 'locked';
  const canPrepare = canDo(me.roles, 'payroll.prepare');
  const canLock = canDo(me.roles, 'payroll.lock');
  const canConfirmLate = canDo(me.roles, 'payroll.confirmLate');
  const itemsGate = featureBlock(hr.company, 'payItems', ymd(now));
  const canItems = canDo(me.roles, 'payroll.items') && !locked;
  const canDecideItems = canDo(me.roles, 'payroll.items.decide') && !locked;
  const monthItems = (hr.payItems ?? []).filter(i => i.month === key);
  const piAmount = pi ? (pi.kind === 'commission' && pi.base && pi.rate ? commissionAmount(Number(pi.base), Number(pi.rate)) : Number(pi.amount.replace(/\D/g, ''))) : 0;
  const addItem = async () => {
    if (!pi) return;
    if (itemsGate) return setPiMsg(itemsGate);
    const target = hr.employees.find(e => e.id === pi.employeeId);
    const item: PayItem = {
      id: uid(), companyId: me.companyId, employeeId: pi.employeeId, month: key, kind: pi.kind, label: pi.label.trim(), amount: piAmount, taxable: pi.taxable,
      ...(pi.kind === 'commission' && pi.base && pi.rate ? { salesBase: Number(pi.base), ratePct: Number(pi.rate) } : {}),
      status: initialPayItemStatus({ makerChecker: hr.settings.makerChecker && !hr.approver!.selfOk }), by: me.id, createdAt: new Date().toISOString()
    };
    const errs = validatePayItem(item, { employeeExists: !!target, employedInMonth: !!target && employedFraction(target, now.getFullYear(), now.getMonth()) > 0, periodLocked: locked });
    if (errs.length) return setPiMsg(errs.join(' · '));
    await hr.save('payItems', item, 'pay-item-add');
    setPiMsg(item.status === 'pending' ? 'ສົ່ງໃຫ້ອີກຄົນອະນຸມັດແລ້ວ (ກວດ 2 ຄົນ)' : 'ບັນທຶກແລ້ວ');
    setPi(null);
  };
  const decideItem = async (item: PayItem, ok: boolean) => {
    const block = payItemDecisionBlock(item, me.id, { makerChecker: hr.settings.makerChecker && !hr.approver!.selfOk });
    if (block || !canDecideItems) return setPiMsg(block ?? 'ບໍ່ມີສິດອະນຸມັດ');
    await hr.save('payItems', { ...item, status: ok ? 'approved' : 'rejected', approvedBy: me.id }, ok ? 'pay-item-approve' : 'pay-item-reject');
    setPiMsg('');
  };

  const toggleLate = (id: string) => hr.save('payrollRuns', { ...run, lateConfirmed: run.lateConfirmed.includes(id) ? run.lateConfirmed.filter(x => x !== id) : [...run.lateConfirmed, id] }, 'late-confirm');
  const prepare = () => hr.save('payrollRuns', { ...run, status: 'prepared', preparedBy: me.id }, 'payroll-prepare');
  const lock = async () => {
    const block = payrollLockBlock(run.preparedBy, me.id, { makerChecker: hr.settings.makerChecker && !hr.approver!.selfOk }) ?? pendingPayItemsBlock(hr.payItems ?? [], key); if (block) return setMsg(block);
    await hr.save('payrollRuns', { ...run, status: 'locked', approvedBy: me.id, slips: Object.fromEntries(rows.map(r => [r.employee.id, r.slip.net])) }, 'payroll-lock');
    // advances are settled only when the period is locked
    for (const r of rows) for (const a of hr.advances.filter(a => a.employeeId === r.employee.id && a.status === 'approved' && a.remaining > 0)) {
      await hr.save('advances', { ...a, remaining: Math.max(0, a.remaining - Math.ceil(a.amount / a.installments)) }, 'advance-deduct');
    }
  };
  const exportXlsx = async () => {
    const gate = featureBlock(hr.company, 'excelExport', ymd(new Date()));
    if (gate) return setMsg(gate);
    setExporting(true);
    try { const r = await exportPayrollXlsx(hr, rows, key, run); setMsg(`ດາວໂຫຼດແລ້ວ: ${r.fileName} (${r.employees} ຄົນ)`); }
    catch (e: any) { setMsg('Export ບໍ່ສຳເລັດ: ' + (e?.message || 'ລອງໃໝ່')); }
    finally { setExporting(false); }
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
        <button className="btn ghost" disabled={exporting} onClick={exportXlsx}>Export Excel</button>
        <button className="btn ghost" onClick={exportBank}>Export ໂອນທະນາຄານ</button>
        <button className="btn ghost" onClick={exportCash}>Export ເງິນສົດ</button>
        {canPrepare && run.status === 'draft' && <button className="btn" onClick={prepare}>ກະກຽມ & ສົ່ງອະນຸມັດ</button>}
        {canLock && run.status === 'prepared' && <button className="btn" onClick={lock}>ອະນຸມັດ & ລັອກງວດ</button>}
      </div>
      {msg && <div className="error" role="alert">{msg}</div>}
      <div className="card col"><div className="row wrap"><h2 className="grow">ໂບນັດ / ຄອມມິດຊັນ / ອື່ນໆ ຂອງເດືອນນີ້</h2>{canItems && !pi && <button className="btn ghost" onClick={() => itemsGate ? setPiMsg(itemsGate) : setPi({ ...blankItem, employeeId: staff[0]?.id ?? '' })}>+ ເພີ່ມລາຍການ</button>}</div>
        {piMsg && <span className="pill info" style={{ alignSelf: 'flex-start', height: 'auto', padding: '6px 12px' }}>{piMsg}</span>}
        {monthItems.length === 0 && !pi && <span className="muted small">ຍັງບໍ່ມີ. ເບ້ຍລ້ຽງຕາມກະ (ຕັ້ງໃນ ຕັ້ງຄ່າ → ກະວຽກ) ຖືກຄິດໃຫ້ເອງຈາກກະທີ່ເຮັດ.</span>}
        {monthItems.map(i => (
          <div key={i.id} className="row wrap"><span className="grow"><b>{nameOf(hr.employees, i.employeeId)}</b> · {PAY_ITEM_LABEL[i.kind]}: {i.label} · {money(i.amount)} ₭{i.taxable ? '' : ' (ບໍ່ເສຍພາສີ)'}{i.salesBase ? ` · ${money(i.salesBase)} × ${i.ratePct}%` : ''} · ໂດຍ {nameOf(hr.employees, i.by)}</span>
            {i.status === 'pending' ? (canDecideItems && (i.by !== me.id || !(changeNeedsSecondPerson(hr.settings) && !hr.approver!.selfOk)) ? <><button className="btn danger" onClick={() => decideItem(i, false)}>ປະຕິເສດ</button><button className="btn" onClick={() => decideItem(i, true)}>ອະນຸມັດ</button></> : <span className="muted small">ລໍຄົນອື່ນອະນຸມັດ</span>)
              : <span className={`pill ${i.status === 'approved' ? 'ok' : 'bad'}`}>{i.status === 'approved' ? 'ອະນຸມັດ' : 'ປະຕິເສດ'}</span>}</div>))}
        {pi && (
          <div className="col" style={{ border: '1.5px solid var(--line-2)', borderRadius: 14, padding: 12 }}>
            <label className="field">ພະນັກງານ<select className="input" value={pi.employeeId} onChange={e => setPi({ ...pi, employeeId: e.target.value })}>{staff.map(e => <option key={e.id} value={e.id}>{e.name} · {e.code}</option>)}</select></label>
            <div className="row wrap">{(['bonus', 'commission', 'other'] as PayItemKind[]).map(k => <button key={k} className={`btn ${pi.kind === k ? '' : 'ghost'}`} aria-pressed={pi.kind === k} onClick={() => setPi({ ...pi, kind: k })}>{PAY_ITEM_LABEL[k]}</button>)}</div>
            <label className="field">ຊື່ລາຍການ<input className="input" value={pi.label} onChange={e => setPi({ ...pi, label: e.target.value })} placeholder="ເຊັ່ນ: ໂບນັດປີໃໝ່ / ຄອມຍອດຂາຍ" /></label>
            {pi.kind === 'commission' && <div className="row wrap"><label className="field grow">ຍອດຂາຍ (ກີບ)<input className="input" inputMode="numeric" value={pi.base} onChange={e => setPi({ ...pi, base: e.target.value.replace(/\D/g, '') })} /></label>
              <label className="field" style={{ width: 110 }}>ຄອມ %<input className="input" inputMode="decimal" value={pi.rate} onChange={e => setPi({ ...pi, rate: e.target.value.replace(/[^\d.]/g, '') })} /></label></div>}
            {pi.kind === 'commission' && pi.base && pi.rate
              ? <span className="muted small">ຈຳນວນເງິນ = {money(piAmount)} ₭ (ຄິດໃຫ້ອັດຕະໂນມັດ)</span>
              : <label className="field">ຈຳນວນເງິນ (ກີບ)<input className="input" inputMode="numeric" value={pi.amount} onChange={e => setPi({ ...pi, amount: e.target.value.replace(/\D/g, '') })} /></label>}
            <label className="row" style={{ minHeight: 40 }}><input type="checkbox" checked={pi.taxable} onChange={e => setPi({ ...pi, taxable: e.target.checked })} />ຄິດອາກອນ (ເອົາໄປລວມລາຍໄດ້)</label>
            <div className="row"><button className="btn ghost" onClick={() => setPi(null)}>ຍົກເລີກ</button><button className="btn" onClick={addItem}>{hr.settings.makerChecker ? 'ສົ່ງໃຫ້ອະນຸມັດ' : 'ບັນທຶກ'}</button></div>
          </div>)}
      </div>
      <div className="grid"><div className="card dark"><span className="small" style={{ color: '#9fd8d4' }}>ຈ່າຍສຸດທິ · {rows.length} ຄົນ</span><div className="big-num">{money(total)} ₭</div></div>
        <div className="card"><span className="muted small">ປະກັນສັງຄົມ {hr.settings.ssRate * 100}%</span><div className="big-num">{money(rows.reduce((a, r) => a + r.slip.socialSecurity, 0))}</div></div>
        <div className="card"><span className="muted small">ອາກອນ</span><div className="big-num">{money(rows.reduce((a, r) => a + r.slip.tax, 0))}</div></div></div>
      <div className="card scroll-x"><table className="t"><thead><tr><th>ພະນັກງານ</th><th className="num">ພື້ນຖານ</th><th className="num">OT</th><th>ມາຊ້າ (ຢືນຢັນ?)</th><th className="num">ປະກັນ</th><th className="num">ອາກອນ</th><th className="num">ເບີກ</th><th className="num">ສຸດທິ</th><th /></tr></thead><tbody>
        {rows.map(r => <tr key={r.employee.id}><td><b>{r.employee.name}</b><div className="muted small">{r.employee.payMethod === 'cash' ? 'ເງິນສົດ' : r.employee.bankName}</div></td>
          <td className="num">{money(r.slip.base)}</td><td className="num">{money(r.slip.ot)}</td>
          <td>{r.lateMin ? <label className="row small"><input type="checkbox" disabled={locked || !canConfirmLate} checked={r.lateConfirmed} onChange={() => toggleLate(r.employee.id)} />{r.lateMin} ນທ → −{money(r.lateMin * hr.settings.lateDeductPerMinute)}</label> : '—'}</td>
          <td className="num">{money(r.slip.socialSecurity)}</td><td className="num">{money(r.slip.tax)}</td><td className="num">{money(r.slip.advance)}</td><td className="num"><b>{money(r.slip.net)}</b></td><td><button className="btn ghost" onClick={() => setSlipOf(r)}>ສະລິບ</button></td></tr>)}
      </tbody></table></div>
      {slipOf && <PayslipView data={slipOf} monthLabel={laoMonth(now.getFullYear(), now.getMonth())} final={locked} onClose={() => setSlipOf(null)} />}
      {locked && <div className="muted small">ງວດນີ້ລັອກແລ້ວ: ການແກ້ໄຂທີ່ພົບພາຍຫຼັງ ຈະເປັນລາຍການປັບໃນເດືອນຖັດໄປ.</div>}
    </>
  );
}

type RuleTab = 'summary' | RulesTab | 'plan' | 'backup' | 'history';
const RULE_TABS: [RuleTab, string][] = [['summary', 'ສະຫຼຸບກົດເກນ'], ['places', 'ສາຂາ & GPS'], ['shifts', 'ກະວຽກ'], ['time', 'ເວລາ & ສະແກນ'], ['leave', 'ລາພັກ & ອະນຸມັດ'], ['holidays', 'ວັນພັກ'], ['pay', 'ເງິນເດືອນ & ອາກອນ'], ['plan', 'ແພັກເກັດ'], ['backup', 'ສຳຮອງຂໍ້ມູນ'], ['history', 'ປະຫວັດການແກ້']];
const EDIT_TABS: RuleTab[] = ['places', 'shifts', 'time', 'leave', 'holidays', 'pay'];
const RULE_ACTIONS = ['settings-update', 'shift-update', 'shift-delete', 'branch-radius', 'branch-gps', 'branch-add', 'branch-edit', 'branch-delete'];

function SettingsPage({ readOnly }: { readOnly: boolean }) {
  const hr = useHR();
  const me = hr.me!;
  const [s, setS] = useState<Settings>(hr.settings);
  const [radii, setRadii] = useState<Record<string, number>>(() => Object.fromEntries(hr.branches.map(b => [b.id, b.radiusM])));
  const [shiftRows, setShiftRows] = useState<Shift[]>(hr.shifts);
  const [newHoliday, setNewHoliday] = useState('');
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<RuleTab>('summary');
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  useEffect(() => { if (tab === 'history') hr.store.audit().then(r => setAudit([...r].reverse())); }, [tab, hr.store, hr.settings, hr.shifts, hr.branches]); // eslint-disable-line react-hooks/exhaustive-deps
  const [nb, setNb] = useState<{ name: string; lat: string; lng: string; radiusM: string } | null>(null);
  const nbBranch = (): Branch | null => (nb ? { id: 'b-' + uid().slice(0, 8), companyId: me.companyId, name: nb.name.trim(), lat: nb.lat.trim() === '' ? NaN : Number(nb.lat), lng: nb.lng.trim() === '' ? NaN : Number(nb.lng), radiusM: nb.radiusM.trim() === '' ? NaN : Number(nb.radiusM) } : null);
  const nbErrors = (() => { const b = nbBranch(); return b ? [...validateBranch(b, hr.branches), ...asList(branchBlock(hr.company, hr.branches.length, ymd(new Date())))] : []; })();
  const fillHere = async () => {
    const p = await getPosition();
    if (!p) return setMsg('ອ່ານ GPS ບໍ່ໄດ້ (ກວດສິດຕຳແໜ່ງ) — ໃສ່ພິກັດເອງໄດ້');
    setNb(v => (v ? { ...v, lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) } : v));
    setMsg(`ໃຊ້ຕຳແໜ່ງນີ້ (±${Math.round(p.accuracyM)} ມ.)`);
  };
  const addBranch = async () => {
    const b = nbBranch();
    if (!b || !canDo(me.roles, 'settings.edit')) return;
    const errs = [...validateBranch(b, hr.branches), ...asList(branchBlock(hr.company, hr.branches.length, ymd(new Date())))];
    if (errs.length) return setMsg(errs.join(' · '));
    await hr.save('branches', b, 'branch-add');
    setMsg(`ເພີ່ມສາຂາ ${b.name} ແລ້ວ`);
    setNb(null);
  };
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
  const num = (k: keyof Settings, label: string, step = 1, scale = 1, hint = '') => (
    <label className="field">{label}{hint && <span className="muted small" style={{ fontWeight: 400 }}>{hint}</span>}<input className="input" type="number" step={step} disabled={readOnly} value={shown(Number(s[k]), scale)}
      onChange={e => setS({ ...s, [k]: e.target.value === '' ? NaN : Number(e.target.value) / scale })} /></label>);
  const setBracket = (i: number, patch: Partial<TaxBracket>) => setS({ ...s, taxBrackets: s.taxBrackets.map((b, j) => j === i ? { ...b, ...patch } : b) });
  const toggleRole = (r: Role) => setS({ ...s, leaveApproverRoles: s.leaveApproverRoles.includes(r) ? s.leaveApproverRoles.filter(x => x !== r) : [...s.leaveApproverRoles, r] });
  const addHoliday = () => {
    if (!newHoliday || s.holidays.includes(newHoliday)) return;
    setS({ ...s, holidays: [...s.holidays, newHoliday].sort() });
    setNewHoliday('');
  };
  const [bEdit, setBEdit] = useState<{ id: string; name: string; lat: string; lng: string } | null>(null);
  const saveBranch = async () => {
    if (!bEdit) return;
    const b = hr.branches.find(x => x.id === bEdit.id)!;
    const next = { ...b, name: bEdit.name.trim(), lat: bEdit.lat.trim() === '' ? NaN : Number(bEdit.lat), lng: bEdit.lng.trim() === '' ? NaN : Number(bEdit.lng) };
    const errs = validateBranch({ ...next, radiusM: radii[b.id] }, hr.branches);
    if (errs.length) return setMsg(errs.join(' · '));
    await hr.save('branches', next, 'branch-edit');
    setMsg(`ບັນທຶກສາຂາ ${next.name} ແລ້ວ`);
    setBEdit(null);
  };
  const removeBranch = async (b: Branch) => {
    const block = branchDeleteBlock(b, { branches: hr.branches, employees: hr.employees, scans: hr.scans });
    if (block) return setMsg(`ລຶບສາຂາ "${b.name}" ບໍ່ໄດ້: ${block}`);
    if (!confirm(`ລຶບສາຂາ "${b.name}" ຖາວອນ?`)) return;
    await hr.remove('branches', b.id, 'branch-delete');
    setRadii(({ [b.id]: _x, ...rest }) => rest);
    setMsg(`ລຶບສາຂາ "${b.name}" ແລ້ວ`);
  };
  const useHere = async (branchId: string) => {
    if (!canDo(me.roles, 'settings.edit')) return;
    const p = await getPosition();
    if (!p) return setMsg('ອ່ານ GPS ບໍ່ໄດ້ (ກວດສິດຕຳແໜ່ງ)');
    const b = hr.branches.find(x => x.id === branchId)!;
    await hr.save('branches', { ...b, lat: p.lat, lng: p.lng }, 'branch-gps');
    setMsg(`ຕັ້ງ ${b.name} = ຕຳແໜ່ງນີ້ແລ້ວ (±${Math.round(p.accuracyM)} ມ.)`);
  };
  const removeShift = async (sh: Shift) => {
    const saved = hr.shifts.find(x => x.id === sh.id);
    if (!saved) return setShiftRows(rows => rows.filter(r => r.id !== sh.id)); // never saved: just drop the row
    const block = shiftDeleteBlock(saved, { shifts: hr.shifts, employees: hr.employees, overrides: hr.overrides, requests: hr.requests });
    if (block) return setMsg(`ລຶບກະ "${sh.name || '—'}" ບໍ່ໄດ້: ${block}`);
    if (!confirm(`ລຶບກະ "${saved.name}" ຖາວອນ? ການລຶບມີບັນທຶກໃນ Audit log.`)) return;
    await hr.remove('shifts', saved.id, 'shift-delete');
    setShiftRows(rows => rows.filter(r => r.id !== sh.id));
    setMsg(`ລຶບກະ "${saved.name}" ແລ້ວ`);
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
      <div className="col" style={{ gap: 0 }}><span className="muted">{readOnly ? 'ເບິ່ງໄດ້ຢ່າງດຽວ' : 'ແກ້ໄຂແລ້ວກົດ "ບັນທຶກ" ທີ່ລຸ່ມສຸດ · ທຸກການແກ້ມີບັນທຶກປະຫວັດ'}</span><h1>ກົດເກນບໍລິສັດ & ຕັ້ງຄ່າ</h1></div>
      <div className="tabs" role="tablist" style={{ alignSelf: 'flex-start' }}>
        {RULE_TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {tab === 'summary' && <>
        <div className="muted small">ກົດເກນທີ່ໃຊ້ຢູ່ຕອນນີ້ (ທີ່ບັນທຶກແລ້ວ) ອ່ານເປັນປະໂຫຍກ</div>
        {rulesSummary(hr.settings, sharedShifts(hr.shifts), hr.branches).map(sec => (
          <div key={sec.title} className="card col">
            <div className="row"><h2 className="grow">{sec.title}</h2><button className="btn ghost" onClick={() => setTab(sec.tab)}>{readOnly ? 'ເບິ່ງ' : 'ແກ້ໄຂ'} ›</button></div>
            {sec.lines.map(l => <span key={l}>• {l}</span>)}
          </div>))}
      </>}
      {tab === 'plan' && <PlanCard />}
      {tab === 'backup' && <BackupCard readOnly={readOnly} />}
      {tab === 'history' && (() => {
        const rows = audit.filter(a => RULE_ACTIONS.includes(a.action)).map(a => ({
          a,
          lines: a.entity === 'settings' ? ruleChanges(a.before as Partial<Settings>, a.after as Partial<Settings>).map(c => `${c.label}: ${c.from} → ${c.to}`)
            : recordChanges(a.entity === 'shifts' ? 'shift' : 'branch', a.before as Record<string, unknown> | undefined, a.after as Record<string, unknown> | undefined)
        })).filter(r => r.lines.length).slice(0, 100);
        return (
          <div className="card col"><h2>ປະຫວັດການແກ້ກົດເກນ</h2>
            <span className="muted small">ໃຜແກ້ຫຍັງ ເມື່ອໃດ (ກົດເກນ, ກະ, ສາຂາ). ລຶບ ຫຼື ແກ້ປະຫວັດບໍ່ໄດ້.</span>
            {rows.length === 0 && <div className="empty">ຍັງບໍ່ມີການແກ້ກົດເກນ</div>}
            {rows.map(({ a, lines }) => (
              <div key={a.id} className="col" style={{ gap: 2, borderTop: '1px solid var(--line-2)', paddingTop: 8 }}>
                <div className="row"><b className="grow">{nameOf(hr.employees, a.by)}</b><span className="muted small">{ymd(new Date(a.at))} {new Date(a.at).toTimeString().slice(0, 5)}</span></div>
                {lines.map(l => <span key={l} className="small">{l}</span>)}
              </div>))}
          </div>);
      })()}
      {msg && <div className="pill info" role="status" style={{ alignSelf: 'flex-start', height: 'auto', padding: '6px 12px' }}>{msg}</div>}
      {tab === 'places' && <div className="card col"><h2>ສາຂາ & GPS</h2>
        <span className="muted small">ພະນັກງານລົງເວລາໄດ້ເມື່ອຢູ່ໃນລັດສະໝີຂອງສາຂາ. ຢືນຢູ່ສາຂາແລ້ວກົດ 'ໃຊ້ຕຳແໜ່ງຂ້ອຍຕອນນີ້' ເພື່ອຕັ້ງຈຸດໃຫ້ຖືກ.</span>
        {hr.branches.map(b => <div key={b.id} className="row wrap"><b className="grow">{b.name}</b><span className="muted small">{b.lat.toFixed(5)}, {b.lng.toFixed(5)}</span>
          <label className="row small">ລັດສະໝີ (ມ.)<input className="input" style={{ width: 90 }} type="number" disabled={readOnly} value={Number.isFinite(radii[b.id]) ? radii[b.id] : ''} aria-label={`ລັດສະໝີ ${b.name}`}
            onChange={e => setRadii({ ...radii, [b.id]: e.target.value === '' ? NaN : Number(e.target.value) })} /></label>
          {!readOnly && <button className="btn ghost" onClick={() => useHere(b.id)}>ໃຊ້ຕຳແໜ່ງຂ້ອຍຕອນນີ້</button>}
          {!readOnly && <button className="btn ghost" onClick={() => setBEdit({ id: b.id, name: b.name, lat: String(b.lat), lng: String(b.lng) })}>ແກ້ຊື່ / ພິກັດ</button>}
          {!readOnly && <button className="btn danger" aria-label={`ລຶບສາຂາ ${b.name}`} onClick={() => removeBranch(b)}>🗑 ລຶບ</button>}
          {bEdit?.id === b.id && (
            <div className="col" style={{ width: '100%', border: '1.5px solid var(--line-2)', borderRadius: 14, padding: 12 }}>
              <label className="field">ຊື່ສາຂາ<input className="input" value={bEdit.name} onChange={e => setBEdit({ ...bEdit, name: e.target.value })} /></label>
              <div className="row wrap"><label className="field grow">ລະຕິຈູດ (lat)<input className="input" inputMode="decimal" value={bEdit.lat} onChange={e => setBEdit({ ...bEdit, lat: e.target.value })} /></label>
                <label className="field grow">ລອງຈິຈູດ (lng)<input className="input" inputMode="decimal" value={bEdit.lng} onChange={e => setBEdit({ ...bEdit, lng: e.target.value })} /></label></div>
              <div className="row"><button className="btn ghost" onClick={() => setBEdit(null)}>ຍົກເລີກ</button><button className="btn" onClick={saveBranch}>ບັນທຶກສາຂາ</button></div>
            </div>)}</div>)}
        {!readOnly && !nb && <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setNb({ name: '', lat: '', lng: '', radiusM: '100' })}>+ ເພີ່ມສາຂາ</button>}
        {!readOnly && nb && (
          <div className="col" style={{ border: '1.5px solid var(--line-2)', borderRadius: 14, padding: 12 }}>
            <b>ສາຂາໃໝ່</b>
            <label className="field">ຊື່ສາຂາ<input className="input" value={nb.name} onChange={e => setNb({ ...nb, name: e.target.value })} /></label>
            <div className="row wrap">
              <label className="field grow">ລະຕິຈູດ (lat)<input className="input" inputMode="decimal" value={nb.lat} onChange={e => setNb({ ...nb, lat: e.target.value })} /></label>
              <label className="field grow">ລອງຈິຈູດ (lng)<input className="input" inputMode="decimal" value={nb.lng} onChange={e => setNb({ ...nb, lng: e.target.value })} /></label>
              <label className="field" style={{ width: 110 }}>ລັດສະໝີ (ມ.)<input className="input" inputMode="numeric" value={nb.radiusM} onChange={e => setNb({ ...nb, radiusM: e.target.value })} /></label></div>
            <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={fillHere}>ໃຊ້ຕຳແໜ່ງຂ້ອຍຕອນນີ້</button>
            {nbErrors.length > 0 && (nb.name || nb.lat || nb.lng) && <span className="small" style={{ color: 'var(--bad, #c0392b)' }}>{nbErrors.join(' · ')}</span>}
            <div className="row"><button className="btn ghost" onClick={() => setNb(null)}>ຍົກເລີກ</button><button className="btn" disabled={nbErrors.length > 0} onClick={addBranch}>ເພີ່ມສາຂາ</button></div>
          </div>)}
      </div>}
      {tab === 'shifts' && <div className="card col"><h2>ກະວຽກ</h2>
        <span className="muted small">ເວລາເລີ່ມຂອງກະ ໃຊ້ຄິດມາຊ້າ. ການປ່ຽນມີຜົນກັບການຄິດມາຊ້າທັງໝົດທີ່ຍັງບໍ່ລັອກງວດ. ກະຂ້າມຄືນ: ໃສ່ເວລາເລີກນ້ອຍກວ່າເວລາເລີ່ມ (ເຊັ່ນ 22:00 → 06:00) ການລົງເວລາຫຼັງທ່ຽງຄືນຈະນັບເປັນມື້ທີ່ເລີ່ມກະ. ກະຢືດຢຸ່ນ: ເຂົ້າ-ອອກເວລາໃດກໍໄດ້ ບໍ່ຄິດມາຊ້າ</span>
        {hr.shifts.some(s => s.personal) && <span className="muted small">ມີ {hr.shifts.filter(s => s.personal && hr.employees.some(e => e.shiftId === s.id)).length} ຄົນ ທີ່ໃຊ້ເວລາເຂົ້າ-ອອກສະເພາະຕົວ (ແກ້ໃນ ພະນັກງານ → ແກ້ໄຂ).</span>}
        {shiftRows.filter(sh => !sh.personal).map(sh => (
          <div key={sh.id} className="row wrap" style={{ alignItems: 'flex-end' }}>
            <label className="field grow" style={{ minWidth: 120 }}>ຊື່ກະ<input className="input" disabled={readOnly} value={sh.name} onChange={e => setShift(sh.id, { name: e.target.value })} /></label>
            <label className="row" style={{ minHeight: 48 }}><input type="checkbox" disabled={readOnly} checked={!!sh.flexible} aria-label={`${sh.name} ຢືດຢຸ່ນ`} onChange={e => setShift(sh.id, { flexible: e.target.checked, dailyHours: sh.dailyHours ?? 8 })} />ຢືດຢຸ່ນ (ບໍ່ກຳນົດເວລາ)</label>
            {sh.flexible
              ? <label className="field" style={{ width: 130 }}>ຊົ່ວໂມງ/ມື້<input className="input" inputMode="decimal" disabled={readOnly} value={Number.isFinite(sh.dailyHours) ? sh.dailyHours : ''} aria-label={`${sh.name} ຊົ່ວໂມງຕໍ່ມື້`} onChange={e => setShift(sh.id, { dailyHours: e.target.value === '' ? NaN : Number(e.target.value.replace(/[^\d.]/g, '')) })} /></label>
              : ([['start', 'ເລີ່ມ'], ['end', 'ເລີກ'], ['breakStart', 'ເລີ່ມພັກ'], ['breakEnd', 'ເສັດພັກ']] as const).map(([k, l]) => (
                <label key={k} className="field">{l}<input className="input" type="time" disabled={readOnly} value={sh[k]} aria-label={`${sh.name} ${l}`} onChange={e => setShift(sh.id, { [k]: e.target.value })} /></label>))}
            <label className="field" style={{ width: 130 }}>ເບ້ຍລ້ຽງ/ກະ (ກີບ)<input className="input" inputMode="numeric" disabled={readOnly} value={sh.allowance ?? ''} aria-label={`${sh.name} ເບ້ຍລ້ຽງຕໍ່ກະ`} onChange={e => setShift(sh.id, { allowance: e.target.value === '' ? undefined : Number(e.target.value.replace(/\D/g, '')) })} /></label>
            {!readOnly && <button className="btn danger" aria-label={`ລຶບກະ ${sh.name}`} title="ລຶບກະນີ້" onClick={() => removeShift(sh)} style={{ minHeight: 48 }}>🗑 ລຶບ</button>}
          </div>))}
        {!readOnly && <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShiftRows(rows => [...rows, { id: 'sh-' + uid().slice(0, 6), name: '', start: '22:00', end: '06:00', breakStart: '01:00', breakEnd: '01:30' }])}>+ ເພີ່ມກະ</button>}
        {!readOnly && <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShiftRows(rows => [...rows, { id: 'sh-' + uid().slice(0, 6), name: '', start: '08:00', end: '17:00', breakStart: '12:00', breakEnd: '13:00', flexible: true, dailyHours: 8 }])}>+ ເພີ່ມກະຢືດຢຸ່ນ (ອອຟຟິດ)</button>}
      </div>}
      {tab === 'time' && <div className="card col"><h2>ເວລາ & ສະແກນ</h2><div className="grid">
        {num('graceMinutes', RULE_LABEL.graceMinutes, 1, 1, 'ມາຊ້າບໍ່ເກີນນີ້ ບໍ່ນັບວ່າມາຊ້າ; ເກີນແລ້ວນັບຕັ້ງແຕ່ເວລາເລີ່ມກະ')}{num('lateDeductPerMinute', RULE_LABEL.lateDeductPerMinute, 100, 1, 'ຫັກຕໍ່ນາທີທີ່ມາຊ້າ')}{num('otRate', RULE_LABEL.otRate, 0.1, 1, 'ຄູນກັບຄ່າແຮງຕໍ່ຊົ່ວໂມງ (1.5 = ເຖິງເຄິ່ງ)')}
        {num('faceMinScore', RULE_LABEL.faceMinScore, 1, 1, 'ຕ່ຳກວ່ານີ້ → ລໍຫົວໜ້າກວດ. ຖ້າພະນັກງານສະແກນບໍ່ຕິດຫຼາຍ ລອງລົດລົງເທື່ອລະ 5')}{num('maxClockSkewMin', RULE_LABEL.maxClockSkewMin, 1, 1, 'ໂມງໂທລະສັບຜິດຈາກເຊີບເວີເກີນນີ້ → ລໍກວດ')}{num('randomSamplePerDay', RULE_LABEL.randomSamplePerDay, 1, 1, 'ລາຍການທີ່ຜ່ານແລ້ວ ແຕ່ສຸ່ມໃຫ້ຫົວໜ້າກວດຊ້ຳ')}{num('photoRetentionDays', RULE_LABEL.photoRetentionDays, 1, 1, 'ຮູບສະແກນຖືກລຶບເອງຫຼັງຈາກນີ້')}
      </div></div>}
      {tab === 'leave' && <div className="card col"><h2>ລາພັກ & ອະນຸມັດ</h2><div className="grid">
        {num('leaveDaysPerYear', RULE_LABEL.leaveDaysPerYear)}{num('leaveCarryOverMax', RULE_LABEL.leaveCarryOverMax, 1, 1, 'ມື້ທີ່ເຫຼືອຍົກໄປປີໜ້າໄດ້ບໍ່ເກີນນີ້')}{num('compLeaveExpiryDays', RULE_LABEL.compLeaveExpiryDays + ' (0 = ບໍ່ໝົດ)', 1, 1, 'ນັບຈາກວັນຫຍຸດທີ່ມາເຮັດວຽກ')}
        <label className="row" style={{ minHeight: 48 }}><input type="checkbox" disabled={readOnly} checked={s.leavePayoutOnExit} onChange={e => setS({ ...s, leavePayoutOnExit: e.target.checked })} />{RULE_LABEL.leavePayoutOnExit}</label>{num('escalateAfterHours', RULE_LABEL.escalateAfterHours, 1, 1, 'ຄຳຂໍທີ່ຄ້າງນານກວ່ານີ້ ເຈົ້າຂອງອະນຸມັດແທນໄດ້')}
        <label className="field">ວິທີໄດ້ສິດລາ<select className="input" disabled={readOnly} value={s.leaveAccrual} onChange={e => setS({ ...s, leaveAccrual: e.target.value as Settings['leaveAccrual'] })}>
          <option value="monthly">ສະສົມເປັນເດືອນ</option><option value="yearStart">ໄດ້ເຕັມຕົ້ນປີ</option><option value="anniversary">ຕາມວັນຄົບຮອບ</option></select></label>
        <label className="field">ຕ້ອງອະນຸມັດຈັກຄົນ<select className="input" disabled={readOnly} value={s.leaveApproversRequired} onChange={e => setS({ ...s, leaveApproversRequired: Number(e.target.value) as 1 | 2 })}><option value={1}>1 ຄົນ</option><option value={2}>2 ຄົນ</option></select></label>
        <label className="row" style={{ minHeight: 44 }}><input type="checkbox" disabled={readOnly} checked={s.makerChecker} onChange={e => setS({ ...s, makerChecker: e.target.checked })} />ເງິນເດືອນ / ເລກບັນຊີ ຕ້ອງກວດ 2 ຄົນ</label>
      </div>
        <fieldset style={{ border: '1.5px solid var(--line-2)', borderRadius: 14, padding: '8px 14px' }}><legend className="small muted">ໃຜອະນຸມັດການລາໄດ້ (ເຈົ້າຂອງຊ່ວຍໄດ້ຫຼັງເກີນເວລາ)</legend>
          <div className="row wrap">{ASSIGNABLE_APPROVER_ROLES.map(r => <label key={r} className="row" style={{ minHeight: 40 }}><input type="checkbox" disabled={readOnly} checked={s.leaveApproverRoles.includes(r)} onChange={() => toggleRole(r)} />{ROLE_NAMES[r]}</label>)}</div></fieldset>
        <div className="grid">{num('advanceMaxPctOfEarned', RULE_LABEL.advanceMaxPctOfEarned, 5, 100, 'ເຊັ່ນ 50 = ເບີກໄດ້ເຄິ່ງໜຶ່ງຂອງເງິນທີ່ເຮັດວຽກມາແລ້ວ')}</div>
      </div>}
      {tab === 'holidays' && <div className="card col"><h2>ວັນພັກລັດຖະການ</h2>
        <span className="muted small">ວັນເຫຼົ່ານີ້ບໍ່ນັບເປັນຂາດ ແລະ ບໍ່ນັບເປັນມື້ລາ</span>
        <div className="row wrap">{s.holidays.length === 0 && <span className="muted">ຍັງບໍ່ມີ</span>}{s.holidays.map(d => (
          <span key={d} className="pill info" style={{ height: 34 }}>{d.split('-').reverse().join('/')}{!readOnly && <button aria-label={`ລຶບ ${d}`} onClick={() => setS({ ...s, holidays: s.holidays.filter(x => x !== d) })} style={{ border: 'none', background: 'none', marginLeft: 6, fontWeight: 800 }}>×</button>}</span>))}</div>
        {!readOnly && <div className="row"><input className="input" type="date" aria-label="ເພີ່ມວັນພັກ" value={newHoliday} onChange={e => setNewHoliday(e.target.value)} style={{ maxWidth: 200 }} /><button className="btn ghost" onClick={addHoliday} disabled={!newHoliday}>+ ເພີ່ມວັນພັກ</button></div>}
      </div>}
      {tab === 'pay' && <div className="card col"><h2>ປະກັນສັງຄົມ & ອາກອນ</h2>
        <div className="pill warn" style={{ alignSelf: 'flex-start', height: 'auto', padding: '6px 12px', whiteSpace: 'normal' }}>ຄ່າເລີ່ມຕົ້ນເປັນຕົວຢ່າງ — ກວດກັບກົດໝາຍປັດຈຸບັນກ່ອນໃຊ້ຈິງ</div>
        <div className="grid">{num('ssRate', RULE_LABEL.ssRate, 0.1, 100, 'ຫັກຈາກເງິນເດືອນພື້ນຖານ')}{num('workHoursPerMonth', RULE_LABEL.workHoursPerMonth, 1, 1, 'ເງິນເດືອນ ÷ ເລກນີ້ = ຄ່າແຮງຕໍ່ຊົ່ວໂມງ (ໃຊ້ຄິດ OT)')}</div>
        <table className="t"><thead><tr><th>ລາຍໄດ້ເຖິງ (ກີບ)</th><th>ອັດຕາ (%)</th></tr></thead><tbody>
          {s.taxBrackets.map((b, i) => <tr key={i}><td>{b.upTo == null ? 'ຂຶ້ນໄປ' : <input className="input" type="number" disabled={readOnly} value={Number.isFinite(b.upTo) ? b.upTo : ''} onChange={e => setBracket(i, { upTo: e.target.value === '' ? NaN : Number(e.target.value) })} aria-label="ລາຍໄດ້ເຖິງ" />}</td>
            <td><input className="input" type="number" step="0.5" disabled={readOnly} value={shown(b.rate, 100)} onChange={e => setBracket(i, { rate: e.target.value === '' ? NaN : Number(e.target.value) / 100 })} aria-label="ອັດຕາ" /></td></tr>)}
        </tbody></table>
      </div>}
      {!readOnly && EDIT_TABS.includes(tab) && errors.length > 0 && <div className="error" role="alert"><b>ບັນທຶກບໍ່ໄດ້ — ກະລຸນາແກ້:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{errors.map(e => <li key={e}>{e}</li>)}</ul></div>}
      {!readOnly && EDIT_TABS.includes(tab) && <div className="savebar"><button className="btn" disabled={errors.length > 0 || !dirty} onClick={saveAll}>ບັນທຶກການຕັ້ງຄ່າ</button>
        {dirty && <span className="pill warn">ມີການແກ້ໄຂທີ່ຍັງບໍ່ບັນທຶກ</span>}
        {hr.companyId === 'demo-co' && <button className="btn danger" onClick={() => { if (confirm('ລ້າງຂໍ້ມູນສາທິດທັງໝົດ?')) hr.resetDemo(); }}>ລ້າງຂໍ້ມູນສາທິດ</button>}</div>}
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
