import { useEffect, useMemo, useRef, useState } from 'react';
import { useHR } from '../app/state';
import { uid } from '../data/store';
import type { Advance, Branch, LeaveRequest, LeaveType, ScanKind, ScanRecord } from '../domain/types';
import { evaluateScan, nearestBranch } from '../domain/attendance';
import { allowedActions, dayStatus, monthGrid, type DayStatus } from '../domain/day';
import { leaveDays } from '../domain/leave';
import { maxAdvance } from '../domain/payroll';
import { describeFace, loadFaceModels, matchScore, openFrontCamera, snapshot, stopCamera } from '../device/face';
import { getPosition, type Position } from '../device/geo';
import { leaveBalance, monthKey, shiftStartOn, summarize } from '../app/payrun';
import { effectiveShift } from '../domain/requests';
import MapCard from './MapCard';
import { KIND_LABEL } from './labels';
import type { HRRequest } from '../domain/requests';
import { MyRequests } from './RequestsUI';
import Approvals, { actionableCount, canApproveAnything, SECTION_LABEL, type ApprovalSection } from './Approvals';
import { About, CertificateView, Directory, EmpSettings, Notifications, Privacy, Profile, Reports, SchedulePage, TeamMap } from './Pages';
import { hhmm, initials, laoDate, laoMonth, LEAVE_TYPES, money, sameDay, ymd } from './format';

const Tick = ({ color = 'currentColor', size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;

const KIND_COLOR: Record<ScanKind, string> = { in: 'var(--primary)', breakStart: '#0e7490', breakEnd: '#0e7490', out: 'var(--out)' };

type Page = 'clock' | 'calendar' | 'leave' | 'pay' | 'advance' | 'profile' | 'directory' | 'notifications' | 'reports' | 'clockFix'
  | 'shift' | 'schedule' | 'ot' | 'expense' | 'certificate' | 'map' | 'about' | 'privacy' | 'settings' | `approve:${ApprovalSection}`;

const MAIN_TABS: [Page, string][] = [['clock', 'ລົງເວລາ'], ['calendar', 'ປະຕິທິນ'], ['leave', 'ລາ']];

const TITLES: Partial<Record<Page, string>> = {
  pay: 'ສະລິບເງິນເດືອນ', advance: 'ເບີກເງິນລ່ວງໜ້າ', profile: 'ໂປຣໄຟລ໌', directory: 'ລາຍຊື່ພະນັກງານ', notifications: 'ການແຈ້ງເຕືອນ',
  reports: 'ລາຍງານ', clockFix: 'ຂໍລົງເວລາ', shift: 'ສະລັບກະ ແລະ ວັນພັກ', schedule: 'ຈັດຕາຕະລາງວຽກ', ot: 'ຂໍລ່ວງເວລາ',
  expense: 'ບັນທຶກຄ່າໃຊ້ຈ່າຍ', certificate: 'ຂໍໜັງສືຮັບຮອງ', map: 'ແຜນທີ່', about: 'ຂໍ້ມູນ', privacy: 'Privacy policy', settings: 'ຕັ້ງຄ່າ'
};

// 24 menu entries, in the order of the reference app's drawer
const PERSONAL: [Page, string, string][] = [
  ['profile', 'ໂປຣໄຟລ໌', 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0'],
  ['directory', 'ລາຍຊື່', 'M6 3h12v18H6zM10 8h4M9 13h6M9 17h6'],
  ['notifications', 'ການແຈ້ງເຕືອນ', 'M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0'],
  ['reports', 'ລາຍງານ', 'M4 20V10M10 20V4M16 20v-7M22 20H2'],
  ['clockFix', 'ຂໍລົງເວລາ', 'M12 7v5l3 2M21 12a9 9 0 1 1-3-6.7M21 4v5h-5'],
  ['shift', 'ສະລັບກະ ແລະ ວັນພັກ', 'M7 7h13l-3-3M17 17H4l3 3'],
  ['schedule', 'ຈັດຕາຕະລາງວຽກ', 'M8 3v3M16 3v3M4 8h16M5 5h14v15H5zM9 13h6M9 17h3'],
  ['ot', 'ຂໍລ່ວງເວລາ', 'M9 4h6v3H9zM6 6h12v15H6zM9 12h6M9 16h4'],
  ['expense', 'ບັນທຶກຄ່າໃຊ້ຈ່າຍ', 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6'],
  ['certificate', 'ຂໍໜັງສືຮັບຮອງ', 'M3 5h18v14H3zM8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 16a3 3 0 0 1 6 0M14 9h4M14 13h4'],
  ['pay', 'ເບິ່ງສະລິບເງິນເດືອນ', 'M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21zM9 8h6M9 12h6M9 16h3'],
  ['advance', 'ເບີກເງິນລ່ວງໜ້າ', 'M3 7h18v12H3zM3 11h18M7 15h3']
];
const APPROVALS: [ApprovalSection, string][] = [
  ['scan', 'M9 11l2 2 4-4M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z'], ['leave', 'M3 17l18-6-18-6v5l10 1-10 1z'],
  ['shift', 'M7 7h13l-3-3M17 17H4l3 3'], ['schedule', 'M8 3v3M16 3v3M4 8h16M5 5h14v15H5zM9 15l2 2 4-4'],
  ['ot', 'M9 4h6v3H9zM6 6h12v15H6zM9 14l2 2 4-4'], ['expense', 'M4 6h16v12H4zM4 7l8 6 8-6'],
  ['certificate', 'M3 5h18v14H3zM14 13l2 2 4-4'], ['leaveCancel', 'M3 17l18-6-18-6v5l10 1-10 1zM16 18l4 4M20 18l-4 4']
];
const OTHER: [Page, string, string][] = [
  ['about', 'ຂໍ້ມູນ', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.5'],
  ['privacy', 'Privacy policy', 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6zM9 12l2 2 4-4'],
  ['settings', 'ຕັ້ງຄ່າ', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12h2M3 12h2M12 3v2M12 19v2M17 7l1.4-1.4M5.6 18.4 7 17M17 17l1.4 1.4M5.6 5.6 7 7']
];
const Ico = ({ d }: { d: string }) => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;

export default function EmployeeApp({ onSwitch }: { onSwitch: () => void }) {
  const hr = useHR();
  const { me } = hr;
  const [page, setPage] = useState<Page>('clock');
  const [drawer, setDrawer] = useState(false);
  const [cert, setCert] = useState<HRRequest<'certificate'> | null>(null);
  if (!me) return null;
  const go = (p: Page) => { setPage(p); setDrawer(false); };
  const isMain = MAIN_TABS.some(([id]) => id === page);
  const notifOn = (() => { try { return localStorage.getItem('sthr-notif') !== 'off'; } catch { return true; } })();
  const unread = notifOn ? hr.notifications.filter(n => n.userId === me.id && !n.read).length : 0;
  const approver = canApproveAnything(me.roles);
  const title = page.startsWith('approve:') ? SECTION_LABEL[page.slice(8) as ApprovalSection] : TITLES[page];
  const openLink = (link?: string) => {
    if (link === 'approvals') return go('approve:scan');
    if (link === 'requests') return go('clockFix');
    go((link as Page) || 'clock');
  };
  const badge = (n: number) => n > 0 && <span className="badge red">{n > 99 ? '99' : n}</span>;
  return (
    <div className="phone">
      <header className="appbar">
        <div className="appbar-top">
          <button className="icon-btn" aria-label="ເມນູ" onClick={() => setDrawer(true)} style={{ position: 'relative' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <b className="grow" style={{ fontSize: 20 }}>{isMain ? 'ST HR' : title}</b>
          <button className="icon-btn" aria-label={`ແຈ້ງເຕືອນ ${unread}`} onClick={() => go('notifications')} style={{ position: 'relative' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0" /></svg>
            {unread > 0 && <span className="badge red dot-badge">{unread > 99 ? '99' : unread}</span>}
          </button>
        </div>
        {isMain ? (
          <nav className="toptabs" role="tablist">
            {MAIN_TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={page === id} onClick={() => setPage(id)}>{label}</button>)}
          </nav>
        ) : (
          <div className="appbar-sub"><button className="btn ghost" style={{ minHeight: 36, padding: '0 12px', background: 'transparent', color: '#fff', borderColor: '#1d5a56' }} onClick={() => setPage('clock')}>‹ ກັບໜ້າຫຼັກ</button></div>
        )}
      </header>
      {page === 'clock' && <ClockTab />}
      {page === 'calendar' && <CalendarTab />}
      {page === 'leave' && <LeaveTab />}
      {page === 'pay' && <Pay />}
      {page === 'advance' && <AdvancePage />}
      {page === 'profile' && <Profile />}
      {page === 'directory' && <Directory />}
      {page === 'notifications' && <Notifications onOpen={openLink} />}
      {page === 'reports' && <Reports team={false} />}
      {page === 'clockFix' && <MyRequests kinds={['clockFix', 'leaveCancel']} />}
      {page === 'shift' && <MyRequests kinds={['shiftSwap', 'dayOffSwap']} />}
      {page === 'schedule' && <SchedulePage />}
      {page === 'ot' && <MyRequests kinds={['ot']} />}
      {page === 'expense' && <MyRequests kinds={['expense']} />}
      {page === 'certificate' && <MyRequests kinds={['certificate']} onPrint={setCert} />}
      {page === 'map' && <TeamMap />}
      {page === 'about' && <About />}
      {page === 'privacy' && <Privacy />}
      {page === 'settings' && <EmpSettings onLogout={onSwitch} />}
      {page.startsWith('approve:') && <Approvals key={page} section={page.slice(8) as ApprovalSection} />}
      {cert && <CertificateView r={cert} onClose={() => setCert(null)} />}
      {drawer && (
        <div className="drawer-back" onClick={() => setDrawer(false)}>
          <aside className="drawer" onClick={e => e.stopPropagation()} aria-label="ເມນູ">
            <div className="drawer-head">
              <span className="avatar" style={{ width: 72, height: 72, fontSize: 24 }}>{initials(me.name)}</span>
              <b style={{ color: '#fff', fontSize: 18 }}>{me.name} ({me.code})</b>
              <span className="small" style={{ color: '#9fd8d4' }}>{me.position}</span>
            </div>
            {PERSONAL.map(([id, label, d]) => <button key={id} onClick={() => go(id)} aria-current={page === id ? 'page' : undefined}><Ico d={d} /><span className="grow">{label}</span>{id === 'notifications' && badge(unread)}</button>)}
            {approver && <>
              <div className="drawer-sec">ລາຍງານ ແລະ ການອະນຸມັດ</div>
              {APPROVALS.map(([sec, d]) => <button key={sec} onClick={() => go(`approve:${sec}`)} aria-current={page === `approve:${sec}` ? 'page' : undefined}><Ico d={d} /><span className="grow">{SECTION_LABEL[sec]}</span>{badge(actionableCount(hr, sec))}</button>)}
              <button onClick={() => go('map')}><Ico d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14" /><span className="grow">ແຜນທີ່</span></button>
            </>}
            <div className="drawer-sec" />
            {OTHER.map(([id, label, d]) => <button key={id} onClick={() => go(id)}><Ico d={d} /><span className="grow">{label}</span></button>)}
            <button onClick={onSwitch}><Ico d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" /><span className="grow">ອອກຈາກລະບົບ</span></button>
          </aside>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ ລົງເວລາ ------------------------------ */

function useTodayScans(date: Date) {
  const { me, scans } = useHR();
  return useMemo(() => scans.filter(s => s.employeeId === me!.id && sameDay(s.deviceTime, date)).sort((a, b) => a.deviceTime.localeCompare(b.deviceTime)), [scans, me, date]);
}

function ClockTab() {
  const { me, branches, shifts, overrides } = useHR();
  const [now, setNow] = useState(new Date());
  const [pos, setPos] = useState<Position | null>(null);
  const [locating, setLocating] = useState(true);
  const [manual, setManual] = useState<Branch | null>(null);
  const [picking, setPicking] = useState(false);
  const [flow, setFlow] = useState<null | { kind: ScanKind; enroll: boolean }>(null);
  const today = useMemo(() => new Date(), []);
  const todays = useTodayScans(today);

  const locate = async () => { setLocating(true); setPos(await getPosition()); setLocating(false); };
  useEffect(() => {
    locate();
    const t = setInterval(() => setNow(new Date()), 1000);
    const g = setInterval(locate, 60000);
    return () => { clearInterval(t); clearInterval(g); };
  }, []);

  const near = pos ? nearestBranch(pos.lat, pos.lng, branches) : null;
  const inside = near && near.distanceM <= near.branch.radiusM;
  const allowed = allowedActions(todays);
  const todaysShift = effectiveShift(me!, ymd(today), overrides);
  const shift = shifts.find(s => s.id === (todaysShift ?? me!.shiftId))!;
  const start = (kind: ScanKind) => setFlow({ kind, enroll: kind === 'in' && !me!.faceEnrolled });

  const chip = locating ? <span className="loc-chip">ກຳລັງຫາຕຳແໜ່ງ…</span>
    : manual ? <button className="loc-chip warn" onClick={() => setPicking(true)}>ເລືອກເອງ: {manual.name} (ລໍຫົວໜ້າກວດ)</button>
    : inside ? <span className="loc-chip ok">{near!.branch.name} · {Math.round(near!.distanceM)} ມ.</span>
    : <button className="loc-chip" onClick={() => setPicking(true)}>{pos ? `ບໍ່ພົບສາຂາໃກ້ຄຽງ (${near ? Math.round(near.distanceM) + ' ມ.' : ''}) — ກົດເລືອກເອງ` : 'ບໍ່ມີ GPS — ກົດເລືອກສາຂາເອງ'}</button>;

  return (
    <div className="screen" style={{ paddingTop: 14 }}>
      <MapCard branches={branches} pos={pos}>
        <div className="clock-big">{now.toTimeString().slice(0, 5)}</div>
        <div className="clock-date">{laoDate(now)} {now.getFullYear()}</div>
      </MapCard>
      <div className="row">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
        <div className="grow">{chip}</div>
        <button className="icon-btn dark" aria-label="ຫາຕຳແໜ່ງໃໝ່" onClick={locate}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" /></svg>
        </button>
      </div>
      {picking && (
        <div className="card col">
          <b>ເລືອກສາຂາທີ່ເຈົ້າຢູ່</b>
          <span className="muted small">ການເລືອກເອງຈະຖືກສົ່ງໃຫ້ຫົວໜ້າກວດ</span>
          {branches.map(b => <button key={b.id} className="btn ghost" onClick={() => { setManual(b); setPicking(false); }}>{b.name}</button>)}
          {manual && <button className="btn ghost" onClick={() => { setManual(null); setPicking(false); }}>ໃຊ້ GPS ຄືເກົ່າ</button>}
        </div>
      )}
      <div className="clock-grid">
        <button className="clock-btn in" disabled={!allowed.in} onClick={() => start('in')}>ເຂົ້າວຽກ</button>
        <button className="clock-btn out" disabled={!allowed.out} onClick={() => start('out')}>ອອກວຽກ</button>
        <button className="clock-btn brk" disabled={!allowed.breakStart} onClick={() => start('breakStart')}>ເລີ່ມພັກ</button>
        <button className="clock-btn brk" disabled={!allowed.breakEnd} onClick={() => start('breakEnd')}>ເສັດພັກ</button>
      </div>
      {todays.some(s => s.status === 'pending') && <div className="pill warn" style={{ height: 'auto', padding: '8px 12px', whiteSpace: 'normal' }}>ມີການລົງເວລາທີ່ລໍຫົວໜ້າກວດ</div>}
      <h2 style={{ marginTop: 6 }}>ເວລາເຂົ້າ-ອອກວຽກ {todaysShift ? <span className="pill ok">{shift.name}</span> : <span className="pill info">ມື້ນີ້ເປັນວັນພັກ</span>}</h2>
      <TimeCard date={today} scans={todays} shift={shift} />
      {flow?.enroll && <Enroll onDone={() => setFlow({ kind: flow.kind, enroll: false })} onSkip={() => setFlow({ kind: flow.kind, enroll: false })} onCancel={() => setFlow(null)} />}
      {flow && !flow.enroll && <ScanFlow kind={flow.kind} manualBranch={manual} onClose={() => setFlow(null)} />}
    </div>
  );
}

/** Expected vs actual for one day, in two halves like a punch card. */
function TimeCard({ date, scans, shift }: { date: Date; scans: ScanRecord[]; shift: { start: string; end: string; breakStart: string; breakEnd: string; name: string } }) {
  const { settings } = useHR();
  const first = (k: ScanKind) => scans.find(s => s.kind === k && s.status !== 'rejected');
  const last = (k: ScanKind) => [...scans].reverse().find(s => s.kind === k && s.status !== 'rejected');
  const cell = (label: string, expected: string, s: ScanRecord | undefined, brkLabel: string, brkExpected: string, brk: ScanRecord | undefined, lateCheck: boolean) => {
    const late = lateCheck && s && (new Date(s.deviceTime).getHours() * 60 + new Date(s.deviceTime).getMinutes()) - (+expected.slice(0, 2) * 60 + +expected.slice(3)) > settings.graceMinutes;
    const tone = !s ? 'none' : s.status === 'pending' ? 'warn' : late ? 'late' : 'ok';
    return (
      <div className="tc-half">
        <span className="muted small">{label} ({expected})</span>
        <span className={`tc-time ${tone}`}>{s ? hhmm(s.deviceTime) : '—'}</span>
        <span className={`small tc-${tone}`}>{s ? (s.status === 'pending' ? 'ລໍກວດ' : late ? 'ມາຊ້າ' : 'ປົກກະຕິ') : `${date.getDate()}/${date.getMonth() + 1}`}</span>
        <span className="small muted">{brkLabel}: <b style={{ color: brk ? 'var(--ink)' : undefined }}>{brk ? hhmm(brk.deviceTime) : brkExpected}</b></span>
      </div>
    );
  };
  return (
    <div className="card timecard">
      {cell('ເຂົ້າວຽກ', shift.start, first('in'), 'ເລີ່ມພັກ', shift.breakStart, first('breakStart'), true)}
      {cell('ອອກວຽກ', shift.end, last('out'), 'ເສັດພັກ', shift.breakEnd, last('breakEnd'), false)}
    </div>
  );
}

/* ------------------------------ ປະຕິທິນ ------------------------------ */

const DAY_STYLE: Record<DayStatus, { cls: string; label: string } | null> = {
  ok: { cls: 'ok', label: 'ລົງເວລາປົກກະຕິ' },
  late: { cls: 'late', label: 'ມາຊ້າ' },
  absent: { cls: 'absent', label: 'ຂາດວຽກ' },
  leave: { cls: 'leave', label: 'ລາພັກ' },
  pending: { cls: 'pending', label: 'ລໍຫົວໜ້າກວດ' },
  holiday: { cls: 'holiday', label: 'ວັນພັກລັດຖະການ' },
  dayoff: null, future: null, 'before-hire': null
};

function CalendarTab() {
  const hr = useHR();
  const { me, scans, leaves, settings, shifts } = hr;
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [sel, setSel] = useState(ymd(now));
  const [legend, setLegend] = useState(true);
  const shift = shifts.find(s => s.id === me!.shiftId)!;
  const mine = scans.filter(s => s.employeeId === me!.id);
  const myLeaves = leaves.filter(l => l.employeeId === me!.id);
  const statusOf = (date: string) => {
    const start = shiftStartOn(hr, me!, date);
    return dayStatus({
      date, today: ymd(now), startDate: me!.startDate, shiftStart: start ?? shift.start, graceMinutes: settings.graceMinutes,
      dayOff: start ? [] : [new Date(date + 'T12:00:00').getDay()], holidays: settings.holidays ?? [], scans: mine.filter(s => ymd(new Date(s.deviceTime)) === date), leaves: myLeaves
    });
  };
  const grid = monthGrid(ym.y, ym.m);
  const move = (d: number) => setYm(({ y, m }) => { const t = new Date(y, m + d, 1); return { y: t.getFullYear(), m: t.getMonth() }; });
  const selDate = new Date(sel + 'T12:00:00');
  const selScans = mine.filter(s => ymd(new Date(s.deviceTime)) === sel).sort((a, b) => a.deviceTime.localeCompare(b.deviceTime));
  const counts = grid.filter(c => c.inMonth).reduce((a, c) => { const s = statusOf(c.date); a[s] = (a[s] ?? 0) + 1; return a; }, {} as Record<string, number>);

  return (
    <div className="screen" style={{ paddingTop: 14 }}>
      <div className="card" style={{ padding: '14px 8px' }}>
        <div className="row" style={{ justifyContent: 'space-between', padding: '0 8px 10px' }}>
          <button className="icon-btn" aria-label="ເດືອນກ່ອນ" onClick={() => move(-1)}>‹</button>
          <b style={{ fontSize: 20 }}>{laoMonth(ym.y, ym.m)}</b>
          <button className="icon-btn" aria-label="ເດືອນຖັດໄປ" onClick={() => move(1)}>›</button>
        </div>
        <div className="cal">
          {['ອາ', 'ຈ', 'ອ', 'ພ', 'ພຫ', 'ສຸ', 'ເສ'].map((d, i) => <span key={d} className={`cal-h ${i === 0 ? 'sun' : ''}`}>{d}</span>)}
          {grid.map(c => {
            const st = statusOf(c.date);
            const dow = new Date(c.date + 'T12:00:00').getDay();
            const style = DAY_STYLE[st];
            return (
              <button key={c.date} className={`cal-d ${c.inMonth ? '' : 'out'} ${dow === 0 || st === 'holiday' ? 'red' : ''} ${c.date === ymd(now) ? 'today' : ''} ${c.date === sel ? 'sel' : ''}`}
                onClick={() => setSel(c.date)} aria-label={`${c.date}${style ? ' ' + style.label : ''}`} aria-pressed={c.date === sel}>
                <span>{+c.date.slice(8)}</span>
                {style && c.inMonth && <i className={`cal-dot ${style.cls}`} />}
              </button>
            );
          })}
        </div>
      </div>
      <div className="card col" style={{ gap: 6 }}>
        <button className="row" style={{ border: 'none', background: 'none', padding: 0, justifyContent: 'space-between' }} onClick={() => setLegend(!legend)} aria-expanded={legend}>
          <b>ໝາຍເຫດ</b><span className="muted">{legend ? '▴' : '▾'}</span>
        </button>
        {legend && (
          <div className="legend">
            {(['ok', 'late', 'absent', 'leave', 'pending', 'holiday'] as DayStatus[]).map(s => (
              <span key={s} className="row small" style={{ gap: 8 }}><i className={`cal-dot ${DAY_STYLE[s]!.cls}`} />{DAY_STYLE[s]!.label}{counts[s] ? <b>({counts[s]})</b> : null}</span>
            ))}
            <span className="row small" style={{ gap: 8 }}><span className="leg-today">ມື້</span>ມື້ນີ້</span>
          </div>
        )}
      </div>
      <h2>{laoDate(selDate)}</h2>
      <TimeCard date={selDate} scans={selScans} shift={shift} />
    </div>
  );
}

/* ------------------------------ ລາ ------------------------------ */

function LeaveTab() {
  const hr = useHR();
  const { me, leaves } = hr;
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [form, setForm] = useState(false);
  const today = ymd(new Date());
  const bal = leaveBalance(hr, me!, today);
  const mine = leaves.filter(l => l.employeeId === me!.id).sort((a, b) => b.from.localeCompare(a.from));
  const shown = tab === 'all' ? mine : mine.filter(l => l.status === tab);
  const subs: [typeof tab, string][] = [['pending', 'ລໍ'], ['approved', 'ອະນຸມັດແລ້ວ'], ['rejected', 'ບໍ່ອະນຸມັດ'], ['all', 'ທັງໝົດ']];
  const pill = (s: string) => <span className={`status-pill ${s}`}>{s === 'approved' ? 'ອະນຸມັດແລ້ວ' : s === 'rejected' ? 'ບໍ່ອະນຸມັດ' : 'ລໍອະນຸມັດ'}</span>;
  return (
    <>
      <nav className="subtabs" role="tablist">
        {subs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
      </nav>
      <div className="screen" style={{ paddingTop: 12 }}>
        <div className="card row" style={{ background: 'var(--ok-bg)' }}>
          <span className="grow">ມື້ລາພັກປະຈຳປີເຫຼືອ</span><b style={{ fontSize: 22 }}>{bal.left} ມື້</b>
        </div>
        {shown.length === 0 && <div className="empty">ບໍ່ມີລາຍການ<br /><span className="small">ກົດ + ເພື່ອຂໍລາ</span></div>}
        {shown.map(l => (
          <div key={l.id} className="card row" style={{ alignItems: 'flex-start' }}>
            <span className="avatar big">{initials(me!.name)}</span>
            <div className="col grow" style={{ gap: 2 }}>
              <b style={{ fontSize: 17 }}>{l.reason}</b>
              <span>{LEAVE_TYPES[l.type]} · {l.days} ມື້</span>
              <span className="muted small">{l.from.split('-').reverse().join('/')}{l.to !== l.from ? ` - ${l.to.split('-').reverse().join('/')}` : ''}</span>
              <div style={{ marginTop: 4 }}>{pill(l.status)}</div>
            </div>
          </div>
        ))}
      </div>
      <button className="fab" aria-label="ຂໍລາໃໝ່" onClick={() => setForm(true)}>+</button>
      {form && <LeaveForm left={bal.left} onClose={() => setForm(false)} />}
    </>
  );
}

function LeaveForm({ left, onClose }: { left: number; onClose: () => void }) {
  const { me, save } = useHR();
  const today = ymd(new Date());
  const [type, setType] = useState<LeaveType>('annual');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const days = from && to && to >= from ? leaveDays(from, to, me!.dayOff ?? [0], []) : 0;
  const submit = async () => {
    setErr('');
    if (days <= 0) return setErr('ວັນທີບໍ່ຖືກຕ້ອງ');
    if (type === 'annual' && days > left) return setErr(`ມື້ລາພັກເຫຼືອ ${left} ມື້ ບໍ່ພໍ`);
    if (!reason.trim()) return setErr('ກະລຸນາໃສ່ເຫດຜົນ');
    const req: LeaveRequest = { id: uid(), companyId: me!.companyId, employeeId: me!.id, type, from, to, days, reason: reason.trim(), createdAt: new Date().toISOString(), approvals: [], status: 'pending' };
    await save('leaves', req, 'leave-request');
    onClose();
  };
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet col" onClick={e => e.stopPropagation()} role="dialog" aria-label="ຂໍລາ">
        <h2>ຂໍລາ</h2>
        <div className="row wrap">{(['annual', 'sick', 'personal', 'unpaid'] as LeaveType[]).map(t => (
          <button key={t} className={`btn ${type === t ? '' : 'ghost'}`} onClick={() => setType(t)} aria-pressed={type === t}>{LEAVE_TYPES[t]}</button>))}</div>
        <div className="row"><label className="field grow">ແຕ່ວັນທີ<input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label className="field grow">ຫາວັນທີ<input className="input" type="date" value={to} onChange={e => setTo(e.target.value)} /></label></div>
        <span className="muted small">ລວມ {days} ມື້ເຮັດວຽກ</span>
        <label className="field">ເຫດຜົນ<input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="ເຊັ່ນ: ໄປໂຮງໝໍ" /></label>
        {err && <div className="error" role="alert">{err}</div>}
        <div className="row"><button className="btn ghost grow" onClick={onClose}>ຍົກເລີກ</button><button className="btn grow" onClick={submit}>ສົ່ງຄຳຂໍ</button></div>
      </div>
    </div>
  );
}

/* ------------------------------ ເບີກ & ເງິນເດືອນ ------------------------------ */

function AdvancePage() {
  const { me, advances, settings, save } = useHR();
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState('');
  const now = new Date();
  const cap = maxAdvance(me!.baseSalary, now.getDate(), new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(), settings);
  const mine = advances.filter(a => a.employeeId === me!.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const submit = async () => {
    setErr('');
    const n = Number(amount.replace(/\D/g, ''));
    if (!n) return setErr('ໃສ່ຈຳນວນເງິນ');
    if (n > cap) return setErr(`ເບີກໄດ້ສູງສຸດ ${money(cap)} ₭`);
    const adv: Advance = { id: uid(), companyId: me!.companyId, employeeId: me!.id, amount: n, installments: 1, remaining: n, status: 'pending', approvals: [], createdAt: new Date().toISOString() };
    await save('advances', adv, 'advance-request');
    setAmount('');
  };
  return (
    <div className="screen">
      <div className="card col">
        <span className="muted small">ເບີກໄດ້ສູງສຸດ {money(cap)} ₭ · ຫັກໃນເງິນເດືອນອັດຕະໂນມັດ</span>
        <input className="input" inputMode="numeric" value={amount} onChange={e => { const d = e.target.value.replace(/\D/g, ''); setAmount(d ? money(Number(d)) : ''); }} placeholder="ຈຳນວນເງິນ (ກີບ)" aria-label="ຈຳນວນເງິນ" />
        {err && <div className="error" role="alert">{err}</div>}
        <button className="btn" onClick={submit}>ສົ່ງຄຳຂໍເບີກ</button>
      </div>
      {mine.map(a => <div key={a.id} className="card row"><div className="col grow" style={{ gap: 0 }}><b>{money(a.amount)} ₭</b><span className="muted small">{a.createdAt.slice(0, 10)}</span></div>
        <span className={`status-pill ${a.status}`}>{a.status === 'approved' ? 'ອະນຸມັດແລ້ວ' : a.status === 'rejected' ? 'ບໍ່ອະນຸມັດ' : 'ລໍອະນຸມັດ'}</span></div>)}
    </div>
  );
}

function Pay() {
  const hr = useHR();
  const me = hr.me!;
  const key = monthKey(new Date());
  const run = hr.payrollRuns.find(r => r.id === key);
  const s = summarize(hr, me, key, !!run?.lateConfirmed.includes(me.id)).slip;
  const line = (k: string, v: number, neg = false) => <div className="row"><span className="grow">{k}</span><b style={{ color: neg && v ? 'var(--bad)' : undefined }}>{neg && v ? '−' : ''}{money(v)}</b></div>;
  return (
    <div className="screen">
      <span className="muted small">{laoMonth(new Date().getFullYear(), new Date().getMonth())} · ຕົວເລກປະມານການ ຈົນກວ່າ HR ຈະລັອກງວດ</span>
      <div className="card col">
        <span className="muted small">ລາຍຮັບ</span>
        {line('ເງິນເດືອນພື້ນຖານ', s.base)}{line('ຄ່າລ່ວງເວລາ (OT)', s.ot)}{line('ເບ້ຍລ້ຽງ', s.allowance)}
        <span className="muted small">ລາຍຫັກ</span>
        {line('ມາຊ້າ', s.lateDeduction, true)}{line('ລາບໍ່ຮັບເງິນເດືອນ', s.unpaidLeave, true)}{line('ປະກັນສັງຄົມ', s.socialSecurity, true)}{line('ອາກອນລາຍໄດ້', s.tax, true)}{line('ເບີກລ່ວງໜ້າ', s.advance, true)}
      </div>
      <div className="card dark row"><span className="grow" style={{ color: '#9fd8d4' }}>ຮັບສຸດທິ</span><span className="big-num">{money(s.net)} <span style={{ fontSize: 16, color: 'var(--mint-ink)' }}>₭</span></span></div>
    </div>
  );
}

/* ------------------------------ ສະແກນໜ້າ ------------------------------ */

/** Consent + 3 captures averaged into the enrolled descriptor. */
function Enroll({ onDone, onSkip, onCancel }: { onDone: () => void; onSkip: () => void; onCancel: () => void }) {
  const { me, save } = useHR();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [phase, setPhase] = useState<'consent' | 'camera' | 'saving'>('consent');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; stopCamera(stream.current); }, []);

  const start = async () => {
    setPhase('camera');
    setError('');
    try {
      stream.current = await openFrontCamera(video.current!);
      setMsg('ກຳລັງກຽມ…');
      await loadFaceModels();
      const samples: number[][] = [];
      for (let tries = 0; samples.length < 3 && tries < 30 && !cancelled.current; tries++) {
        setMsg(`ຖືໃຫ້ນິ່ງໆ… ${samples.length}/3`);
        const d = await describeFace(video.current!);
        if (d) samples.push(d);
        await new Promise(r => setTimeout(r, 300));
      }
      if (cancelled.current) return;
      if (samples.length < 3) throw new Error('ຫາໃບໜ້າບໍ່ເຫັນ ລອງໄປບ່ອນແຈ້ງກວ່ານີ້');
      const avg = samples[0].map((_, i) => samples.reduce((a, s) => a + s[i], 0) / samples.length);
      setPhase('saving');
      await save('employees', { ...me!, faceEnrolled: avg, faceConsentAt: new Date().toISOString() }, 'face-enroll');
      stopCamera(stream.current);
      onDone();
    } catch (e: any) {
      setError(e?.name === 'NotAllowedError' ? 'ບໍ່ໄດ້ອະນຸຍາດໃຫ້ໃຊ້ກ້ອງ' : e?.message || 'ເປີດກ້ອງບໍ່ໄດ້');
      stopCamera(stream.current);
      setPhase('consent');
    }
  };

  return (
    <div className="fullscreen scan">
      <h1 style={{ fontSize: 28 }}>ລົງທະບຽນໃບໜ້າ</h1>
      {phase === 'consent' ? (
        <div className="col" style={{ maxWidth: 420, width: '100%' }}>
          <p style={{ fontSize: 17, color: '#cdebe8', margin: 0 }}>ເຮັດເທື່ອດຽວ. ແອັບຈະຈື່ໜ້າຂອງເຈົ້າ ເພື່ອໃຊ້ລົງເວລາເຂົ້າ-ອອກວຽກເທົ່ານັ້ນ.</p>
          <div className="card" style={{ background: 'rgba(255,255,255,.07)', color: '#fff', fontSize: 14 }}>
            • ເກັບຮູບຕອນສະແກນໄວ້ 1 ປີ ແລ້ວລຶບອັດຕະໂນມັດ<br />• ໃຊ້ສະເພາະການລົງເວລາ, ບໍ່ສົ່ງໃຫ້ຄົນນອກ<br />• ຖອນຄວາມຍິນຍອມໄດ້ທຸກເວລາ ໂດຍແຈ້ງ HR
          </div>
          <label className="row" style={{ fontSize: 17, minHeight: 48 }}>
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={{ width: 26, height: 26 }} />
            ຂ້ອຍຍິນຍອມ
          </label>
          {error && <div className="error">{error}</div>}
          {/* never lock someone out of clocking in: without a face the scan is saved for the head to review */}
          {error && <button className="btn block" onClick={onSkip} style={{ background: '#f4b740', color: '#3b2600', fontSize: 17 }}>ລົງເວລາກ່ອນ (ລໍຫົວໜ້າກວດ)</button>}
          <button className="btn block" disabled={!agreed} onClick={start} style={{ background: 'var(--mint)', color: 'var(--dark)' }}>ເລີ່ມຖ່າຍໜ້າ</button>
          <button className="btn block ghost" onClick={onCancel} style={{ background: 'transparent', color: '#fff', borderColor: 'var(--mint)' }}>ຍົກເລີກ</button>
        </div>
      ) : (
        <span style={{ fontSize: 17, color: '#cdebe8', textAlign: 'center' }}>ຖືໂທລະສັບຫ່າງປະມານແຂນ<br />ໃຫ້ເຫັນໜ້າເຕັມວົງມົນ ຢູ່ບ່ອນແຈ້ງ</span>
      )}
      {/* one video element for the whole flow, so the ref is valid before the camera opens */}
      <div className="facering" style={{ display: phase === 'consent' ? 'none' : undefined }}><video ref={video} playsInline muted /></div>
      {phase !== 'consent' && <>
        <div className="check" style={{ maxWidth: 420 }}><span className="dot wait" />{phase === 'saving' ? 'ກຳລັງບັນທຶກ…' : msg}</div>
        <div style={{ flex: 1 }} />
        <button className="btn block ghost" style={{ background: 'transparent', color: '#fff', borderColor: 'var(--mint)', maxWidth: 420 }}
          onClick={() => { stopCamera(stream.current); onCancel(); }} disabled={phase === 'saving'}>ຍົກເລີກ</button>
      </>}
    </div>
  );
}

type Check = 'wait' | 'ok' | 'no';

function ScanFlow({ kind, manualBranch, onClose }: { kind: ScanKind; manualBranch: Branch | null; onClose: () => void }) {
  const { me, branches, settings, save } = useHR();
  const video = useRef<HTMLVideoElement>(null);
  const run = useRef({ cancelled: false, stream: null as MediaStream | null });
  const [face, setFace] = useState<Check>('wait');
  const [gps, setGps] = useState<Check>('wait');
  const [gpsLabel, setGpsLabel] = useState('ກຳລັງກວດບ່ອນຢູ່…');
  const [result, setResult] = useState<ScanRecord | null>(null);
  const color = KIND_COLOR[kind];

  useEffect(() => {
    // each effect run owns its own token, so a StrictMode re-run can never save a second scan
    const self = { cancelled: false, stream: null as MediaStream | null };
    run.current = self;
    const deviceTime = new Date();
    (async () => {
      const posP = getPosition();
      let score: number | null = null;
      let photo: string | undefined;
      try {
        self.stream = await openFrontCamera(video.current!);
        if (self.cancelled) { stopCamera(self.stream); return; }
        await loadFaceModels();
        for (let i = 0; i < 20 && !self.cancelled; i++) {
          const d = await describeFace(video.current!);
          if (d && me!.faceEnrolled) {
            score = Math.max(score ?? 0, matchScore(d, me!.faceEnrolled));
            photo = snapshot(video.current!);
            if (score >= settings.faceMinScore) break;
          }
          await new Promise(r => setTimeout(r, 250));
        }
      } catch { /* camera denied or unavailable → face stays null, scan goes to review */ }
      stopCamera(self.stream);
      if (self.cancelled) return;
      setFace(score != null && score >= settings.faceMinScore ? 'ok' : 'no');

      const pos = await posP;
      if (self.cancelled) return;
      const offline = !navigator.onLine;
      const v = evaluateScan({ gps: pos, faceScore: score, deviceTime, serverTime: offline ? deviceTime : new Date() }, branches, settings);
      if (manualBranch) { v.reasons.push(`ເລືອກສາຂາເອງ: ${manualBranch.name}`); v.ok = false; v.branchId = manualBranch.id; }
      const branch = branches.find(b => b.id === v.branchId);
      const gpsBad = !!manualBranch || v.reasons.some(r => r.startsWith('ຢູ່ໄກ') || r.startsWith('ບໍ່ມີ GPS'));
      setGps(gpsBad ? 'no' : 'ok');
      setGpsLabel(manualBranch ? `ເລືອກເອງ: ${manualBranch.name}` : !pos ? 'ບໍ່ມີ GPS' : gpsBad ? `ຢູ່ໄກຮ້ານ ${v.distanceM} ມ.` : `ຢູ່ໃນຮ້ານ · ${branch?.name}`);
      const rec: ScanRecord = {
        id: uid(), companyId: me!.companyId, employeeId: me!.id, kind, deviceTime: deviceTime.toISOString(),
        serverTime: offline ? undefined : new Date().toISOString(), branchId: v.branchId, lat: pos?.lat, lng: pos?.lng,
        distanceM: v.distanceM, faceScore: score ?? undefined, photo, status: v.ok ? 'ok' : 'pending', reasons: v.reasons, offline
      };
      await save('scans', rec, 'clock-' + kind);
      setTimeout(() => !self.cancelled && setResult(rec), 600);
    })();
    return () => { self.cancelled = true; stopCamera(self.stream); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (result) {
    if (result.status === 'ok') {
      return (
        <div className="fullscreen result" style={{ background: color, color: '#fff' }}>
          <div className="col grow result">
            <span className="circle" style={{ background: '#fff', color }}><Tick size={84} /></span>
            <span className="t1" role="status" style={{ marginTop: 18 }}>{KIND_LABEL[kind]}ແລ້ວ!</span>
            <span className="t2">{hhmm(result.deviceTime)}</span>
            <span style={{ fontSize: 18 }}>{kind === 'in' ? 'ສູ້ໆ ມື້ນີ້!' : kind === 'out' ? 'ພັກຜ່ອນໃຫ້ດີ ພົບກັນມື້ອື່ນ' : ''}</span>
          </div>
          <button className="btn block" style={{ background: '#fff', color }} onClick={onClose}>ຕົກລົງ</button>
        </div>
      );
    }
    return (
      <div className="fullscreen result" style={{ background: 'var(--warn-bg)', color: '#3b2600' }}>
        <div className="col grow result">
          <span className="circle" style={{ background: 'var(--warn)', boxShadow: '0 0 0 16px rgba(244,183,64,.3)' }}>
            <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" /></svg>
          </span>
          <span className="t1" role="status" style={{ marginTop: 18 }}>ບັນທຶກແລ້ວ</span>
          <b style={{ fontSize: 22 }}>ລໍຫົວໜ້າກວດ</b>
          <div className="row wrap" style={{ justifyContent: 'center' }}>{result.reasons.map(r => <span key={r} className="pill" style={{ background: '#fff', color: 'var(--warn)', height: 36, fontSize: 15 }}>{r}</span>)}</div>
          <span style={{ fontSize: 18 }}>ບໍ່ຕ້ອງເປັນຫ່ວງ<br />ເວລາ {hhmm(result.deviceTime)} ຂອງເຈົ້າຖືກບັນທຶກໄວ້ແລ້ວ</span>
        </div>
        <button className="btn block" style={{ background: 'var(--warn)' }} onClick={onClose}>ຕົກລົງ</button>
      </div>
    );
  }

  return (
    <div className="fullscreen scan">
      <span className="pill" style={{ height: 40, fontSize: 16, padding: '0 16px', background: color, color: '#fff' }}>ກຳລັງ: {KIND_LABEL[kind]}</span>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 28, fontWeight: 800 }}>ສ່ອງໜ້າໃສ່ວົງມົນ</div>
        <div style={{ fontSize: 17, color: '#cdebe8' }}>ຖືໂທລະສັບໄວ້ຕໍ່ໜ້າ ໃຫ້ເຫັນໜ້າຊັດໆ</div>
      </div>
      <div className={`facering ${face === 'ok' ? 'ok' : ''}`}><video ref={video} playsInline muted /></div>
      <div className="col" style={{ width: '100%', maxWidth: 420 }}>
        <div className="check"><span className={`dot ${face}`}>{face === 'ok' && <Tick />}{face === 'no' && '!'}</span>{face === 'wait' ? 'ກຳລັງຊອກໃບໜ້າ…' : face === 'ok' ? 'ພົບໃບໜ້າແລ້ວ' : 'ໜ້າບໍ່ຊັດ'}</div>
        <div className="check"><span className={`dot ${gps}`}>{gps === 'ok' && <Tick />}{gps === 'no' && '!'}</span>{gpsLabel}</div>
      </div>
      <div style={{ flex: 1 }} />
      <button className="btn block ghost" style={{ background: 'transparent', color: '#fff', borderColor: 'var(--mint)', maxWidth: 420 }}
        onClick={() => { run.current.cancelled = true; stopCamera(run.current.stream); onClose(); }}>ຍົກເລີກ</button>
    </div>
  );
}
