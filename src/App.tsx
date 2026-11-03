import { useState } from 'react';
import { HRProvider, useHR } from './app/state';
import EmployeeApp from './ui/EmployeeApp';
import ManagerApp from './ui/ManagerApp';
import PlatformAdmin from './ui/PlatformAdmin';
import { initials, ROLE_NAMES, ymd } from './ui/format';
import { isActiveOn } from './domain/hiring';
import { validateCompanyName } from './domain/company';
import { createCompany, DEMO_COMPANY_ID, getCompany, listCompanies, storePrefix } from './data/companies';
import { LocalStore } from './data/store';
import { seedNewCompany } from './data/seed';
import { landsInBackOffice } from './domain/permissions';

const ACTIVE_KEY = 'sthr-company';
const isWideScreen = () => typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 900px)').matches;
const readActive = () => {
  let id: string | null = null;
  try { id = localStorage.getItem(ACTIVE_KEY); } catch { /* private mode */ }
  return id && getCompany(id) ? id : DEMO_COMPANY_ID;
};

export default function App() {
  const [companyId, setCompanyId] = useState(readActive);
  const [platform, setPlatform] = useState(false);
  const choose = (id: string) => {
    try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* private mode */ }
    setCompanyId(id);
    setPlatform(false);
  };
  if (platform) return <PlatformAdmin onClose={() => setPlatform(false)} onOpen={choose} />;
  // the key remounts the provider, so switching company never shows the previous company's data for a moment
  return <HRProvider key={companyId} companyId={companyId}><Shell onChooseCompany={choose} onPlatform={() => setPlatform(true)} /></HRProvider>;
}

function CompanyPicker({ current, onChoose, onPlatform, onClose }: { current: string; onChoose: (id: string) => void; onPlatform: () => void; onClose: () => void }) {
  const [companies] = useState(() => listCompanies());
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [err, setErr] = useState('');
  const create = async () => {
    const errs = validateCompanyName(name, companies);
    if (!owner.trim()) errs.push('ໃສ່ຊື່ເຈົ້າຂອງ');
    if (errs.length) return setErr(errs.join(' · '));
    const today = ymd(new Date());
    const c = createCompany(name, today);
    await seedNewCompany(new LocalStore(c.id, storePrefix(c.id)), c.id, owner, today);
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
          {err && <div className="error" role="alert">{err}</div>}
          <div className="row"><button className="btn ghost" onClick={() => setCreating(false)}>ຍົກເລີກ</button><button className="btn" onClick={create}>ສ້າງ</button></div>
        </div>}
      <button className="btn ghost" onClick={onPlatform}>ຈັດການບໍລິສັດ & ແພັກເກັດ (ຜູ້ໃຫ້ບໍລິການ · ສາທິດ)</button>
    </div>
  );
}

function Shell({ onChooseCompany, onPlatform }: { onChooseCompany: (id: string) => void; onPlatform: () => void }) {
  const { me, setMe, employees, company, companyId } = useHR();
  // phone: everyone opens on the clock screen and managers reach the back office from the menu; computer: managers open in the back office.
  // null = nobody has chosen yet, so the screen decides
  const [chosenView, setChosenView] = useState<boolean | null>(null);
  const [picking, setPicking] = useState(false);

  if (!me) {
    return (
      <div className="phone"><div className="screen">
        <div className="row"><span className="logo">ST</span><div className="col" style={{ gap: 0 }}><b style={{ fontSize: 20 }}>ST HR</b><span className="muted small">ໂໝດສາທິດ · ຂໍ້ມູນເກັບໃນເຄື່ອງນີ້ເທົ່ານັ້ນ</span></div></div>
        {picking
          ? <CompanyPicker current={companyId} onChoose={onChooseCompany} onPlatform={onPlatform} onClose={() => setPicking(false)} />
          : <button className="card row" style={{ border: 'none', textAlign: 'left', minHeight: 52 }} onClick={() => setPicking(true)}><span className="muted small">ບໍລິສັດ</span><b className="grow">{company.name}</b><span className="muted">ປ່ຽນ ›</span></button>}
        <h1>ເຂົ້າໃຊ້ເປັນ</h1>
        <span className="muted">ເລືອກຜູ້ໃຊ້ເພື່ອລອງແຕ່ລະບົດບາດ. ລະບົບຈິງຈະມີການ login.</span>
        <div className="col">
          {employees.filter(e => isActiveOn(e, ymd(new Date()))).map(e => (
            <button key={e.id} className="card row" style={{ border: 'none', textAlign: 'left', minHeight: 64 }} onClick={() => { setMe(e.id); setChosenView(null); }}>
              <span className="logo" style={{ background: 'var(--mint)' }}>{initials(e.name)}</span>
              <div className="col grow" style={{ gap: 0 }}><b>{e.name}</b><span className="muted small">{e.position}</span></div>
              <span className="small muted">{e.roles.filter(r => r !== 'employee').map(r => ROLE_NAMES[r]).join(', ') || 'ພະນັກງານ'}</span>
            </button>
          ))}
        </div>
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
  const isManager = me.roles.some(r => r !== 'employee');
  const managerView = isManager && (chosenView ?? landsInBackOffice(me.roles, isWideScreen()));
  if (managerView) return <ManagerApp onSwitch={() => setMe(null)} onEmployeeView={() => setChosenView(false)} />;
  return <EmployeeApp onSwitch={() => setMe(null)} onManagerView={isManager ? () => setChosenView(true) : undefined} />;
}
