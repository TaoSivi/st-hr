import { useEffect, useMemo, useRef, useState } from 'react';
import { useHR } from '../app/state';
import { uid } from '../data/store';
import type { Advance, Branch, LeaveRequest, LeaveType, ScanKind, ScanRecord } from '../domain/types';
import { evaluateScan, nearestBranch } from '../domain/attendance';
import { dayStatus, monthGrid, type DayStatus } from '../domain/day';
import { capBalance, leaveApprovers, leaveDays } from '../domain/leave';
import { maxAdvance } from '../domain/payroll';
import { loadFaceModels, openFrontCamera, readFrame, snapshot, stopCamera } from '../device/face';
import { frameAdvice, ISSUE_TEXT } from '../domain/faceQuality';
import { averageDescriptors, bestFaceScore, consensusScore, FACE_FRAMES, faceTemplates, needsEnroll, poseOk, POSES, SAMPLES_PER_POSE } from '../domain/face';
import { getPosition, type Position } from '../device/geo';
import { getDeviceId } from '../device/deviceId';
import { leaveBalance, monthKey, summarize } from '../app/payrun';
import { effectiveShift } from '../domain/requests';
import MapCard from './MapCard';
import Icon, { type IconName } from './Icon';
import { useClosing } from './closing';
import { prefersReducedMotion } from './press';
import { DAY_ACTION_TEXT, dayActions, type DayAction } from '../domain/dayActions';
import { menuOn, SELF_MENUS } from '../domain/permissions';
import type { SelfMenu } from '../domain/types';
import { KIND_LABEL } from './labels';
import type { HRRequest } from '../domain/requests';
import { MyRequests, RequestSheet } from './RequestsUI';
import Approvals, { actionableCount, NoAccess, SECTION_LABEL, visibleSections, type ApprovalSection } from './Approvals';
import { canViewPage, isManager } from '../domain/permissions';
import { PayslipView } from './PayslipView';
import { missedDatesFor } from '../app/missedOut';
import { compBalanceFor, lateStartOn } from '../app/payrun';
import { leaveRequestBlock, leaveSpan, partialDays, PART_LABEL, shiftPaidHours, type LeavePart } from '../domain/leavePart';
import { closesAtFor } from '../domain/missedOut';
import { activeSession, actionsNow, scansOn, toSessions } from '../domain/sessions';
import { About, CertificateView, Directory, EmpSettings, Notifications, Privacy, Profile, Reports, SchedulePage, TeamMap } from './Pages';
import { hhmm, initials, laoDate, laoMonth, LEAVE_TYPES, money, retentionLabel, ROLE_NAMES, ymd } from './format';

const Tick = ({ color = 'currentColor', size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;

const KIND_COLOR: Record<ScanKind, string> = { in: 'var(--primary)', breakStart: '#0e7490', breakEnd: '#0e7490', out: 'var(--out)' };

type Page = 'clock' | 'calendar' | 'leave' | 'pay' | 'advance' | 'profile' | 'directory' | 'notifications' | 'reports' | 'clockFix'
  | 'shift' | 'schedule' | 'ot' | 'expense' | 'certificate' | 'map' | 'about' | 'privacy' | 'settings' | `approve:${ApprovalSection}`;

const MAIN_TABS: [Page, string, IconName][] = [['clock', 'ລົງເວລາ', 'clock'], ['calendar', 'ປະຕິທິນ', 'schedule'], ['leave', 'ລາ', 'leave']];

/** The greeting that fits the hour. */
const greeting = (d: Date) => (d.getHours() < 12 ? 'ສະບາຍດີຕອນເຊົ້າ' : d.getHours() < 17 ? 'ສະບາຍດີຕອນບ່າຍ' : 'ສະບາຍດີຕອນແລງ');

const TITLES: Partial<Record<Page, string>> = {
  pay: 'ສະລິບເງິນເດືອນ', advance: 'ເບີກເງິນລ່ວງໜ້າ', profile: 'ໂປຣໄຟລ໌', directory: 'ລາຍຊື່ພະນັກງານ', notifications: 'ການແຈ້ງເຕືອນ',
  reports: 'ລາຍງານ', clockFix: 'ຂໍລົງເວລາ', shift: 'ສະລັບກະ ແລະ ວັນພັກ', schedule: 'ຈັດຕາຕະລາງວຽກ', ot: 'ຂໍລ່ວງເວລາ',
  expense: 'ບັນທຶກຄ່າໃຊ້ຈ່າຍ', certificate: 'ຂໍໜັງສືຮັບຮອງ', map: 'ແຜນທີ່', about: 'ຂໍ້ມູນ', privacy: 'Privacy policy', settings: 'ຕັ້ງຄ່າ'
};

// 24 menu entries, in the order of the reference app's drawer
const PERSONAL: [Page, string, IconName][] = [
  ['profile', 'ໂປຣໄຟລ໌', 'profile'], ['directory', 'ລາຍຊື່', 'directory'], ['notifications', 'ການແຈ້ງເຕືອນ', 'bell'], ['reports', 'ລາຍງານ', 'reports'],
  ['clockFix', 'ຂໍລົງເວລາ', 'clockFix'], ['shift', 'ສະລັບກະ ແລະ ວັນພັກ', 'shift'], ['schedule', 'ຈັດຕາຕະລາງວຽກ', 'schedule'], ['ot', 'ຂໍລ່ວງເວລາ', 'ot'],
  ['expense', 'ບັນທຶກຄ່າໃຊ້ຈ່າຍ', 'expense'], ['certificate', 'ຂໍໜັງສືຮັບຮອງ', 'certificate'], ['pay', 'ເບິ່ງສະລິບເງິນເດືອນ', 'pay'], ['advance', 'ເບີກເງິນລ່ວງໜ້າ', 'advance']
];
const APPROVALS: [ApprovalSection, IconName][] = [
  ['scan', 'scan'], ['leave', 'leave'], ['shift', 'shift'], ['schedule', 'schedule'], ['ot', 'ot'], ['expense', 'expense'],
  ['certificate', 'certificate'], ['leaveCancel', 'leaveCancel'], ['device', 'device'], ['face', 'face']
];
const OTHER: [Page, string, IconName][] = [['about', 'ຂໍ້ມູນ', 'about'], ['privacy', 'Privacy policy', 'privacy'], ['settings', 'ຕັ້ງຄ່າ', 'settings']];
const Ico = ({ n }: { n: IconName }) => <Icon name={n} />;

export default function EmployeeApp({ onSwitch, onManagerView }: { onSwitch: () => void; onManagerView?: () => void }) {
  const hr = useHR();
  const { me } = hr;
  const [pageAsked, setPage] = useState<Page>('clock');
  const [drawer, setDrawer] = useState(false);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const closeDrawer = () => { if (drawerClosing) return; setDrawerClosing(true); setTimeout(() => { setDrawer(false); setDrawerClosing(false); }, prefersReducedMotion() ? 0 : 280); };
  const [cert, setCert] = useState<HRRequest<'certificate'> | null>(null);
  if (!me) return null;
  // a menu the company switched off cannot be opened, even from a notification link
  const page = (SELF_MENUS.includes(pageAsked as SelfMenu) && !menuOn(pageAsked as SelfMenu, hr.settings, me.roles) ? 'blocked' : pageAsked) as Page;
  const go = (p: Page) => { setPage(p); closeDrawer(); };
  const isMain = MAIN_TABS.some(([id]) => id === page);
  const notifOn = (() => { try { return localStorage.getItem('sthr-notif') !== 'off'; } catch { return true; } })();
  const unread = notifOn ? hr.notifications.filter(n => n.userId === me.id && !n.read).length : 0;
  const sections = visibleSections(hr);
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
            <Icon name="menu" size={26} />
          </button>
          <b className="grow" style={{ fontSize: 20 }}>{isMain ? 'ST HR' : title}</b>
          <button className="icon-btn" aria-label={`ແຈ້ງເຕືອນ ${unread}`} onClick={() => go('notifications')} style={{ position: 'relative' }}>
            <Icon name="bell" />
            {unread > 0 && <span className="badge red dot-badge">{unread > 99 ? '99' : unread}</span>}
          </button>
        </div>
        {page === 'clock' && <div className="greet"><span>{greeting(new Date())}</span><b>ມື້ນີ້ພ້ອມເຮັດວຽກແລ້ວບໍ?</b></div>}
        {!isMain && (
          <div className="appbar-sub"><button className="btn ghost" style={{ minHeight: 44, padding: '0 14px' }} onClick={() => setPage('clock')}>‹ ກັບໜ້າຫຼັກ</button></div>
        )}
      </header>
      {isMain && (
        <nav className="bottomnav" role="tablist" aria-label="ໜ້າຫຼັກ">
          {MAIN_TABS.map(([id, label, icon]) => <button key={id} role="tab" aria-selected={page === id} onClick={() => setPage(id)}><Icon name={icon} size={22} /><span>{label}</span></button>)}
        </nav>
      )}
      {page === 'clock' && <ClockTab />}
      {(page as string) === 'blocked' && <div className="screen"><div className="card empty" role="alert">ບໍລິສັດປິດເມນູນີ້ໄວ້</div></div>}
      {page === 'calendar' && <CalendarTab />}
      {page === 'leave' && <LeaveTab />}
      {page === 'pay' && <Pay />}
      {page === 'advance' && <AdvancePage />}
      {page === 'profile' && <Profile />}
      {page === 'directory' && <Directory />}
      {page === 'notifications' && <Notifications onOpen={openLink} />}
      {page === 'reports' && <Reports team={false} />}
      {page === 'clockFix' && <MyRequests kinds={['clockFix', 'leaveCancel', 'deviceChange', 'faceReset']} />}
      {page === 'shift' && <MyRequests kinds={['shiftSwap', 'dayOffSwap']} />}
      {page === 'schedule' && <SchedulePage />}
      {page === 'ot' && <MyRequests kinds={['ot']} />}
      {page === 'expense' && <MyRequests kinds={['expense']} />}
      {page === 'certificate' && <MyRequests kinds={['certificate']} onPrint={setCert} />}
      {page === 'map' && (canViewPage(me, 'map', hr.settings) ? <TeamMap /> : <NoAccess />)}
      {page === 'about' && <About />}
      {page === 'privacy' && <Privacy />}
      {page === 'settings' && <EmpSettings onLogout={onSwitch} />}
      {page.startsWith('approve:') && <Approvals key={page} section={page.slice(8) as ApprovalSection} />}
      {cert && <CertificateView r={cert} onClose={() => setCert(null)} />}
      {drawer && (
        <div className={`drawer-back${drawerClosing ? ' closing' : ''}`} onClick={closeDrawer}>
          <aside className="drawer" onClick={e => e.stopPropagation()} aria-label="ເມນູ">
            <div className="drawer-head">
              <span className="avatar" style={{ width: 72, height: 72, fontSize: 24 }}>{initials(me.name)}</span>
              <b style={{ color: '#fff', fontSize: 18 }}>{me.name} ({me.code})</b>
              <span className="small" style={{ color: '#9fd8d4' }}>{me.position}</span>
            </div>
            {PERSONAL.filter(([id]) => !SELF_MENUS.includes(id as SelfMenu) || menuOn(id as SelfMenu, hr.settings, me.roles)).map(([id, label, d]) => <button key={id} onClick={() => go(id)} aria-current={page === id ? 'page' : undefined}><Ico n={d} /><span className="grow">{label}</span>{id === 'notifications' && badge(unread)}</button>)}
            {isManager(me, hr.settings) && <>
              <div className="drawer-sec">ລາຍງານ ແລະ ການອະນຸມັດ</div>
              {onManagerView && <button onClick={() => { closeDrawer(); onManagerView(); }}><Ico n="dashboard" /><span className="grow">ໜ້າຈໍບໍລິຫານ HR</span></button>}
              {APPROVALS.filter(([sec]) => sections.includes(sec)).map(([sec, d]) => <button key={sec} onClick={() => go(`approve:${sec}`)} aria-current={page === `approve:${sec}` ? 'page' : undefined}><Ico n={d} /><span className="grow">{SECTION_LABEL[sec]}</span>{badge(actionableCount(hr, sec))}</button>)}
              {canViewPage(me, 'map', hr.settings) && <button onClick={() => go('map')}><Ico n="map" /><span className="grow">ແຜນທີ່</span></button>}
            </>}
            <div className="drawer-sec" />
            {OTHER.map(([id, label, d]) => <button key={id} onClick={() => go(id)}><Ico n={d} /><span className="grow">{label}</span></button>)}
            <button onClick={onSwitch}><Ico n="logout" /><span className="grow">ອອກຈາກລະບົບ</span></button>
          </aside>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ ລົງເວລາ ------------------------------ */

/**
 * What "today" means for the clock screen. Normally the calendar day; but while a night shift that began yesterday is still open,
 * its work day (and its scans) is shown instead, and the buttons continue that session.
 */
function useWorkDay(now: Date) {
  const { me, scans, shifts, overrides } = useHR();
  const minute = Math.floor(now.getTime() / 60000);
  return useMemo(() => {
    const mine = scans.filter(s => s.employeeId === me!.id);
    const closesOf = (date: string) => closesAtFor(date, shifts.find(x => x.id === effectiveShift(me!, date, overrides)));
    const sessions = toSessions(mine, closesOf);
    const date = activeSession(sessions, now, closesOf)?.workDate ?? ymd(now);
    // rejected scans are not in any session but still show on their own day
    const shown = [...scansOn(sessions, date), ...mine.filter(s => s.status === 'rejected' && ymd(new Date(s.deviceTime)) === date)].sort((a, b) => a.deviceTime.localeCompare(b.deviceTime));
    return { date, scans: shown, allowed: actionsNow(mine, now, closesOf) };
  }, [scans, me, shifts, overrides, minute]); // eslint-disable-line react-hooks/exhaustive-deps
}

function ClockTab() {
  const { me, branches, shifts, overrides } = useHR();
  const [now, setNow] = useState(new Date());
  const [pos, setPos] = useState<Position | null>(null);
  const [locating, setLocating] = useState(true);
  const [manual, setManual] = useState<Branch | null>(null);
  const [picking, setPicking] = useState(false);
  const [showMap, setShowMap] = useState(false); // the map and the manual branch choice live inside the GPS row
  const [flow, setFlow] = useState<null | { kind: ScanKind; enroll: boolean }>(null);
  const workDay = useWorkDay(now);
  const todays = workDay.scans;
  const hrAll = useHR();
  const missed = useMemo(() => missedDatesFor(hrAll, me!, now), [hrAll.scans, hrAll.shifts, hrAll.overrides, now.getMinutes()]); // eslint-disable-line react-hooks/exhaustive-deps
  const [fixing, setFixing] = useState<string | null>(null);

  const locate = async () => { setLocating(true); setPos(await getPosition()); setLocating(false); };
  useEffect(() => {
    locate();
    // load the face models while there is internet, so a scan still works if the connection drops later
    if (navigator.onLine) loadFaceModels().catch(() => { /* retried at scan time */ });
    const t = setInterval(() => setNow(new Date()), 1000);
    const g = setInterval(locate, 60000);
    return () => { clearInterval(t); clearInterval(g); };
  }, []);

  const near = pos ? nearestBranch(pos.lat, pos.lng, branches) : null;
  const inside = near && near.distanceM <= near.branch.radiusM;
  const allowed = workDay.allowed;
  const todaysShift = effectiveShift(me!, workDay.date, overrides);
  const shift = shifts.find(s => s.id === (todaysShift ?? me!.shiftId))!;
  const start = (kind: ScanKind) => setFlow({ kind, enroll: kind === 'in' && needsEnroll(me!) });

  const [chipTone, chipText] = locating ? ['', 'ກຳລັງຫາຕຳແໜ່ງ…']
    : manual ? ['warn', `ເລືອກເອງ: ${manual.name} (ລໍຫົວໜ້າກວດ)`]
    : inside ? ['ok', `${near!.branch.name} · ${Math.round(near!.distanceM)} ມ.`]
    : ['', pos ? `ບໍ່ພົບສາຂາໃກ້ຄຽງ (${near ? Math.round(near.distanceM) + ' ມ.' : ''})` : 'ບໍ່ມີ GPS'];
  const chip = (
    <button className={`loc-chip ${chipTone}`} aria-expanded={showMap} aria-controls="gps-panel" onClick={() => setShowMap(v => !v)}>
      <span className="grow">{chipText}</span>
      <span className="muted small" style={{ whiteSpace: 'nowrap' }}>{showMap ? 'ເຊື່ອງແຜນທີ່ ▲' : 'ເບິ່ງແຜນທີ່ ▼'}</span>
    </button>
  );

  return (
    <div className="screen" style={{ paddingTop: 0 }}>
      <div className={`id-card ${me!.photo ? 'has-photo' : ''}`} style={me!.photo ? { backgroundImage: `url(${me!.photo})` } : undefined} aria-label="ບັດພະນັກງານ">
        {!me!.photo && <span className="id-initial" aria-hidden="true">{initials(me!.name)}</span>}
        <div className="id-top">
          <span className="id-brand"><b>ST</b>ບັດພະນັກງານ</span>
          <span className="id-code">{me!.code}</span>
        </div>
        <div className="id-bottom">
          <div className="id-info">
            <b className="id-name">{me!.name}</b>
            <span>{me!.position}</span>
            <span className="id-meta">{me!.dept}{branches.find(x => x.id === me!.homeBranchId) ? ` · ${branches.find(x => x.id === me!.homeBranchId)!.name}` : ''}</span>
          </div>
          <div className="id-clock" role="timer" aria-label="ເວລາດຽວນີ້">
            <div className="clock-big">{now.toTimeString().slice(0, 5)}</div>
            <div className="clock-date">{laoDate(now)}</div>
          </div>
        </div>
      </div>
      {missed.length > 0 && (
        <div className="card col" role="alert" style={{ borderColor: '#f4b740', background: '#fff8e6' }}>
          <b>ເຈົ້າລືມລົງເວລາອອກ</b>
          {missed.map(d => (
            <div key={d} className="row"><span className="grow">ວັນທີ {d.split('-').reverse().join('/')}</span>
              {hrAll.requests.some(r => r.employeeId === me!.id && r.kind === 'clockFix' && r.status === 'pending' && (r.payload as { date: string; kind: string }).date === d && (r.payload as { kind: string }).kind === 'out')
                ? <span className="muted small">ສົ່ງຄຳຂໍແລ້ວ ລໍຫົວໜ້າ</span>
                : <button className="btn ghost" onClick={() => setFixing(d)}>ຂໍແກ້ເວລາອອກ</button>}</div>))}
        </div>)}
      {fixing && <RequestSheet kind="clockFix" initial={{ date: fixing, scanKind: 'out', time: shifts.find(s => s.id === (effectiveShift(me!, fixing, overrides) ?? me!.shiftId))?.end }} onClose={() => setFixing(null)} />}
      <div className="row">
        <Icon name="pin" size={26} />
        <div className="grow">{chip}</div>
        <button className="icon-btn dark" aria-label="ຫາຕຳແໜ່ງໃໝ່" onClick={locate}>
          <Icon name="refresh" size={22} />
        </button>
      </div>
      {showMap && (
        <div id="gps-panel" className="col">
          <MapCard branches={branches} pos={pos} />
          {!inside && !picking && <button className="btn ghost" onClick={() => setPicking(true)}>{pos ? 'ບໍ່ຢູ່ໃນສາຂາ — ເລືອກສາຂາເອງ' : 'ບໍ່ມີ GPS — ເລືອກສາຂາເອງ'}</button>}
          {manual && !picking && <button className="btn ghost" onClick={() => setManual(null)}>ໃຊ້ GPS ຄືເກົ່າ</button>}
          {picking && (
            <div className="card col">
              <b>ເລືອກສາຂາທີ່ເຈົ້າຢູ່</b>
              <span className="muted small">ການເລືອກເອງຈະຖືກສົ່ງໃຫ້ຫົວໜ້າກວດ</span>
              {branches.map(b => <button key={b.id} className="btn ghost" onClick={() => { setManual(b); setPicking(false); }}>{b.name}</button>)}
              {manual && <button className="btn ghost" onClick={() => { setManual(null); setPicking(false); }}>ໃຊ້ GPS ຄືເກົ່າ</button>}
              <button className="btn ghost" onClick={() => setPicking(false)}>ຍົກເລີກ</button>
            </div>
          )}
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
      <TimeCard date={new Date(workDay.date + 'T12:00:00')} scans={todays} shift={shift} />
      {flow?.enroll && <Enroll onDone={() => setFlow({ kind: flow.kind, enroll: false })} onSkip={() => setFlow({ kind: flow.kind, enroll: false })} onCancel={() => setFlow(null)} />}
      {flow && !flow.enroll && <ScanFlow kind={flow.kind} manualBranch={manual} onClose={() => setFlow(null)} />}
    </div>
  );
}

/** Expected vs actual for one day, in two halves like a punch card. */
function TimeCard({ date, scans, shift }: { date: Date; scans: ScanRecord[]; shift: { start: string; end: string; breakStart: string; breakEnd: string; name: string; flexible?: boolean } }) {
  const { settings } = useHR();
  const first = (k: ScanKind) => scans.find(s => s.kind === k && s.status !== 'rejected');
  const last = (k: ScanKind) => [...scans].reverse().find(s => s.kind === k && s.status !== 'rejected');
  const cell = (label: string, expected: string, s: ScanRecord | undefined, brkLabel: string, brkExpected: string, brk: ScanRecord | undefined, lateCheck: boolean) => {
    const late = lateCheck && !shift.flexible && s && (new Date(s.deviceTime).getHours() * 60 + new Date(s.deviceTime).getMinutes()) - (+expected.slice(0, 2) * 60 + +expected.slice(3)) > settings.graceMinutes;
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
      {cell('ເຂົ້າວຽກ', shift.flexible ? 'ຢືດຢຸ່ນ' : shift.start, first('in'), 'ເລີ່ມພັກ', shift.flexible ? '—' : shift.breakStart, first('breakStart'), true)}
      {cell('ອອກວຽກ', shift.flexible ? 'ຢືດຢຸ່ນ' : shift.end, last('out'), 'ເສັດພັກ', shift.flexible ? '—' : shift.breakEnd, last('breakEnd'), false)}
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
  const [legend, setLegend] = useState(false);
  const dayHead = useRef<HTMLDivElement>(null);
  const pick = (date: string) => { setSel(date); setTimeout(() => dayHead.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); }; // bring the chosen day and its actions into view
  const [doing, setDoing] = useState<DayAction | null>(null); // the request being made from the selected day
  const shift = shifts.find(s => s.id === me!.shiftId)!;
  const mine = scans.filter(s => s.employeeId === me!.id);
  const myLeaves = leaves.filter(l => l.employeeId === me!.id);
  // a night shift's after-midnight scans belong to the day it started
  const sessions = toSessions(mine, date => closesAtFor(date, shifts.find(x => x.id === effectiveShift(me!, date, hr.overrides))));
  const statusOf = (date: string) => {
    const start = lateStartOn(hr, me!, date);
    return dayStatus({
      date, today: ymd(now), startDate: me!.startDate, shiftStart: start, graceMinutes: settings.graceMinutes,
      dayOff: effectiveShift(me!, date, hr.overrides) ? [] : [new Date(date + 'T12:00:00').getDay()], holidays: settings.holidays ?? [], scans: scansOn(sessions, date), leaves: myLeaves
    });
  };
  const grid = monthGrid(ym.y, ym.m);
  const move = (d: number) => setYm(({ y, m }) => { const t = new Date(y, m + d, 1); return { y: t.getFullYear(), m: t.getMonth() }; });
  const selDate = new Date(sel + 'T12:00:00');
  const selScans = [...scansOn(sessions, sel), ...mine.filter(s => s.status === 'rejected' && ymd(new Date(s.deviceTime)) === sel)].sort((a, b) => a.deviceTime.localeCompare(b.deviceTime));
  const selStatus = statusOf(sel);
  const selLeave = myLeaves.find(l => (l.status === 'pending' || l.status === 'approved') && l.from <= sel && l.to >= sel);
  const dayActionsAll = dayActions({
    date: sel, today: ymd(now), startDate: me!.startDate, endDate: me!.endDate,
    isDayOff: !effectiveShift(me!, sel, hr.overrides), isHoliday: (settings.holidays ?? []).includes(sel),
    leave: selLeave ? { from: selLeave.from, to: selLeave.to, part: !!selLeave.part } : undefined
  });
  const ACTION_MENU: Partial<Record<DayAction, SelfMenu>> = { clockFix: 'clockFix', ot: 'ot', shiftSwap: 'shift', dayOffSwap: 'shift', schedule: 'schedule' };
  const actions = dayActionsAll.filter(a => !ACTION_MENU[a] || menuOn(ACTION_MENU[a]!, settings, me!.roles));
  const ACTION_ICON: Record<DayAction, IconName> = { leave: 'leave', leaveCancel: 'leaveCancel', shiftSwap: 'shift', dayOffSwap: 'shift', schedule: 'schedule', clockFix: 'clockFix', ot: 'ot' };
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
                onClick={() => pick(c.date)} aria-label={`${c.date}${style ? ' ' + style.label : ''}`} aria-pressed={c.date === sel}>
                <span>{+c.date.slice(8)}</span>
                {style && c.inMonth && <i className={`cal-dot ${style.cls}`} />}
              </button>
            );
          })}
        </div>
      </div>
      <div key={sel} className="stagger">
      <div ref={dayHead} className="row" style={{ alignItems: 'baseline', scrollMarginTop: 84 }}>
        <h2 className="grow">{laoDate(selDate)}</h2>
        {DAY_STYLE[selStatus] && <span className={`status-pill ${DAY_STYLE[selStatus]!.cls}`}>{DAY_STYLE[selStatus]!.label}</span>}
      </div>
      <TimeCard date={selDate} scans={selScans} shift={shift} />
      {actions.length > 0 && (
        <div className="card col" style={{ gap: 4, padding: '14px 10px' }}>
          <b style={{ padding: '0 10px 6px' }}>ເຮັດຫຍັງໄດ້ໃນມື້ນີ້</b>
          {actions.map(a => (
            <button key={a} className="day-action" onClick={() => setDoing(a)}>
              <span className="day-ico"><Icon name={ACTION_ICON[a]} size={22} /></span>
              <span className="col grow" style={{ gap: 0, textAlign: 'left' }}><b>{DAY_ACTION_TEXT[a].label}</b><span className="muted small">{DAY_ACTION_TEXT[a].hint}</span></span>
              <span className="muted" aria-hidden="true">›</span>
            </button>))}
        </div>)}
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
      {doing === 'leave' && <LeaveForm left={leaveBalance(hr, me!, ymd(now)).left} compLeft={compBalanceFor(hr, me!, ymd(now)).left} initialDate={sel} onClose={() => setDoing(null)} />}
      {doing && doing !== 'leave' && (
        <RequestSheet kind={doing} onClose={() => setDoing(null)}
          initial={{ date: sel, date2: sel, leaveId: selLeave?.id }} />
      )}
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
  const comp = compBalanceFor(hr, me!, today);
  const mine = leaves.filter(l => l.employeeId === me!.id).sort((a, b) => b.from.localeCompare(a.from));
  const shown = tab === 'all' ? mine : mine.filter(l => l.status === tab);
  const subs: [typeof tab, string][] = [['pending', 'ລໍຖ້າ'], ['approved', 'ອະນຸມັດແລ້ວ'], ['rejected', 'ບໍ່ອະນຸມັດ'], ['all', 'ທັງໝົດ']];
  const pill = (s: string) => <span className={`status-pill ${s}`}>{s === 'approved' ? 'ອະນຸມັດແລ້ວ' : s === 'rejected' ? 'ບໍ່ອະນຸມັດ' : 'ລໍອະນຸມັດ'}</span>;
  return (
    <>
      <nav className="subtabs" role="tablist">
        {subs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
      </nav>
      <div className="screen" style={{ paddingTop: 12 }}>
        <div className="card col" style={{ gap: 0 }}>
          <b>ມື້ລາຄົງເຫຼືອ ປີ {new Date().getFullYear()}</b>
          <div className="row" style={{ minHeight: 48, background: 'var(--ok-bg)', borderRadius: 12, padding: '0 12px', marginTop: 8 }}>
            <span className="grow">ລາພັກປະຈຳປີ <span className="muted small">(ໄດ້ {Math.round((bal.earned + bal.carried) * 100) / 100} · ໃຊ້ແລ້ວ {bal.used})</span></span><b style={{ fontSize: 22 }}>{bal.left} ມື້</b>
          </div>
          {([['sick', 'ລາປ່ວຍ'], ['personal', 'ລາກິດ'], ['unpaid', 'ລາບໍ່ຮັບເງິນເດືອນ']] as const).map(([t, label]) => {
            const b = capBalance(t, leaves, me!.id, new Date().getFullYear(), hr.settings);
            return (
              <div key={t} className="row" style={{ minHeight: 44, borderTop: '1px solid var(--line)' }}>
                <span className="grow">{label} <span className="muted small">{b.quota === null ? `(ໃຊ້ແລ້ວ ${b.used} ມື້ · ບໍ່ຈຳກັດ)` : `(ໃຊ້ແລ້ວ ${b.used} ຈາກ ${b.quota})`}</span></span>
                {b.left !== null && <b style={{ fontSize: 18 }}>{b.left} ມື້</b>}
              </div>
            );
          })}
          {(comp.earned > 0 || comp.left > 0) && <div className="row" style={{ minHeight: 44, borderTop: '1px solid var(--line)' }}><span className="grow">ພັກຊົດເຊີຍ <span className="muted small">(ມາເຮັດວຽກວັນພັກລັດຖະການ{comp.expired ? ` · ໝົດອາຍຸແລ້ວ ${comp.expired}` : ''})</span></span><b style={{ fontSize: 18 }}>{comp.left} ມື້</b></div>}
        </div>
        {shown.length === 0 && <div className="empty">ບໍ່ມີລາຍການ<br /><span className="small">ກົດ + ເພື່ອຂໍລາ</span></div>}
        {shown.map(l => (
          <div key={l.id} className="card row" style={{ alignItems: 'flex-start' }}>
            <span className="avatar big">{initials(me!.name)}</span>
            <div className="col grow" style={{ gap: 2 }}>
              <b style={{ fontSize: 17 }}>{l.reason}</b>
              <span>{LEAVE_TYPES[l.type]} · {leaveSpan(l)}</span>
              {l.approverId && <span className="muted small">ສົ່ງຫາ {hr.employees.find(x => x.id === l.approverId)?.name ?? '—'}</span>}
              <span className="muted small">{l.from.split('-').reverse().join('/')}{l.to !== l.from ? ` - ${l.to.split('-').reverse().join('/')}` : ''}</span>
              <div style={{ marginTop: 4 }}>{pill(l.status)}</div>
            </div>
          </div>
        ))}
      </div>
      <button className="fab" aria-label="ຂໍລາໃໝ່" onClick={() => setForm(true)}>+</button>
      {form && <LeaveForm left={bal.left} compLeft={comp.left} onClose={() => setForm(false)} />}
    </>
  );
}

function LeaveForm({ left, compLeft, initialDate, onClose: closeNow }: { left: number; compLeft: number; initialDate?: string; onClose: () => void }) {
  const { me, save, settings, leaves, shifts, overrides, employees, notify } = useHR();
  const { closing, close: onClose } = useClosing(closeNow);
  const year = new Date().getFullYear();
  const sick = capBalance('sick', leaves, me!.id, year, settings), personal = capBalance('personal', leaves, me!.id, year, settings);
  // who this can be sent to: the department head first; the one picked is told straight away and sees it at the top of their list
  const approvers = useMemo(() => leaveApprovers(employees, settings, me!.id), [employees, settings, me]);
  const [approverId, setApproverId] = useState(approvers[0]?.id ?? '');
  const leftOf = (t: LeaveType): number | null => (t === 'annual' ? left : t === 'comp' ? compLeft : t === 'sick' ? sick.left : t === 'personal' ? personal.left : null);
  const today = ymd(new Date());
  const [type, setType] = useState<LeaveType>('annual');
  const [from, setFrom] = useState(initialDate ?? today);
  const [to, setTo] = useState(initialDate ?? today);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [part, setPart] = useState<LeavePart | 'full'>('full');
  const [hours, setHours] = useState('2');
  const shift = shifts.find(s => s.id === (effectiveShift(me!, from, overrides) ?? me!.shiftId)) ?? shifts[0];
  const paidHours = shiftPaidHours(shift);
  const partial = part !== 'full';
  const hoursNum = Number(hours);
  const days = partial
    ? partialDays(part as LeavePart, part === 'hours' ? hoursNum : undefined, paidHours) // a part-day leave is one day: the end date is ignored
    : from && to && to >= from ? leaveDays(from, to, me!.dayOff ?? [0], settings.holidays) : 0;
  const pickPart = (p: LeavePart | 'full') => { setPart(p); if (p !== 'full') setTo(from); };
  const submit = async () => {
    setErr('');
    const ask = { type, from, to: partial ? from : to, days, part: partial ? (part as LeavePart) : undefined, hours: part === 'hours' ? hoursNum : undefined };
    const block = leaveRequestBlock(ask, { existing: leaves.filter(l => l.employeeId === me!.id), paidHours, weeklyOff: me!.dayOff ?? [0], holidays: settings.holidays, annualLeft: left, compLeft, sickLeft: sick.left, personalLeft: personal.left });
    if (block) return setErr(block);
    if (!reason.trim()) return setErr('ກະລຸນາໃສ່ເຫດຜົນ');
    const req: LeaveRequest = { id: uid(), companyId: me!.companyId, employeeId: me!.id, type, from, to: ask.to, days, ...(ask.part ? { part: ask.part } : {}), ...(ask.part === 'hours' ? { hours: hoursNum } : {}), reason: reason.trim(), createdAt: new Date().toISOString(), approvals: [], status: 'pending', ...(approverId ? { approverId } : {}) };
    await save('leaves', req, 'leave-request');
    // the person it was sent to (or, when nobody was picked, everyone who could decide) is told
    await notify(approverId ? [approverId] : approvers.map(a => a.id), `${me!.name} ຂໍ${LEAVE_TYPES[type]} ${leaveSpan(req)} (${from.split('-').reverse().join('/')}${to !== from ? ' - ' + to.split('-').reverse().join('/') : ''})${approverId ? ' — ສົ່ງຫາທ່ານ' : ''}`, 'leave').catch(() => { /* the request is saved; the approver still sees it in their list */ });
    onClose();
  };
  return (
    <div className={`sheet-back${closing ? ' closing' : ''}`} onClick={onClose}>
      <div className="sheet col" onClick={e => e.stopPropagation()} role="dialog" aria-label="ຂໍລາ">
        <h2>ຂໍລາ</h2>
        <div className="col" style={{ gap: 6 }}><span className="muted small">ປະເພດການລາ</span>
        <div className="row wrap">{(['annual', 'sick', 'personal', 'unpaid', 'comp'] as LeaveType[]).filter(t => t !== 'comp' || compLeft > 0).map(t => (
          <button key={t} className={`btn ${type === t ? '' : 'ghost'}`} onClick={() => setType(t)} aria-pressed={type === t}>{LEAVE_TYPES[t]}{leftOf(t) !== null ? ` · ເຫຼືອ ${leftOf(t)}` : ''}</button>))}</div></div>
        <div className="col" style={{ gap: 6 }}><span className="muted small">ລາເທົ່າໃດ</span>
        <div className="row wrap">{([['full', 'ເຕັມວັນ'], ['am', PART_LABEL.am], ['pm', PART_LABEL.pm], ['hours', PART_LABEL.hours]] as [LeavePart | 'full', string][]).map(([p, label]) => (
          <button key={p} className={`btn ${part === p ? '' : 'ghost'}`} onClick={() => pickPart(p)} aria-pressed={part === p}>{label}</button>))}</div></div>
        <div className="row"><label className="field grow">{partial ? 'ວັນທີ' : 'ແຕ່ວັນທີ'}<input className="input" type="date" value={from} onChange={e => { setFrom(e.target.value); if (partial) setTo(e.target.value); }} /></label>
          {!partial && <label className="field grow">ຫາວັນທີ<input className="input" type="date" value={to} onChange={e => setTo(e.target.value)} /></label>}
          {part === 'hours' && <label className="field" style={{ width: 110 }}>ຊົ່ວໂມງ<input className="input" inputMode="decimal" value={hours} onChange={e => setHours(e.target.value.replace(/[^\d.]/g, ''))} /></label>}</div>
        <span className="muted small">{partial ? `ນັບ ${days} ມື້ (ກະຂອງເຈົ້າເຮັດວຽກ ${paidHours} ຊມ/ມື້)` : `ລວມ ${days} ມື້ເຮັດວຽກ`}</span>
        <label className="field">ເຫດຜົນ<input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="ເຊັ່ນ: ໄປໂຮງໝໍ" /></label>
        {approvers.length > 0 ? <label className="field">ສົ່ງຫາຜູ້ອະນຸມັດ<select className="input" value={approverId} onChange={e => setApproverId(e.target.value)}>{approvers.map(a => <option key={a.id} value={a.id}>{a.name} · {ROLE_NAMES[a.roles.find(r => settings.leaveApproverRoles.includes(r)) ?? 'head']}</option>)}</select></label> : <span className="muted small">ຍັງບໍ່ມີຜູ້ອະນຸມັດທີ່ກຳນົດໄວ້ — ຄຳຂໍຈະລໍຢູ່ໃນລະບົບ</span>}
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
  const sum = summarize(hr, me, key, !!run?.lateConfirmed.includes(me.id));
  const s = sum.slip;
  const [printing, setPrinting] = useState(false);
  const line = (k: string, v: number, neg = false) => <div className="row"><span className="grow">{k}</span><b style={{ color: neg && v ? 'var(--bad)' : undefined }}>{neg && v ? '−' : ''}{money(v)}</b></div>;
  return (
    <div className="screen">
      <span className="muted small">{laoMonth(new Date().getFullYear(), new Date().getMonth())} · ຕົວເລກປະມານການ ຈົນກວ່າ HR ຈະລັອກງວດ</span>
      <div className="card col">
        <span className="muted small">ລາຍຮັບ</span>
        {line('ເງິນເດືອນພື້ນຖານ', s.base)}{line('ຄ່າລ່ວງເວລາ (OT)', s.ot)}{line('ເບ້ຍລ້ຽງ', s.allowance)}
        {s.shiftAllowance > 0 && line('ເບ້ຍລ້ຽງຕາມກະ', s.shiftAllowance)}{s.bonus > 0 && line('ໂບນັດ', s.bonus)}{s.commission > 0 && line('ຄອມມິດຊັນ', s.commission)}{s.otherPay > 0 && line('ລາຍຮັບອື່ນໆ', s.otherPay)}{s.extraNonTaxable > 0 && line('ລາຍຮັບອື່ນ (ບໍ່ເສຍພາສີ)', s.extraNonTaxable)}
        <span className="muted small">ລາຍຫັກ</span>
        {line('ມາຊ້າ', s.lateDeduction, true)}{line('ລາບໍ່ຮັບເງິນເດືອນ', s.unpaidLeave, true)}{line('ປະກັນສັງຄົມ', s.socialSecurity, true)}{line('ອາກອນລາຍໄດ້', s.tax, true)}{line('ເບີກລ່ວງໜ້າ', s.advance, true)}
      </div>
      <div className="card dark row"><span className="grow" style={{ color: '#9fd8d4' }}>ຮັບສຸດທິ</span><span className="big-num">{money(s.net)} <span style={{ fontSize: 16, color: 'var(--mint-ink)' }}>₭</span></span></div>
      <button className="btn ghost" onClick={() => setPrinting(true)}>ພິມ / ບັນທຶກ PDF</button>
      {printing && <PayslipView data={sum} monthLabel={laoMonth(new Date().getFullYear(), new Date().getMonth())} final={run?.status === 'locked'} onClose={() => setPrinting(false)} />}
    </div>
  );
}

/* ------------------------------ ສະແກນໜ້າ ------------------------------ */

/** Consent, then the face from three angles (front, then turned each way); each angle is a few captures averaged into one descriptor. */
function Enroll({ onDone, onSkip, onCancel: cancelNow }: { onDone: () => void; onSkip: () => void; onCancel: () => void }) {
  const { closing, close: onCancel } = useClosing(cancelNow, 280);
  const { me, save, settings } = useHR();
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
      const done: number[][] = []; // one averaged descriptor per pose that worked
      let firstSideYaw: number | undefined;
      for (const [n, pose] of POSES.entries()) {
        const samples: number[][] = [];
        const front = pose.id === 'front';
        let tip = ''; // what is wrong with the picture, once it has been wrong for a few tries
        for (let tries = 0; samples.length < SAMPLES_PER_POSE && tries < (front ? 30 : 45) && !cancelled.current; tries++) {
          setMsg(tip || `ທ່າ ${n + 1}/${POSES.length}: ${pose.hint}`);
          const look = await readFrame(video.current!);
          const f = look.face;
          if (!f && tries >= 2) { const issue = frameAdvice(look.stats, null); tip = issue ? ISSUE_TEXT[issue] : ''; } else if (f) tip = '';
          if (f && poseOk(pose.id, f.yaw, firstSideYaw)) {
            samples.push(f.descriptor);
            if (!front && firstSideYaw === undefined) firstSideYaw = f.yaw;
          }
          await new Promise(r => setTimeout(r, 300));
        }
        if (cancelled.current) return;
        if (samples.length < SAMPLES_PER_POSE) {
          if (front) throw new Error(tip || 'ຫາໃບໜ້າບໍ່ເຫັນ ລອງໄປບ່ອນແຈ້ງກວ່ານີ້');
          continue; // a side pose that did not work is skipped; the face is still saved with the poses that did
        }
        done.push(averageDescriptors(samples));
        setMsg(`ໄດ້ທ່າ ${n + 1}/${POSES.length} ແລ້ວ ✓`);
        await new Promise(r => setTimeout(r, 700));
      }
      setPhase('saving');
      // enrolling on a phone with no phone bound yet also binds that phone; a re-enrolment replaces every pose and uses up the approval
      await save('employees', { ...me!, faceEnrolled: done[0], facePoses: done.length > 1 ? done.slice(1) : undefined, faceReenroll: undefined, faceConsentAt: new Date().toISOString(), ...(me!.deviceId ? {} : { deviceId: getDeviceId(), deviceBoundAt: new Date().toISOString() }) }, 'face-enroll');
      stopCamera(stream.current);
      onDone();
    } catch (e: any) {
      setError(e?.name === 'NotAllowedError' ? 'ບໍ່ໄດ້ອະນຸຍາດໃຫ້ໃຊ້ກ້ອງ' : e?.message || 'ເປີດກ້ອງບໍ່ໄດ້');
      stopCamera(stream.current);
      setPhase('consent');
    }
  };

  return (
    <div className={`fullscreen scan${closing ? ' closing' : ''}`}>
      <h1 style={{ fontSize: 28 }}>ລົງທະບຽນໃບໜ້າ</h1>
      {phase === 'consent' ? (
        <div className="col" style={{ maxWidth: 420, width: '100%' }}>
          <p style={{ fontSize: 17, color: '#cdebe8', margin: 0 }}>ເຮັດເທື່ອດຽວ ບໍ່ເຖິງ 1 ນາທີ: ຖ່າຍ {POSES.length} ທ່າ (ມອງຕົງ ແລ້ວຫັນໜ້າເລັກນ້ອຍທາງຊ້າຍ ແລະ ທາງຂວາ) ເພື່ອໃຫ້ສະແກນຕິດງ່າຍ ເຖິງໜ້າປ່ຽນໄປເລັກນ້ອຍ. ແອັບຈະຈື່ໜ້າເພື່ອລົງເວລາເຂົ້າ-ອອກວຽກເທົ່ານັ້ນ.</p>
          <div className="card" style={{ background: 'rgba(255,255,255,.07)', color: '#fff', fontSize: 14 }}>
            • ເກັບຮູບຕອນສະແກນໄວ້ {retentionLabel(settings.photoRetentionDays)} ແລ້ວລຶບອັດຕະໂນມັດ<br />• ໃຊ້ສະເພາະການລົງເວລາ, ບໍ່ສົ່ງໃຫ້ຄົນນອກ<br />• ຖອນຄວາມຍິນຍອມໄດ້ທຸກເວລາ ໃນເມນູ ຕັ້ງຄ່າ
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

function ScanFlow({ kind, manualBranch, onClose: closeNow }: { kind: ScanKind; manualBranch: Branch | null; onClose: () => void }) {
  const { closing, close: onClose } = useClosing(closeNow, 280);
  const { me, branches, settings, save } = useHR();
  const video = useRef<HTMLVideoElement>(null);
  const run = useRef({ cancelled: false, stream: null as MediaStream | null });
  const [face, setFace] = useState<Check>('wait');
  const [gps, setGps] = useState<Check>('wait');
  const [gpsLabel, setGpsLabel] = useState('ກຳລັງກວດບ່ອນຢູ່…');
  const [hint, setHint] = useState(''); // what to fix when the face is not being found or matched
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
      const seen: number[] = []; // each frame's best match: the person passes only when several frames agree, not on one lucky frame
      let photo: string | undefined;
      try {
        self.stream = await openFrontCamera(video.current!);
        if (self.cancelled) { stopCamera(self.stream); return; }
        await loadFaceModels();
        for (let i = 0; i < 20 && !self.cancelled; i++) {
          const look = await readFrame(video.current!);
          const d = look.face?.descriptor;
          if (d && faceTemplates(me!).length) {
            seen.push(bestFaceScore(d, me!) ?? 0);
            score = consensusScore(seen);
            photo = snapshot(video.current!);
            if (seen.length >= FACE_FRAMES && score! >= settings.faceMinScore) { setHint(''); break; }
          }
          if (i >= 2) { const issue = frameAdvice(look.stats, look.face?.faceFrac ?? null); setHint(issue ? ISSUE_TEXT[issue] : ''); }
          await new Promise(r => setTimeout(r, 250));
        }
      } catch { /* camera denied or unavailable → face stays null, scan goes to review */ }
      stopCamera(self.stream);
      if (self.cancelled) return;
      setFace(score != null && score >= settings.faceMinScore ? 'ok' : 'no');

      const pos = await posP;
      if (self.cancelled) return;
      const offline = !navigator.onLine;
      // offline: the server cannot confirm the clock yet, so the check is repeated when the scan is synced
      const thisDevice = getDeviceId();
      const v = evaluateScan({ gps: pos, faceScore: score, deviceTime, serverTime: offline ? deviceTime : new Date(), manualBranch, device: { bound: me!.deviceId, current: thisDevice } }, branches, settings);
      const branch = branches.find(b => b.id === v.branchId);
      const gpsBad = !!manualBranch || v.reasons.some(r => r.startsWith('ຢູ່ໄກ') || r.startsWith('ບໍ່ມີ GPS'));
      setGps(gpsBad ? 'no' : 'ok');
      setGpsLabel(manualBranch ? `ເລືອກເອງ: ${manualBranch.name}` : !pos ? 'ບໍ່ມີ GPS' : gpsBad ? `ຢູ່ໄກຮ້ານ ${v.distanceM} ມ.` : `ຢູ່ໃນຮ້ານ · ${branch?.name}`);
      const rec: ScanRecord = {
        id: uid(), companyId: me!.companyId, employeeId: me!.id, kind, deviceTime: deviceTime.toISOString(),
        serverTime: offline ? undefined : new Date().toISOString(), branchId: v.branchId, lat: pos?.lat, lng: pos?.lng,
        distanceM: v.distanceM, faceScore: score ?? undefined, photo, status: v.ok ? 'ok' : 'pending', reasons: v.reasons, offline, manual: !!manualBranch, deviceId: thisDevice
      };
      // the first phone an account is used on becomes its phone
      if (!me!.deviceId) await save('employees', { ...me!, deviceId: thisDevice, deviceBoundAt: new Date().toISOString() }, 'device-bind');
      pending.current = rec;
      await commit(rec, self);
    })();
    return () => { self.cancelled = true; stopCamera(self.stream); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The scan must never vanish silently: if saving fails (storage full…), keep it in memory and let the user retry.
  const pending = useRef<ScanRecord | null>(null);
  const [saveErr, setSaveErr] = useState('');
  const commit = async (rec: ScanRecord, self: { cancelled: boolean }) => {
    try {
      await save('scans', rec, 'clock-' + kind);
      setSaveErr('');
      setTimeout(() => !self.cancelled && setResult(rec), 600);
    } catch (e: any) {
      setSaveErr(e?.message || 'ບັນທຶກບໍ່ໄດ້');
    }
  };

  if (saveErr) {
    return (
      <div className={`fullscreen result${closing ? ' closing' : ''}`} style={{ background: '#fee2e2', color: '#7f1d1d' }}>
        <div className="col grow result">
          <span className="circle" style={{ background: '#dc2626', boxShadow: '0 0 0 16px rgba(220,38,38,.2)', color: '#fff', fontSize: 72, fontWeight: 800 }}>!</span>
          <span className="t1" role="alert" style={{ marginTop: 18 }}>ບັນທຶກບໍ່ສຳເລັດ</span>
          <span style={{ fontSize: 18 }}>{saveErr}</span>
          <span style={{ fontSize: 16 }}>ເວລາ {pending.current ? hhmm(pending.current.deviceTime) : ''} ຍັງຢູ່ໃນແອັບ — ກົດລອງໃໝ່</span>
        </div>
        <button className="btn block" style={{ background: '#dc2626' }} onClick={() => pending.current && commit(pending.current, run.current)}>ລອງບັນທຶກໃໝ່</button>
        <button className="btn block ghost" style={{ color: '#7f1d1d', borderColor: '#7f1d1d' }} onClick={onClose}>ປິດ (ບໍ່ບັນທຶກ)</button>
      </div>
    );
  }

  if (result) {
    if (result.status === 'ok') {
      return (
        <div className={`fullscreen result${closing ? ' closing' : ''}`} style={{ background: color, color: '#fff' }}>
          <div className="col grow result">
            <span className="circle" style={{ background: '#fff', color }}><Tick size={84} /></span>
            <span className="t1" role="status" style={{ marginTop: 18 }}>{KIND_LABEL[kind]}ແລ້ວ!</span>
            <span className="t2">{hhmm(result.deviceTime)}</span>
            <span style={{ fontSize: 18 }}>{kind === 'in' ? 'ສູ້ໆ ມື້ນີ້!' : kind === 'out' ? 'ພັກຜ່ອນໃຫ້ດີ ພົບກັນມື້ອື່ນ' : ''}</span>
            {result.offline && <span className="pill" style={{ background: 'rgba(255,255,255,.2)', color: '#fff', height: 'auto', padding: '8px 14px', whiteSpace: 'normal', fontSize: 15 }}>ບໍ່ມີເນັດ — ບັນທຶກໄວ້ໃນເຄື່ອງແລ້ວ ຈະສົ່ງເມື່ອມີເນັດ</span>}
          </div>
          <button className="btn block" style={{ background: '#fff', color }} onClick={onClose}>ຕົກລົງ</button>
        </div>
      );
    }
    return (
      <div className={`fullscreen result${closing ? ' closing' : ''}`} style={{ background: 'var(--warn-bg)', color: '#3b2600' }}>
        <div className="col grow result">
          <span className="circle" style={{ background: 'var(--warn)', boxShadow: '0 0 0 16px rgba(244,183,64,.3)' }}>
            <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" /></svg>
          </span>
          <span className="t1" role="status" style={{ marginTop: 18 }}>ບັນທຶກແລ້ວ</span>
          <b style={{ fontSize: 22 }}>ລໍຫົວໜ້າກວດ</b>
          <div className="row wrap" style={{ justifyContent: 'center' }}>{result.reasons.map(r => <span key={r} className="pill" style={{ background: '#fff', color: 'var(--warn)', height: 36, fontSize: 15 }}>{r}</span>)}</div>
          <span style={{ fontSize: 18 }}>ບໍ່ຕ້ອງເປັນຫ່ວງ<br />ເວລາ {hhmm(result.deviceTime)} ຂອງເຈົ້າຖືກບັນທຶກໄວ້ແລ້ວ</span>
          {hint && <span style={{ fontSize: 16 }}>ເທື່ອຕໍ່ໄປ: {hint}</span>}
          {result.offline && <span className="pill" style={{ background: '#fff', color: 'var(--warn)', height: 'auto', padding: '8px 14px', whiteSpace: 'normal', fontSize: 15 }}>ບໍ່ມີເນັດ — ຈະສົ່ງເມື່ອມີເນັດ</span>}
        </div>
        <button className="btn block" style={{ background: 'var(--warn)' }} onClick={onClose}>ຕົກລົງ</button>
      </div>
    );
  }

  return (
    <div className={`fullscreen scan${closing ? ' closing' : ''}`}>
      <span className="pill" style={{ height: 40, fontSize: 16, padding: '0 16px', background: color, color: '#fff' }}>ກຳລັງ: {KIND_LABEL[kind]}</span>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 28, fontWeight: 800 }}>ສ່ອງໜ້າໃສ່ວົງມົນ</div>
        <div style={{ fontSize: 17, color: '#cdebe8' }}>ຖືໂທລະສັບໄວ້ຕໍ່ໜ້າ ໃຫ້ເຫັນໜ້າຊັດໆ</div>
      </div>
      <div className={`facering ${face === 'ok' ? 'ok' : ''}`}><video ref={video} playsInline muted /></div>
      <div className="col" style={{ width: '100%', maxWidth: 420 }}>
        <div className="check"><span className={`dot ${face}`}>{face === 'ok' && <Tick />}{face === 'no' && '!'}</span>{face === 'wait' ? 'ກຳລັງຊອກໃບໜ້າ…' : face === 'ok' ? 'ພົບໃບໜ້າແລ້ວ' : 'ໜ້າບໍ່ຊັດ'}</div>
        {hint && face === 'wait' && <div className="check" role="status" style={{ background: 'rgba(244,183,64,.2)', borderRadius: 12 }}><span className="dot no">!</span>{hint}</div>}
        <div className="check"><span className={`dot ${gps}`}>{gps === 'ok' && <Tick />}{gps === 'no' && '!'}</span>{gpsLabel}</div>
      </div>
      <div style={{ flex: 1 }} />
      <button className="btn block ghost" style={{ background: 'transparent', color: '#fff', borderColor: 'var(--mint)', maxWidth: 420 }}
        onClick={() => { run.current.cancelled = true; stopCamera(run.current.stream); onClose(); }}>ຍົກເລີກ</button>
    </div>
  );
}
