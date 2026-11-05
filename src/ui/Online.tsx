import { useCallback, useEffect, useMemo, useState } from 'react';
import { HRProvider, type OnlineApi, type OnlineSession } from '../app/state';
import { RemoteStore, type Outbox, type QueuedWrite } from '../data/remote';
import {
  approveWith, canApprove, changeOwnPin, companyName, createCompanyOnline, createLogin, currentMember, joinLink, listLogins, loadCompany, readOnlineCompany, readServerConfig,
  activeBackend, resetPin, saveServerConfig, serverKind, runApproved, setOnlineCompany, sheetCompany, signIn, signInInfo, signOut, peekSignIn, peekSheetCompany, revealPin, type Member
} from '../data/server';
import type { SheetCard } from '../data/sheets';
import { newCompanyRecords } from '../data/seed';
import { newCompany, validateCompanyName, type Company } from '../domain/company';
import { ONLINE_PIN_LEN, pinProblem } from '../domain/pin';
import type { Employee } from '../domain/types';
import { initials, ROLE_NAMES, ymd } from './format';
import PinPad from './PinPad';

/** The scans a phone made with no signal, kept in the browser until they can be sent. One list per company. */
const outboxFor = (companyId: string): Outbox => ({
  read: () => { try { return JSON.parse(localStorage.getItem(`sthr-outbox:${companyId}`) || '[]') as QueuedWrite[]; } catch { return []; } },
  write: q => { try { localStorage.setItem(`sthr-outbox:${companyId}`, JSON.stringify(q)); } catch { /* storage full: the scan is still on screen */ } }
});

const friendly = (e: any, fallback: string) => (/fetch|network|Load failed/i.test(String(e?.message)) ? 'ເຊື່ອມຕໍ່ເຊີບເວີບໍ່ໄດ້ — ກວດລິ້ງ ແລະ ອິນເຕີເນັດ' : e?.message || fallback);

/** When the site was built with its Google Sheet address, it belongs to that one organisation: no choosing another. */
const isBuiltIn = () => !!(import.meta as any).env?.VITE_SHEETS_URL;

const digits = (v: string) => v.replace(/\D/g, '').slice(0, ONLINE_PIN_LEN);

function Pin({ label, value, set, auto }: { label: string; value: string; set: (v: string) => void; auto?: string }) {
  return <label className="field">{label}<input className="input" type="password" inputMode="numeric" autoComplete={auto ?? 'current-password'} maxLength={ONLINE_PIN_LEN} value={value} onChange={e => set(digits(e.target.value))} style={{ letterSpacing: 6, fontSize: 20 }} /></label>;
}

const roleLabel = (role: string) => (role === 'superadmin' ? 'Super admin' : role === 'owner' ? 'Admin' : ROLE_NAMES[role] ?? role);

/**
 * Sign in to an online company, as in ST POS: tap your name, then the 4 digits of your PIN on the pad.
 * A server that cannot list its people (Supabase), or someone not on the list, uses the employee code instead.
 */
function ServerLogin({ companyId, onIn, onBack, onOther }: { companyId: string; onIn: (m: Member) => void; onBack?: () => void; onOther: () => void }) {
  const seed = useMemo(() => peekSignIn(companyId), [companyId]); // what this device saw last time: on screen at once, refreshed behind it
  const [name, setName] = useState<string | null | undefined>(seed ? seed.name : undefined);
  const [cards, setCards] = useState<SheetCard[] | null>(seed ? seed.cards : null);
  const [pick, setPick] = useState<SheetCard | null>(null);
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [find, setFind] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  useEffect(() => { signInInfo(companyId).then(i => { setName(i.name); setCards(i.cards); }).catch(() => setName(null)); }, [companyId]);

  const go = async (who: string, digits: string) => {
    setErr(''); setBusy(true);
    try { onIn(await signIn(companyId, who, digits)); return; } catch (e: any) { setErr(friendly(e, 'ເຂົ້າບໍ່ໄດ້')); setPin(''); setShake(true); setTimeout(() => setShake(false), 400); }
    setBusy(false);
  };
  const showCards = !!cards && cards.length > 0 && !manual;
  const q = find.trim().toLowerCase();
  const shown = (cards ?? []).filter(c => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  const choose = (c: SheetCard | null) => { setPick(c); setPin(''); setErr(''); };

  return (
    <div className="phone"><div className="screen">
      <div className="row"><span className="logo">ST</span><div className="col" style={{ gap: 0 }}><b style={{ fontSize: 20 }}>ST HR</b><span className="muted small">ອອນລາຍ · ບໍລິສັດ</span></div></div>
      <div className="card row" style={{ minHeight: 52 }}><b className="grow">{name === undefined ? 'ກຳລັງກວດ…' : name ?? 'ບໍ່ພົບບໍລິສັດນີ້'}</b></div>
      {showCards ? (
        <div className="card col">
          <h2>ເຂົ້າລະບົບ</h2>
          {!pick ? (<>
            <span className="muted small">ເລືອກຊື່ຂອງເຈົ້າ ແລ້ວໃສ່ PIN {ONLINE_PIN_LEN} ຕົວເລກ</span>
            {cards!.length > 12 && <input className="input" placeholder="ຄົ້ນຫາຊື່ ຫຼື ລະຫັດ" aria-label="ຄົ້ນຫາຊື່" value={find} onChange={e => setFind(e.target.value)} />}
            <div className="usersgrid">
              {shown.map(c => <button key={c.code} type="button" className="ucard" onClick={() => choose(c)}><span className="uav">{initials(c.name)}</span><span className="unm">{c.name}</span><span className="url">{c.code} · {roleLabel(c.role)}</span></button>)}
            </div>
            {shown.length === 0 && <div className="empty">ບໍ່ພົບຊື່ນີ້</div>}
          </>) : (<>
            <div className="ucard sel" style={{ alignSelf: 'center', minWidth: 176 }}><span className="uav">{initials(pick.name)}</span><span className="unm">{pick.name}</span><span className="url">{pick.code} · {roleLabel(pick.role)}</span></div>
            <PinPad value={pin} onChange={setPin} onComplete={d => go(pick.code, d)} disabled={busy} shake={shake} />
            <div role="status" aria-live="polite" className="small" style={{ textAlign: 'center', minHeight: 22 }}>{busy ? 'ກຳລັງເຂົ້າ… (ລໍສັກຄູ່)' : ''}</div>
            {err && <div className="error" role="alert">{err}</div>}
            <button className="btn ghost" type="button" disabled={busy} onClick={() => choose(null)}>‹ ປ່ຽນຄົນ</button>
          </>)}
          {!pick && <span className="muted small">ລືມ PIN: ຂໍໃຫ້ Admin / HR ຕັ້ງ PIN ຊົ່ວຄາວໃຫ້ໃໝ່.</span>}
          {!pick && <button className="btn ghost" type="button" onClick={() => setManual(true)}>ໃສ່ລະຫັດພະນັກງານເອງ</button>}
        </div>
      ) : (
        <form className="card col" onSubmit={e => { e.preventDefault(); go(code, pin); }}>
          <h2>ເຂົ້າລະບົບ</h2>
          <label className="field">ລະຫັດພະນັກງານ<input className="input" autoComplete="username" autoCapitalize="characters" placeholder="ເຊັ່ນ ST-012" value={code} onChange={e => setCode(e.target.value)} style={{ fontSize: 18 }} /></label>
          <Pin label={`PIN (${ONLINE_PIN_LEN} ຕົວເລກ)`} value={pin} set={setPin} />
          {err && <div className="error" role="alert">{err}</div>}
          <button className="btn block" type="submit" disabled={busy || !name || !code.trim() || pin.length !== ONLINE_PIN_LEN}>{busy ? 'ກຳລັງເຂົ້າ… (ລໍສັກຄູ່)' : 'ເຂົ້າລະບົບ'}</button>
          <span className="muted small">ລືມ PIN: ຂໍໃຫ້ Admin / HR ຕັ້ງ PIN ຊົ່ວຄາວໃຫ້ໃໝ່.</span>
          {manual && cards && cards.length > 0 && <button className="btn ghost" type="button" onClick={() => setManual(false)}>‹ ເລືອກຈາກລາຍຊື່</button>}
        </form>
      )}
      {!isBuiltIn() && <button className="btn ghost" onClick={onOther}>ບໍລິສັດອອນລາຍອື່ນ</button>}
      {onBack && <button className="btn ghost" onClick={onBack}>‹ ກັບໂໝດສາທິດ / ໃນເຄື່ອງ</button>}
    </div></div>
  );
}

/** First time on this device: connect to the project, then either enter an existing company or create one. */
function Connect({ onDone, onBack }: { onDone: (companyId: string) => void; onBack?: () => void }) {
  const have = readServerConfig();
  const [url, setUrl] = useState(have?.url ?? '');
  const [key, setKey] = useState(have?.key ?? '');
  const [kind, setKind] = useState<'sheets' | 'supabase'>(have ? (have.kind === 'sheets' ? 'sheets' : 'supabase') : 'sheets');
  const [mode, setMode] = useState<'enter' | 'create'>('enter');
  const [companyId, setCompanyId] = useState(readOnlineCompany() ?? '');
  const [signup, setSignup] = useState('');
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [adminPin, setAdminPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const sheets = kind === 'sheets';

  const connect = () => {
    if (kind === 'sheets') {
      if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url.trim())) return setErr('ໃສ່ລິ້ງ Web app ຂອງ Apps Script (ລົງທ້າຍດ້ວຍ /exec)'), false;
    } else if (!/^https:\/\/.+/.test(url.trim()) || key.trim().length < 20) return setErr('ໃສ່ Project URL (ເລີ່ມດ້ວຍ https://) ແລະ anon public key ໃຫ້ຖືກ'), false;
    saveServerConfig({ kind, url, key: kind === 'sheets' ? '' : key });
    return true;
  };
  const enter = async () => {
    setErr('');
    if (!connect()) return;
    setBusy(true);
    try {
      // a Google Sheet holds one company, so its code comes from the sheet
      const id = kind === 'sheets' ? (await sheetCompany()).companyId ?? '' : companyId.trim();
      if (!id) {
        if (kind === 'sheets') { setMode('create'); setErr('Google Sheet ນີ້ຍັງບໍ່ມີບໍລິສັດ — ສ້າງໃໝ່ໄດ້ເລີຍ ຢູ່ດ້ານລຸ່ມ'); } else setErr('ໃສ່ລະຫັດບໍລິສັດ');
        setBusy(false);
        return;
      }
      const n = await companyName(id);
      if (!n) throw new Error('ບໍ່ພົບບໍລິສັດນີ້ — ກວດລະຫັດບໍລິສັດ ຫຼື ລິ້ງທີ່ໄດ້ຮັບ');
      setOnlineCompany(id); onDone(id);
    } catch (e: any) { setErr(friendly(e, 'ເຊື່ອມຕໍ່ບໍ່ໄດ້')); }
    setBusy(false);
  };
  const create = async () => {
    setErr('');
    if (!connect()) return;
    const errs = validateCompanyName(name, []);
    if (!owner.trim()) errs.push(sheets ? 'ໃສ່ຊື່ Admin' : 'ໃສ່ຊື່ເຈົ້າຂອງ');
    const pp = pinProblem(pin, true);
    if (pp) errs.push(pp); else if (pin !== pin2) errs.push('PIN ທັງສອງບໍ່ກົງກັນ');
    if (sheets) { const ap = pinProblem(adminPin, true); if (ap) errs.push('PIN Admin: ' + ap); else if (adminPin === pin) errs.push('PIN Admin ຕ້ອງບໍ່ຊ້ຳກັບ PIN Super admin'); }
    if (!signup.trim()) errs.push('ໃສ່ລະຫັດສ້າງບໍລິສັດ (ຈາກຜູ້ດູແລລະບົບ)');
    if (errs.length) return setErr(errs.join(' · '));
    setBusy(true);
    try {
      const today = ymd(new Date());
      const c: Company = newCompany('c-' + Math.random().toString(36).slice(2, 10), name, today);
      const rec = newCompanyRecords(c.id, owner, today);
      // Google Sheet: the person setting up is the Super admin (ST-000) and the company's Admin is ST-001 with their own first PIN
      const superId = 'e-super';
      await createCompanyOnline(sheets
        ? { signupCode: signup.trim(), company: c, ownerEmployeeId: rec.owner.id, ownerCode: rec.owner.code, pin: adminPin, superAdmin: { employeeId: superId, code: 'ST-000', pin } }
        : { signupCode: signup.trim(), company: c, ownerEmployeeId: rec.owner.id, ownerCode: rec.owner.code, pin });
      // whoever is now signed in owns the company, so the first records can be written through the normal store
      const by = sheets ? superId : rec.owner.id;
      const store = new RemoteStore(activeBackend(), c.id, outboxFor(c.id));
      await store.put('branches', rec.branch, by, 'seed');
      await store.put('employees', sheets ? { ...rec.owner, pinMustChange: true } : rec.owner, by, 'seed');
      if (sheets) await store.put('employees', { ...rec.owner, id: superId, code: 'ST-000', name: 'Super admin', position: 'Super admin', superAdmin: true }, by, 'seed');
      for (const sh of rec.shifts) await store.put('shifts', sh, by, 'seed');
      await store.put('settings', rec.settings, by, 'seed');
      setOnlineCompany(c.id); onDone(c.id);
    } catch (e: any) { setErr(friendly(e, 'ສ້າງບໍ່ໄດ້')); }
    setBusy(false);
  };

  return (
    <div className="phone"><div className="screen">
      <div className="row"><span className="logo">ST</span><div className="col" style={{ gap: 0 }}><b style={{ fontSize: 20 }}>ST HR</b><span className="muted small">ບໍລິສັດອອນລາຍ</span></div></div>
      <div className="card col">
        <h2>ເຊື່ອມຕໍ່ຖານຂໍ້ມູນ</h2>
        <div className="tabs" role="tablist" style={{ alignSelf: 'flex-start' }}>
          <button role="tab" aria-selected={kind === 'sheets'} onClick={() => { setKind('sheets'); setErr(''); }}>Google Sheet</button>
          <button role="tab" aria-selected={kind === 'supabase'} onClick={() => { setKind('supabase'); setErr(''); }}>Supabase</button>
        </div>
        {kind === 'sheets' ? (<>
          <span className="muted small">ລິ້ງ Web app ຂອງ Apps Script ທີ່ຜູກກັບ Google Sheet ຂອງບໍລິສັດ (ເບິ່ງ apps-script/README.md). ຖ້າໄດ້ຮັບລິ້ງຈາກເຈົ້າຂອງ ກົດລິ້ງນັ້ນແທນ — ບໍ່ຕ້ອງໃສ່ເອງ.</span>
          <label className="field">ລິ້ງ Web app<input className="input" placeholder="https://script.google.com/macros/s/…/exec" value={url} onChange={e => setUrl(e.target.value)} /></label>
        </>) : (<>
          <span className="muted small">ໄດ້ຈາກ Supabase → Project Settings → API. ໃສ່ແຕ່ <b>Project URL</b> ແລະ <b>anon public</b> key (ຫ້າມໃສ່ service_role). ຖ້າໄດ້ຮັບລິ້ງຈາກເຈົ້າຂອງ ກົດລິ້ງນັ້ນແທນ — ບໍ່ຕ້ອງໃສ່ເອງ.</span>
          <label className="field">Project URL<input className="input" placeholder="https://xxxx.supabase.co" value={url} onChange={e => setUrl(e.target.value)} /></label>
          <label className="field">anon public key<input className="input" value={key} onChange={e => setKey(e.target.value)} /></label>
        </>)}
      </div>
      <div className="tabs" role="tablist" style={{ alignSelf: 'flex-start' }}>
        <button role="tab" aria-selected={mode === 'enter'} onClick={() => setMode('enter')}>ເຂົ້າບໍລິສັດທີ່ມີແລ້ວ</button>
        <button role="tab" aria-selected={mode === 'create'} onClick={() => setMode('create')}>ສ້າງບໍລິສັດໃໝ່</button>
      </div>
      {mode === 'enter' ? (
        <div className="card col">
          {kind === 'supabase' && <label className="field">ລະຫັດບໍລິສັດ<input className="input" placeholder="ເຊັ່ນ c-ab12cd34" value={companyId} onChange={e => setCompanyId(e.target.value)} /></label>}
          {kind === 'sheets' && <span className="muted small">Google Sheet ໜຶ່ງໃບ = ໜຶ່ງບໍລິສັດ ຈຶ່ງບໍ່ຕ້ອງໃສ່ລະຫັດບໍລິສັດ.</span>}
          {err && <div className="error" role="alert">{err}</div>}
          <button className="btn block" disabled={busy} onClick={enter}>{busy ? 'ກຳລັງເຊື່ອມຕໍ່…' : kind === 'sheets' ? 'ເຊື່ອມຕໍ່ ແລະ ເຂົ້າລະບົບ' : 'ຕໍ່ໄປ'}</button>
        </div>
      ) : (
        <div className="card col">
          <label className="field">ລະຫັດສ້າງບໍລິສັດ<input className="input" type="password" autoComplete="off" value={signup} onChange={e => setSignup(e.target.value)} /></label>
          <label className="field">ຊື່ບໍລິສັດ<input className="input" value={name} onChange={e => setName(e.target.value)} /></label>
          <label className="field">{sheets ? 'ຊື່ Admin ຂອງບໍລິສັດ (ລະຫັດ ST-001)' : 'ຊື່ເຈົ້າຂອງ (ຜູ້ໃຊ້ຄົນທຳອິດ · ລະຫັດ ST-001)'}<input className="input" value={owner} onChange={e => setOwner(e.target.value)} /></label>
          <div className="row"><div className="grow"><Pin label={sheets ? `PIN Super admin ${ONLINE_PIN_LEN} ຕົວ (ເຈົ້າຂອງລະບົບ · ST-000)` : `PIN ເຈົ້າຂອງ (${ONLINE_PIN_LEN} ຕົວເລກ)`} value={pin} set={setPin} auto="new-password" /></div><div className="grow"><Pin label="ໃສ່ PIN ອີກເທື່ອ" value={pin2} set={setPin2} auto="new-password" /></div></div>
          {sheets && <><Pin label={`PIN ເລີ່ມຕົ້ນຂອງ Admin ${ONLINE_PIN_LEN} ຕົວ (ST-001 ຈະຕ້ອງປ່ຽນເທື່ອທຳອິດ)`} value={adminPin} set={setAdminPin} auto="new-password" /><span className="muted small">Super admin ຄືເຈົ້າຂອງລະບົບ — ຕັ້ງ/ຣີເຊັດ PIN ຂອງ Admin ໄດ້ ແລະ Admin ແກ້ບັນຊີ Super admin ບໍ່ໄດ້. Admin ບໍລິຫານບໍລິສັດ.</span></>}
          {err && <div className="error" role="alert">{err}</div>}
          <button className="btn block" disabled={busy} onClick={create}>{busy ? 'ກຳລັງສ້າງ…' : 'ສ້າງບໍລິສັດ'}</button>
        </div>
      )}
      {onBack && <button className="btn ghost" onClick={onBack}>‹ ກັບໂໝດສາທິດ / ໃນເຄື່ອງ</button>}
    </div></div>
  );
}

/** An online company: sign in, then the same app as always over the shared database. */
export default function OnlineApp({ companyId, onLeave, children }: { companyId: string | null; onLeave?: () => void; children: (p: { companyId: string; online: OnlineSession }) => React.ReactNode }) {
  // a Google Sheet holds one company: this device remembers which, so the sign-in screen needs no wait (the real answer follows and corrects it)
  const remembered = useMemo(() => (!companyId && serverKind() === 'sheets' && readServerConfig() ? peekSheetCompany()?.companyId ?? null : null), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [id, setId] = useState(companyId ?? remembered);
  const [member, setMember] = useState<Member | null | undefined>(undefined);
  const [company, setCompany] = useState<Company | null>(null);
  const [err, setErr] = useState('');
  const [logins, setLogins] = useState<Set<string>>(new Set());
  // a Google Sheet holds one company: when the address is already known, find the company and go straight to sign-in
  const [probing, setProbing] = useState(() => !companyId && !remembered && serverKind() === 'sheets' && !!readServerConfig());
  useEffect(() => {
    if (!probing) return;
    sheetCompany().then(i => { if (i.companyId) { setOnlineCompany(i.companyId); setId(i.companyId); setMember(undefined); } }).catch(() => { /* the connect screen shows the problem */ }).finally(() => setProbing(false));
  }, [probing]);
  // the id remembered on this device may be of a company that no longer exists (the Sheet was wiped and made again): the Sheet decides
  useEffect(() => {
    if (!id || serverKind() !== 'sheets' || !readServerConfig()) return;
    sheetCompany().then(i => { if (i.companyId && i.companyId !== id) { setOnlineCompany(i.companyId); setId(i.companyId); setMember(undefined); } }).catch(() => { /* offline: keep what we have */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // an existing sign-in on this device is picked up again (the session survives a reload)
  useEffect(() => {
    if (!id || !readServerConfig()) { setMember(null); return; }
    currentMember().then(m => setMember(m && m.companyId === id ? m : null)).catch(() => setMember(null));
  }, [id]);
  useEffect(() => {
    if (!member || !id) { setCompany(null); return; }
    loadCompany(id).then(setCompany).catch(e => setErr(e?.message || 'ໂຫຼດບໍລິສັດບໍ່ໄດ້'));
  }, [member, id]);

  const store = useMemo(() => (id ? new RemoteStore(activeBackend(), id, outboxFor(id)) : null), [id]);
  const owner = !!member?.roles.includes('owner');
  const refreshLogins = useCallback(async () => { if (id && owner) setLogins(await listLogins(id)); }, [id, owner]);
  useEffect(() => { refreshLogins().catch(() => { /* the list is only for the owner's PIN page */ }); }, [refreshLogins]);

  const leave = async () => { await signOut().catch(() => { /* already out */ }); setMember(null); };
  const api: OnlineApi = useMemo(() => ({
    logins,
    refreshLogins,
    createLogin: async (e: Employee, pin: string) => { await createLogin(id!, e.id, e.code, pin); await refreshLogins(); },
    resetPin: async (e: Employee, pin: string) => { await resetPin(e.id, pin); },
    changeOwnPin,
    ...(canApprove() ? { approve: approveWith, runApproved, revealPin: (e: Employee) => revealPin(e.id) } : {}),
    joinLink: () => joinLink(readServerConfig()!, id!)
  }), [id, logins, refreshLogins]);

  if (probing) return <div className="empty">ກຳລັງເຊື່ອມຕໍ່… <div className="small muted">ລໍສັກຄູ່</div></div>;
  if (!readServerConfig() || !id) return <Connect onDone={nid => { setId(nid); setMember(undefined); }} onBack={onLeave} />;
  if (member === undefined) return <div className="empty">ກຳລັງກວດ…</div>;
  if (!member) return <ServerLogin companyId={id} onIn={setMember} onBack={onLeave} onOther={() => { setOnlineCompany(null); setId(null); }} />;
  if (err) return <div className="phone"><div className="screen"><div className="error" role="alert">{err}</div><button className="btn" onClick={leave}>ອອກ</button></div></div>;
  if (!company || !store) return <div className="empty">ກຳລັງໂຫຼດຂໍ້ມູນ… <div className="small muted">ລໍສັກຄູ່ ກຳລັງດຶງຂໍ້ມູນຈາກເຊີບເວີ</div></div>;
  return <>{children({ companyId: id, online: { store, company, meId: member.employeeId, onSignOut: leave, api, pollMs: serverKind() === 'sheets' ? 45_000 : undefined } })}</>;
}

export { HRProvider };
