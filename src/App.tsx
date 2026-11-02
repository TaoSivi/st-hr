import { useState } from 'react';
import { HRProvider, useHR } from './app/state';
import EmployeeApp from './ui/EmployeeApp';
import ManagerApp from './ui/ManagerApp';
import { initials, ROLE_NAMES } from './ui/format';

export default function App() {
  return <HRProvider><Shell /></HRProvider>;
}

function Shell() {
  const { me, setMe, employees } = useHR();
  // everyone opens on the clock/map screen; managers reach the back office from the menu
  const [managerView, setManagerView] = useState(false);

  if (!me) {
    return (
      <div className="phone"><div className="screen">
        <div className="row"><span className="logo">ST</span><div className="col" style={{ gap: 0 }}><b style={{ fontSize: 20 }}>ST HR</b><span className="muted small">ໂໝດສາທິດ · ຂໍ້ມູນເກັບໃນເຄື່ອງນີ້ເທົ່ານັ້ນ</span></div></div>
        <h1>ເຂົ້າໃຊ້ເປັນ</h1>
        <span className="muted">ເລືອກຜູ້ໃຊ້ເພື່ອລອງແຕ່ລະບົດບາດ. ລະບົບຈິງຈະມີການ login.</span>
        <div className="col">
          {employees.map(e => (
            <button key={e.id} className="card row" style={{ border: 'none', textAlign: 'left', minHeight: 64 }} onClick={() => { setMe(e.id); setManagerView(false); }}>
              <span className="logo" style={{ background: 'var(--mint)' }}>{initials(e.name)}</span>
              <div className="col grow" style={{ gap: 0 }}><b>{e.name}</b><span className="muted small">{e.position}</span></div>
              <span className="small muted">{e.roles.filter(r => r !== 'employee').map(r => ROLE_NAMES[r]).join(', ') || 'ພະນັກງານ'}</span>
            </button>
          ))}
        </div>
      </div></div>
    );
  }

  const isManager = me.roles.some(r => r !== 'employee');
  if (isManager && managerView) return <ManagerApp onSwitch={() => setMe(null)} onEmployeeView={() => setManagerView(false)} />;
  return <EmployeeApp onSwitch={() => setMe(null)} onManagerView={isManager ? () => setManagerView(true) : undefined} />;
}
