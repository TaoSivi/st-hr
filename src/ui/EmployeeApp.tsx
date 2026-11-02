import { useEffect, useRef, useState } from 'react';
import { useHR } from '../app/state';
import { uid } from '../data/store';
import type { Advance, LeaveRequest, LeaveType, ScanKind, ScanRecord } from '../domain/types';
import { evaluateScan } from '../domain/attendance';
import { leaveDays } from '../domain/leave';
import { maxAdvance } from '../domain/payroll';
import { describeFace, loadFaceModels, matchScore, openFrontCamera, snapshot, stopCamera } from '../device/face';
import { getPosition } from '../device/geo';
import { leaveBalance, monthKey, summarize } from '../app/payrun';
import { hhmm, initials, laoDate, LEAVE_TYPES, money, sameDay, ymd } from './format';

const IconIn = () => <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" /></svg>;
const IconOut = () => <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>;
const Tick = ({ color = 'currentColor', size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;

type Tab = 'home' | 'leave' | 'pay';

export default function EmployeeApp({ onSwitch }: { onSwitch: () => void }) {
  const [tab, setTab] = useState<Tab>('home');
  return (
    <div className="phone">
      {tab === 'home' && <Home onSwitch={onSwitch} />}
      {tab === 'leave' && <Leave />}
      {tab === 'pay' && <Pay />}
      <nav className="tabbar" aria-label="ເມນູພະນັກງານ">
        <button aria-current={tab === 'home' ? 'page' : undefined} onClick={() => setTab('home')}>ລົງເວລາ</button>
        <button aria-current={tab === 'leave' ? 'page' : undefined} onClick={() => setTab('leave')}>ລາພັກ / ເບີກ</button>
        <button aria-current={tab === 'pay' ? 'page' : undefined} onClick={() => setTab('pay')}>ເງິນເດືອນ</button>
      </nav>
    </div>
  );
}

function Home({ onSwitch }: { onSwitch: () => void }) {
  const { me, scans, shifts } = useHR();
  const [now, setNow] = useState(new Date());
  const [flow, setFlow] = useState<null | 'enroll' | ScanKind>(null);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);
  if (!me) return null;

  const today = scans.filter(s => s.employeeId === me.id && sameDay(s.deviceTime, now)).sort((a, b) => a.deviceTime.localeCompare(b.deviceTime));
  const last = today[today.length - 1];
  const clockedIn = last?.kind === 'in';
  const firstIn = today.find(s => s.kind === 'in');
  const lastOut = [...today].reverse().find(s => s.kind === 'out');
  const shift = shifts.find(s => s.id === me.shiftId)!;
  const next: ScanKind = clockedIn ? 'out' : 'in';

  return (
    <div className="screen">
      <div className="row">
        <span className="logo" style={{ width: 56, height: 56, borderRadius: 18, background: 'var(--mint)', fontSize: 20 }}>{initials(me.name)}</span>
        <div className="col grow" style={{ gap: 0 }}>
          <span className="muted">ສະບາຍດີ</span>
          <b style={{ fontSize: 24 }}>{me.name}</b>
        </div>
        <button className="btn ghost" onClick={onSwitch} style={{ minHeight: 40, padding: '0 12px', fontSize: 13 }}>ປ່ຽນຜູ້ໃຊ້</button>
      </div>
      <div className="card row">
        <div className="col grow" style={{ gap: 0 }}>
          <span style={{ fontSize: 50, fontWeight: 800, letterSpacing: -2, lineHeight: 1 }}>{hhmm(now.toISOString())}</span>
          <span className="muted">{laoDate(now)}</span>
        </div>
        <span className="pill ok" style={{ height: 34, fontSize: 14 }}>{shift.name} {shift.start}</span>
      </div>
      <div className="col" style={{ alignItems: 'center', padding: '18px 0', gap: 22 }}>
        <button className={`bigbtn ${next}`} onClick={() => setFlow(me.faceEnrolled ? next : 'enroll')} aria-label={`${next === 'in' ? 'ເຂົ້າວຽກ' : 'ອອກວຽກ'} ກົດເພື່ອສະແກນໜ້າ`}>
          {next === 'in' ? <IconIn /> : <IconOut />}
          <span className="lbl">{next === 'in' ? 'ເຂົ້າວຽກ' : 'ອອກວຽກ'}</span>
          <span style={{ fontWeight: 600, opacity: .9 }}>ກົດບ່ອນນີ້</span>
        </button>
        <span className={`pill ${clockedIn ? 'dark' : 'ok'}`} style={{ height: 40, fontSize: 16, padding: '0 16px' }}>
          {clockedIn ? `ກຳລັງເຮັດວຽກ · ເຂົ້າ ${hhmm(last.deviceTime)}` : last ? 'ເລີກວຽກແລ້ວ' : 'ຍັງບໍ່ທັນເຂົ້າວຽກ'}
        </span>
      </div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card"><span className="muted small">ເຂົ້າ</span><div className="big-num" style={{ fontSize: 24 }}>{firstIn ? hhmm(firstIn.deviceTime) : '—'}</div></div>
        <div className="card"><span className="muted small">ອອກ</span><div className="big-num" style={{ fontSize: 24 }}>{lastOut ? hhmm(lastOut.deviceTime) : '—'}</div></div>
      </div>
      {today.some(s => s.status === 'pending') && <div className="pill warn" style={{ height: 'auto', padding: '8px 12px', whiteSpace: 'normal' }}>ມີການລົງເວລາທີ່ລໍຫົວໜ້າກວດ</div>}
      {flow === 'enroll' && <Enroll onDone={() => setFlow(next)} onSkip={() => setFlow(next)} onCancel={() => setFlow(null)} />}
      {(flow === 'in' || flow === 'out') && <ScanFlow kind={flow} onClose={() => setFlow(null)} />}
    </div>
  );
}

/** Consent + 3 captures averaged into the enrolled descriptor. */
function Enroll({ onDone, onSkip, onCancel }: { onDone: () => void; onSkip: () => void; onCancel: () => void }) {
  const { me, save } = useHR();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [phase, setPhase] = useState<'consent' | 'camera' | 'saving'>('consent');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => () => stopCamera(stream.current), []);

  const start = async () => {
    setPhase('camera');
    setError('');
    try {
      stream.current = await openFrontCamera(video.current!);
      setMsg('ກຳລັງກຽມ…');
      await loadFaceModels();
      const samples: number[][] = [];
      for (let tries = 0; samples.length < 3 && tries < 30; tries++) {
        setMsg(`ຖືໃຫ້ນິ່ງໆ… ${samples.length}/3`);
        const d = await describeFace(video.current!);
        if (d) samples.push(d);
        await new Promise(r => setTimeout(r, 300));
      }
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
        <div className="check" style={{ maxWidth: 420 }}><span className="dot wait" />{phase === 'saving' ? 'ກຳລັງບັນທຶກ…' : msg}</div>
      )}
      {/* one video element for the whole flow, so the ref is valid before the camera opens */}
      <div className="facering" style={{ display: phase === 'consent' ? 'none' : undefined }}><video ref={video} playsInline muted /></div>
    </div>
  );
}

type Check = 'wait' | 'ok' | 'no';

function ScanFlow({ kind, onClose }: { kind: ScanKind; onClose: () => void }) {
  const { me, branches, settings, save } = useHR();
  const video = useRef<HTMLVideoElement>(null);
  const run = useRef({ cancelled: false, stream: null as MediaStream | null });
  const [face, setFace] = useState<Check>('wait');
  const [gps, setGps] = useState<Check>('wait');
  const [gpsLabel, setGpsLabel] = useState('ກຳລັງກວດບ່ອນຢູ່…');
  const [result, setResult] = useState<ScanRecord | null>(null);

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
      const branch = branches.find(b => b.id === v.branchId);
      const gpsBad = v.reasons.some(r => r.startsWith('ຢູ່ໄກ') || r.startsWith('ບໍ່ມີ GPS'));
      setGps(gpsBad ? 'no' : 'ok');
      setGpsLabel(!pos ? 'ບໍ່ມີ GPS' : gpsBad ? `ຢູ່ໄກຮ້ານ ${v.distanceM} ມ.` : `ຢູ່ໃນຮ້ານ · ${branch?.name}`);
      const rec: ScanRecord = {
        id: uid(), companyId: me!.companyId, employeeId: me!.id, kind, deviceTime: deviceTime.toISOString(),
        serverTime: offline ? undefined : new Date().toISOString(), branchId: v.branchId, lat: pos?.lat, lng: pos?.lng,
        distanceM: v.distanceM, faceScore: score ?? undefined, photo, status: v.ok ? 'ok' : 'pending', reasons: v.reasons, offline
      };
      await save('scans', rec, kind === 'in' ? 'clock-in' : 'clock-out');
      setTimeout(() => !self.cancelled && setResult(rec), 600);
    })();
    return () => { self.cancelled = true; stopCamera(self.stream); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (result) {
    const okColor = kind === 'in' ? 'var(--primary)' : 'var(--out)';
    if (result.status === 'ok') {
      return (
        <div className="fullscreen result" style={{ background: okColor, color: '#fff' }}>
          <div className="col grow result">
            <span className="circle" style={{ background: '#fff' }}><Tick color={kind === 'in' ? '#0A7E7A' : '#c2410c'} size={84} /></span>
            <span className="t1" role="status" style={{ marginTop: 18 }}>{kind === 'in' ? 'ເຂົ້າວຽກແລ້ວ!' : 'ອອກວຽກແລ້ວ!'}</span>
            <span className="t2">{hhmm(result.deviceTime)}</span>
            <span style={{ fontSize: 18 }}>{kind === 'in' ? 'ສູ້ໆ ມື້ນີ້!' : 'ພັກຜ່ອນໃຫ້ດີ ພົບກັນມື້ອື່ນ'}</span>
          </div>
          <button className="btn block" style={{ background: '#fff', color: okColor }} onClick={onClose}>ຕົກລົງ</button>
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
      <span className="pill" style={{ height: 40, fontSize: 16, padding: '0 16px', background: kind === 'in' ? 'var(--primary)' : 'var(--out)', color: '#fff' }}>
        ກຳລັງ: {kind === 'in' ? 'ເຂົ້າວຽກ' : 'ອອກວຽກ'}
      </span>
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

function Leave() {
  const hr = useHR();
  const { me, leaves, advances, settings, save } = hr;
  const today = ymd(new Date());
  const [type, setType] = useState<LeaveType>('annual');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState('');
  if (!me) return null;
  const bal = leaveBalance(hr, me, today);
  const days = from && to && to >= from ? leaveDays(from, to, [0], []) : 0;
  const now = new Date();
  const cap = maxAdvance(me.baseSalary, now.getDate(), new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(), settings);
  const mine = leaves.filter(l => l.employeeId === me.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const myAdv = advances.filter(a => a.employeeId === me.id);
  const statusPill = (s: string) => <span className={`pill ${s === 'approved' ? 'ok' : s === 'rejected' ? 'bad' : 'warn'}`}>{s === 'approved' ? 'ອະນຸມັດແລ້ວ' : s === 'rejected' ? 'ປະຕິເສດ' : 'ລໍອະນຸມັດ'}</span>;

  const submitLeave = async () => {
    setErr('');
    if (days <= 0) return setErr('ວັນທີບໍ່ຖືກຕ້ອງ');
    if (type === 'annual' && days > bal.left) return setErr(`ມື້ລາພັກເຫຼືອ ${bal.left} ມື້ ບໍ່ພໍ`);
    if (!reason.trim()) return setErr('ກະລຸນາໃສ່ເຫດຜົນ');
    const req: LeaveRequest = { id: uid(), companyId: me.companyId, employeeId: me.id, type, from, to, days, reason: reason.trim(), createdAt: new Date().toISOString(), approvals: [], status: 'pending' };
    await save('leaves', req, 'leave-request');
    setReason('');
  };
  const submitAdvance = async () => {
    setErr('');
    const n = Number(amount.replace(/\D/g, ''));
    if (!n) return setErr('ໃສ່ຈຳນວນເງິນ');
    if (n > cap) return setErr(`ເບີກໄດ້ສູງສຸດ ${money(cap)} ₭`);
    const adv: Advance = { id: uid(), companyId: me.companyId, employeeId: me.id, amount: n, installments: 1, remaining: n, status: 'pending', approvals: [], createdAt: new Date().toISOString() };
    await save('advances', adv, 'advance-request');
    setAmount('');
  };

  return (
    <div className="screen">
      <h1>ລາພັກ / ເບີກເງິນ</h1>
      <div className="card dark row">
        <div className="col grow" style={{ gap: 0 }}><span style={{ color: '#9fd8d4' }}>ມື້ລາພັກເຫຼືອ</span><span className="big-num">{bal.left} <span style={{ fontSize: 16, color: 'var(--mint-ink)' }}>ມື້</span></span></div>
        <span className="small" style={{ color: '#9fd8d4' }}>ໄດ້ {bal.earned} · ໃຊ້ {bal.used}</span>
      </div>
      <div className="card col">
        <h2>ຂໍລາ</h2>
        <div className="row wrap">{(['annual', 'sick', 'personal', 'unpaid'] as LeaveType[]).map(t => (
          <button key={t} className={`btn ${type === t ? '' : 'ghost'}`} onClick={() => setType(t)} aria-pressed={type === t}>{LEAVE_TYPES[t]}</button>))}</div>
        <div className="row"><label className="field grow">ແຕ່ວັນທີ<input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label className="field grow">ຫາວັນທີ<input className="input" type="date" value={to} onChange={e => setTo(e.target.value)} /></label></div>
        <span className="muted small">ລວມ {days} ມື້ເຮັດວຽກ</span>
        <label className="field">ເຫດຜົນ<input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="ເຊັ່ນ: ໄປໂຮງໝໍ" /></label>
        <button className="btn" onClick={submitLeave}>ສົ່ງຄຳຂໍລາ</button>
      </div>
      <div className="card col">
        <h2>ເບີກເງິນລ່ວງໜ້າ</h2>
        <span className="muted small">ເບີກໄດ້ສູງສຸດ {money(cap)} ₭ · ຫັກໃນເງິນເດືອນອັດຕະໂນມັດ</span>
        <input className="input" inputMode="numeric" value={amount} onChange={e => { const d = e.target.value.replace(/\D/g, ''); setAmount(d ? money(Number(d)) : ''); }} placeholder="ຈຳນວນເງິນ (ກີບ)" aria-label="ຈຳນວນເງິນ" />
        <button className="btn" onClick={submitAdvance}>ສົ່ງຄຳຂໍເບີກ</button>
      </div>
      {err && <div className="error" role="alert">{err}</div>}
      <div className="card col">
        <h2>ຄຳຂໍຂອງຂ້ອຍ</h2>
        {mine.length === 0 && myAdv.length === 0 && <div className="empty">ຍັງບໍ່ມີຄຳຂໍ</div>}
        {mine.map(l => <div key={l.id} className="row"><div className="col grow" style={{ gap: 0 }}><b>{LEAVE_TYPES[l.type]} · {l.days} ມື້</b><span className="muted small">{l.from} → {l.to}</span></div>{statusPill(l.status)}</div>)}
        {myAdv.map(a => <div key={a.id} className="row"><div className="col grow" style={{ gap: 0 }}><b>ເບີກ {money(a.amount)} ₭</b><span className="muted small">{a.createdAt.slice(0, 10)}</span></div>{statusPill(a.status)}</div>)}
      </div>
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
      <h1>ເງິນເດືອນເດືອນນີ້</h1>
      <span className="muted small">ຕົວເລກປະມານການ ຈົນກວ່າ HR ຈະລັອກງວດ</span>
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
