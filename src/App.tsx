import { useEffect, useState } from 'react';
import { HRProvider, useHR } from './app/state';
import EmployeeApp from './ui/EmployeeApp';
import ManagerApp from './ui/ManagerApp';
import PlatformAdmin from './ui/PlatformAdmin';
import { initials, ROLE_NAMES, ymd } from './ui/format';
import { isActiveOn } from './domain/hiring';
import { validateCompanyName } from './domain/company';
import { createCompany, DEMO_COMPANY_ID, getCompany, listCompanies, meKey, storePrefix } from './data/companies';
import { LocalStore } from './data/store';
import { seedNewCompany } from './data/seed';
import { landsInBackOffice } from './domain/permissions';
import { IDLE_LOGOUT_MIN, pinFields, pinProblem } from './domain/pin';
import type { Employee } from './domain/types';
import Login, { NewPin } from './ui/Login';
import OnlineApp from './ui/Online';
import { readOnlineCompany, readServerConfig, setOnlineCompany, takeJoinLink } from './data/server';

const ACTIVE_KEY = 'sthr-company';
const isWideScreen = () => typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 900px)').matches;
const readActive = () => {
  let id: string | null = null;
  try { id = localStorage.getItem(ACTIVE_KEY); } catch { /* private mode */ }
  return id && getCompany(id) ? id : DEMO_COMPANY_ID;
};

/** The sample company and on-device companies are for trying the app: open the address with ?demo to get them. Otherwise the app is the real, online one. */
const demoMode = () => typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');

export default function App() {
  // a set-up link opened on this phone (…#join=…) takes it straight to its online company
  const [online, setOnline] = useState<boolean>(() => {
    const joined = !!takeJoinLink(); // always read the link, so it is remembered and cleared from the address
    return joined || !demoMode() || (!!readOnlineCompany() && !!readServerConfig());
  });
  const goOnline = () => { setOnline(true); };
  const leaveOnline = () => { setOnlineCompany(null); setOnline(false); };
  const [companyId, setCompanyId] = useState(readActive);
  const [platform, setPlatform] = useState(false);
  const choose = (id: string) => {
    try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* private mode */ }
    setCompanyId(id);
    setPlatform(false);
  };
  if (online) {
    return (
      <OnlineApp companyId={readOnlineCompany()} onLeave={demoMode() ? leaveOnline : undefined}>
        {({ companyId: cid, online: session }) => <HRProvider key={cid} companyId={cid} online={session}><Shell onChooseCompany={() => {}} onPlatform={() => {}} onGoOnline={goOnline} /></HRProvider>}
      </OnlineApp>
    );
  }
  if (platform) return <PlatformAdmin onClose={() => setPlatform(false)} onOpen={choose} />;
  // the key remounts the provider, so switching company never shows the previous company's data for a moment
  return <HRProvider key={companyId} companyId={companyId}><Shell onChooseCompany={choose} onPlatform={() => setPlatform(true)} onGoOnline={goOnline} /></HRProvider>;
}

function CompanyPicker({ current, onChoose, onPlatform, onClose }: { current: string; onChoose: (id: string) => void; onPlatform: () => void; onClose: () => void }) {
  const [companies] = useState(() => listCompanies());
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [err, setErr] = useState('');
  const create = async () => {
    const errs = validateCompanyName(name, companies);
    if (!owner.trim()) errs.push('ໃສ່ຊື່ເຈົ້າຂອງ');
    const pp = pinProblem(pin);
    if (pp) errs.push(pp); else if (pin !== pin2) errs.push('PIN ທັງສອງບໍ່ກົງກັນ');
    if (errs.length) return setErr(errs.join(' · '));
    const today = ymd(new Date());
    const c = createCompany(name, today);
    const store = new LocalStore(c.id, storePrefix(c.id));
    await seedNewCompany(store, c.id, owner, today);
    const o = await store.get<Employee>('employees', 'e-owner');
    if (o) await store.put('employees', { ...o, ...(await pinFields(pin, false)) }, o.id, 'pin-first');
    try { localStorage.setItem(meKey(c.id), 'e-owner'); } catch { /* signs in with code ST-001 + PIN instead */ }
    onChoose(c.id);
  };
  return (
    <div className="col">
      <div className="row"><b className="grow">ເລືອກບໍລິສັດ</b><button className="btn ghost" onClick={onClose}>ປິດ</button></div>
      {companies.map(c => (
        <button key={c.id} className="card row" style={{ border: c.id === current ? '2px solid var(--teal, #0a7e7a)' : 'none', textAlign: 'left', minHeight: 56 }} onClick={() => onChoose(c.id)}>
          <b className="grow">{c.name}</b>{c.id === current && <span className="pill ok">ກຳລັງໃຊ້</span>}</button>))}
      {!creating
        ? <button className="btn ghost" onClick={() => setCreating(true)}>+ ສ້າງບໍລິສັດໃໝ່ (ທົດລອງ Pro 30 ມື້)</button>
        : <div className="card col">
          <label className="field">ຊື່ບໍລິສັດ<input className="input" value={name} onChange={e => setName(e.target.value)} /></label>
          <label className="field">ຊື່ເຈົ້າຂອງ (ຜູ້ໃຊ້ຄົນທຳອິດ)<input className="input" value={owner} onChange={e => setOwner(e.target.value)} /></label>
          <div className="row"><label className="field grow">PIN ເຈົ້າຂອງ (4–6 ຕົວເລກ)<input className="input" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} /></label>
            <label className="field grow">ໃສ່ PIN ອີກເທື່ອ<input className="input" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin2} onChange={e => setPin2(e.target.value.replace(/\D/g, ''))} /></label></div>
          <span className="muted small">ເຈົ້າຂອງເຂົ້າລະບົບດ້ວຍລະຫັດ ST-001 + PIN ນີ້.</span>
          {err && <div className="error" role="alert">{err}</div>}
          <div className="row"><button className="btn ghost" onClick={() => setCreating(false)}>ຍົກເລີກ</button><button className="btn" onClick={create}>ສ້າງ</button></div>
        </div>}
      <button className="btn ghost" onClick={onPlatform}>ຈັດການບໍລິສັດ & ແພັກເກັດ (ຜູ້ໃຫ້ບໍລິການ · ສາທິດ)</button>
    </div>
  );
}

function Shell({ onChooseCompany, onPlatform, onGoOnline }: { onChooseCompany: (id: string) => void; onPlatform: () => void; onGoOnline: () => void }) {
  const { me, setMe, employees, company, companyId, online, save } = useHR();
  // phone: everyone opens on the clock screen and managers reach the back office from the menu; computer: managers open in the back office.
  // null = nobody has chosen yet, so the screen decides
  const [chosenView, setChosenView] = useState<boolean | null>(null);
  const [picking, setPicking] = useState(false);
  const isDemo = companyId === DEMO_COMPANY_ID;
  useEffect(() => { if (!me) setChosenView(null); }, [me]);
  // a shared shop device: the session ends by itself when nobody touches it (longer on a desk computer)
  useEffect(() => {
    if (!me || isDemo) return;
    const ms = (isWideScreen() ? 15 : IDLE_LOGOUT_MIN) * 60_000;
    let timer = setTimeout(() => setMe(null), ms);
    const poke = () => { clearTimeout(timer); timer = setTimeout(() => setMe(null), ms); };
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    events.forEach(ev => window.addEventListener(ev, poke, { passive: true }));
    return () => { clearTimeout(timer); events.forEach(ev => window.removeEventListener(ev, poke)); };
  }, [me?.id, isDemo]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!me) {
    return (
      <div className="phone"><div className="screen">
        <div className="row"><span className="logo">ST</span><div className="col" style={{ gap: 0 }}><b style={{ fontSize: 20 }}>ST HR</b><span className="muted small">{isDemo ? 'ໂໝດສາທິດ · ' : ''}ຂໍ້ມູນເກັບໃນເຄື່ອງນີ້ເທົ່ານັ້ນ</span></div></div>
        {picking
          ? <CompanyPicker current={companyId} onChoose={onChooseCompany} onPlatform={onPlatform} onClose={() => setPicking(false)} />
          : <button className="card row" style={{ border: 'none', textAlign: 'left', minHeight: 52 }} onClick={() => setPicking(true)}><span className="muted small">ບໍລິສັດ</span><b className="grow">{company.name}</b><span className="muted">ປ່ຽນ ›</span></button>}
        {!isDemo && <Login />}
        <button className="btn ghost" onClick={onGoOnline}>🌐 ເຂົ້າບໍລິສັດອອນລາຍ (ທຸກຄົນໃຊ້ມືຖືຂອງຕົນເອງ)</button>
        {isDemo && <>
        <h1>ເຂົ້າໃຊ້ເປັນ</h1>
        <span className="muted">ໂໝດສາທິດ: ເລືອກຜູ້ໃຊ້ເພື່ອລອງແຕ່ລະບົດບາດ. ບໍລິສັດຈິງເຂົ້າດ້ວຍລະຫັດພະນັກງານ + PIN.</span>
        <div className="col">
          {employees.filter(e => isActiveOn(e, ymd(new Date()))).map(e => (
            <button key={e.id} className="card row" style={{ border: 'none', textAlign: 'left', minHeight: 64 }} onClick={() => { setMe(e.id); setChosenView(null); }}>
              <span className="logo" style={{ background: 'var(--mint)' }}>{initials(e.name)}</span>
              <div className="col grow" style={{ gap: 0 }}><b>{e.name}</b><span className="muted small">{e.position}</span></div>
              <span className="small muted">{e.roles.filter(r => r !== 'employee').map(r => ROLE_NAMES[r]).join(', ') || 'ພະນັກງານ'}</span>
            </button>
          ))}
        </div>
        </>}
      </div></div>
    );
  }

  if (!isActiveOn(me, ymd(new Date()))) {
    return (
      <div className="phone"><div className="screen">
        <h1>ບັນຊີນີ້ຖືກປິດແລ້ວ</h1>
        <span className="muted">{me.endDate ? `ສິ້ນສຸດການເຮັດວຽກວັນທີ ${me.endDate}` : `ເລີ່ມເຮັດວຽກວັນທີ ${me.startDate}`} · ຕິດຕໍ່ຝ່າຍບຸກຄົນ</span>
        <button className="btn" onClick={() => setMe(null)}>ກັບຄືນ</button>
      </div></div>
    );
  }
  // signed in with a PIN the owner set: choose your own before anything else
  if (online && me.pinMustChange) {
    return (
      <div className="phone"><div className="screen">
        <NewPin who={me} online title="ຕັ້ງ PIN ຂອງເຈົ້າເອງ" note="PIN ທີ່ໄດ້ຮັບເປັນ PIN ຊົ່ວຄາວ. ຕັ້ງ PIN 6 ຕົວເລກທີ່ມີແຕ່ເຈົ້າຮູ້ ກ່ອນເຂົ້າໃຊ້."
          onSet={async p => { await online.changeOwnPin(p); await save('employees', { ...me, pinMustChange: undefined }, 'pin-change'); }} onCancel={() => setMe(null)} />
      </div></div>
    );
  }
  const isManager = me.roles.some(r => r !== 'employee');
  const managerView = isManager && (chosenView ?? landsInBackOffice(me.roles, isWideScreen()));
  if (managerView) return <ManagerApp onSwitch={() => setMe(null)} onEmployeeView={() => setChosenView(false)} />;
  return <EmployeeApp onSwitch={() => setMe(null)} onManagerView={isManager ? () => setChosenView(true) : undefined} />;
}
