import { useCallback, useEffect, useMemo, useState } from 'react';
import { HRProvider, type OnlineApi, type OnlineSession } from '../app/state';
import { RemoteStore, type Outbox, type QueuedWrite } from '../data/remote';
import {
  changeOwnPin, companyName, createCompanyOnline, createLogin, currentMember, joinLink, listLogins, loadCompany, readOnlineCompany, readServerConfig,
  activeBackend, resetPin, saveServerConfig, serverKind, setOnlineCompany, sheetCompany, signIn, signOut, type Member
} from '../data/server';
import { newCompanyRecords } from '../data/seed';
import { newCompany, validateCompanyName, type Company } from '../domain/company';
import { ONLINE_PIN_LEN, pinProblem } from '../domain/pin';
import type { Employee } from '../domain/types';
import { ymd } from './format';

/** The scans a phone made with no signal, kept in the browser until they can be sent. One list per company. */
const outboxFor = (companyId: string): Outbox => ({
  read: () => { try { return JSON.parse(localStorage.getItem(`sthr-outbox:${companyId}`) || '[]') as QueuedWrite[]; } catch { return []; } },
  write: q => { try { localStorage.setItem(`sthr-outbox:${companyId}`, JSON.stringify(q)); } catch { /* storage full: the scan is still on screen */ } }
});

const friendly = (e: any, fallback: string) => (/fetch|network|Load failed/i.test(String(e?.message)) ? 'ເຊື່ອມຕໍ່ເຊີບເວີບໍ່ໄດ້ — ກວດລິ້ງ ແລະ ອິນເຕີເນັດ' : e?.message || fallback);

const digits = (v: string) => v.replace(/\D/g, '').slice(0, ONLINE_PIN_LEN);

function Pin({ label, value, set, auto }: { label: string; value: string; set: (v: string) => void; auto?: string }) {
  return <label className="field">{label}<input className="input" type="password" inputMode="numeric" autoComplete={auto ?? 'current-password'} maxLength={ONLINE_PIN_LEN} value={value} onChange={e => set(digits(e.target.value))} style={{ letterSpacing: 6, fontSize: 20 }} /></label>;
}

/** Sign in to an online company: its name, then employee code + PIN. */
function ServerLogin({ companyId, onIn, onBack, onOther }: { companyId: string; onIn: (m: Member) => void; onBack: () => void; onOther: () => void }) {
  const [name, setName] = useState<string | null | undefined>(undefined);
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { companyName(companyId).then(setName).catch(() => setName(null)); }, [companyId]);
  const go = async () => {
    setErr(''); setBusy(true);
    try { onIn(await signIn(companyId, code, pin)); } catch (e: any) { setErr(/fetch|network/i.test(e?.message) ? 'ເຊື່ອມຕໍ່ເຊີບເວີບໍ່ໄດ້ — ກວດອິນເຕີເນັດ' : e?.message || 'ເຂົ້າບໍ່ໄດ້'); setPin(''); }
    setBusy(false);
  };
  return (
    <div className="phone"><div className="screen">
      <div className="row"><span className="logo">ST</span><div className="col" style={{ gap: 0 }}><b style={{ fontSize: 20 }}>ST HR</b><span className="muted small">ອອນລາຍ · ບໍລິສັດ</span></div></div>
      <div className="card row" style={{ minHeight: 52 }}><b className="grow">{name === undefined ? 'ກຳລັງກວດ…' : name ?? 'ບໍ່ພົບບໍລິສັດນີ້'}</b></div>
      <form className="card col" onSubmit={e => { e.preventDefault(); go(); }}>
        <h2>ເຂົ້າລະບົບ</h2>
        <label className="field">ລະຫັດພະນັກງານ<input className="input" autoComplete="username" autoCapitalize="characters" placeholder="ເຊັ່ນ ST-012" value={code} onChange={e => setCode(e.target.value)} style={{ fontSize: 18 }} /></label>
        <Pin label={`PIN (${ONLINE_PIN_LEN} ຕົວເລກ)`} value={pin} set={setPin} />
        {err && <div className="error" role="alert">{err}</div>}
        <button className="btn block" type="submit" disabled={busy || !name || !code.trim() || pin.length !== ONLINE_PIN_LEN}>{busy ? 'ກຳລັງເຂົ້າ… (ລໍສັກຄູ່)' : 'ເຂົ້າລະບົບ'}</button>
        <span className="muted small">ລືມ PIN: ຂໍໃຫ້ເຈົ້າຂອງ / HR ຕັ້ງ PIN ຊົ່ວຄາວໃຫ້ໃໝ່.</span>
      </form>
      <button className="btn ghost" onClick={onOther}>ບໍລິສັດອອນລາຍອື່ນ</button>
      <button className="btn ghost" onClick={onBack}>‹ ກັບໂໝດສາທິດ / ໃນເຄື່ອງ</button>
    </div></div>
  );
}

/** First time on this device: connect to the project, then either enter an existing company or create one. */
function Connect({ onDone, onBack }: { onDone: (companyId: string) => void; onBack: () => void }) {
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
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

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
    if (!owner.trim()) errs.push('ໃສ່ຊື່ເຈົ້າຂອງ');
    const pp = pinProblem(pin, true);
    if (pp) errs.push(pp); else if (pin !== pin2) errs.push('PIN ທັງສອງບໍ່ກົງກັນ');
    if (!signup.trim()) errs.push('ໃສ່ລະຫັດສ້າງບໍລິສັດ (ຈາກຜູ້ດູແລລະບົບ)');
    if (errs.length) return setErr(errs.join(' · '));
    setBusy(true);
    try {
      const today = ymd(new Date());
      const c: Company = newCompany('c-' + Math.random().toString(36).slice(2, 10), name, today);
      const rec = newCompanyRecords(c.id, owner, today);
      await createCompanyOnline({ signupCode: signup.trim(), company: c, ownerEmployeeId: rec.owner.id, ownerCode: rec.owner.code, pin });
      // the owner is now signed in and owns the company, so the first records can be written through the normal store
      const store = new RemoteStore(activeBackend(), c.id, outboxFor(c.id));
      await store.put('branches', rec.branch, rec.owner.id, 'seed');
      await store.put('employees', rec.owner, rec.owner.id, 'seed');
      for (const sh of rec.shifts) await store.put('shifts', sh, rec.owner.id, 'seed');
      await store.put('settings', rec.settings, rec.owner.id, 'seed');
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
          <label className="field">ຊື່ເຈົ້າຂອງ (ຜູ້ໃຊ້ຄົນທຳອິດ · ລະຫັດ ST-001)<input className="input" value={owner} onChange={e => setOwner(e.target.value)} /></label>
          <div className="row"><div className="grow"><Pin label={`PIN ເຈົ້າຂອງ (${ONLINE_PIN_LEN} ຕົວເລກ)`} value={pin} set={setPin} auto="new-password" /></div><div className="grow"><Pin label="ໃສ່ PIN ອີກເທື່ອ" value={pin2} set={setPin2} auto="new-password" /></div></div>
          {err && <div className="error" role="alert">{err}</div>}
          <button className="btn block" disabled={busy} onClick={create}>{busy ? 'ກຳລັງສ້າງ…' : 'ສ້າງບໍລິສັດ'}</button>
        </div>
      )}
      <button className="btn ghost" onClick={onBack}>‹ ກັບໂໝດສາທິດ / ໃນເຄື່ອງ</button>
    </div></div>
  );
}

/** An online company: sign in, then the same app as always over the shared database. */
export default function OnlineApp({ companyId, onLeave, children }: { companyId: string | null; onLeave: () => void; children: (p: { companyId: string; online: OnlineSession }) => React.ReactNode }) {
  const [id, setId] = useState(companyId);
  const [member, setMember] = useState<Member | null | undefined>(undefined);
  const [company, setCompany] = useState<Company | null>(null);
  const [err, setErr] = useState('');
  const [logins, setLogins] = useState<Set<string>>(new Set());

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
    joinLink: () => joinLink(readServerConfig()!, id!)
  }), [id, logins, refreshLogins]);

  if (!readServerConfig() || !id) return <Connect onDone={nid => { setId(nid); setMember(undefined); }} onBack={onLeave} />;
  if (member === undefined) return <div className="empty">ກຳລັງກວດ…</div>;
  if (!member) return <ServerLogin companyId={id} onIn={setMember} onBack={onLeave} onOther={() => { setOnlineCompany(null); setId(null); }} />;
  if (err) return <div className="phone"><div className="screen"><div className="error" role="alert">{err}</div><button className="btn" onClick={leave}>ອອກ</button></div></div>;
  if (!company || !store) return <div className="empty">ກຳລັງໂຫຼດຂໍ້ມູນ… <div className="small muted">ລໍສັກຄູ່ ກຳລັງດຶງຂໍ້ມູນຈາກເຊີບເວີ</div></div>;
  return <>{children({ companyId: id, online: { store, company, meId: member.employeeId, onSignOut: leave, api, pollMs: serverKind() === 'sheets' ? 45_000 : undefined } })}</>;
}

export { HRProvider };
