import { useEffect, useState } from 'react';
import { signInInfo } from '../data/server';
import { useHR } from '../app/state';
import { isActiveOn } from '../domain/hiring';
import { hasRight } from '../domain/rights';
import { ONLINE_PIN_LEN } from '../domain/pin';
import PinPad from './PinPad';
import { initials, ymd } from './format';

/**
 * "Ask for a PIN": someone who may not do this action asks a colleague who may approve for others to type their PIN, then the action runs
 * once with that colleague's authority. The database records both names. Only on a Google Sheet company; elsewhere it renders nothing.
 */
export default function ApproveButton({ label = 'ຂໍ PIN ອະນຸມັດ', onApproved }: { label?: string; onApproved: (approverId: string) => Promise<void> | void }) {
  const hr = useHR();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [codes, setCodes] = useState<Set<string> | null>(null); // who has a login at all (the sign-in list)
  const api = hr.online;
  useEffect(() => { if (open && !codes) signInInfo(hr.companyId).then(i => setCodes(new Set((i.cards ?? []).map(c => c.code.toUpperCase())))).catch(() => setCodes(new Set())); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!api?.approve || !api.runApproved) return null;

  const today = ymd(new Date());
  // people who may approve for others, other than me, and who can sign in
  const approvers = hr.employees.filter(e => e.id !== hr.me?.id && isActiveOn(e, today) && !!codes?.has(e.code.toUpperCase()) && hasRight(e, 'override', hr.settings));
  const close = () => { setOpen(false); setPick(null); setPin(''); setErr(''); setBusy(false); };

  const go = async (code: string, digits: string) => {
    setErr(''); setBusy(true);
    try {
      const a = await api.approve!(code, digits);
      await api.runApproved!(a.approval, async () => { await onApproved(a.approverId); });
      close();
    } catch (e: any) {
      setErr(/fetch|network/i.test(e?.message) ? 'ເຊື່ອມຕໍ່ເຊີບເວີບໍ່ໄດ້ — ກວດອິນເຕີເນັດ' : e?.message || 'ອະນຸມັດບໍ່ໄດ້');
      setPin(''); setShake(true); setTimeout(() => setShake(false), 400); setBusy(false);
    }
  };
  const who = approvers.find(e => e.id === pick);

  return (
    <>
      <button className="btn ghost" onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <div className="sheet-back" style={{ overflow: 'auto' }} role="dialog" aria-modal="true" aria-label="ອະນຸມັດດ້ວຍ PIN" onClick={e => { if (e.target === e.currentTarget && !busy) close(); }}>
          <div className="card col" style={{ maxWidth: 420, margin: '8vh auto', width: 'calc(100% - 32px)' }}>
            <h2>ອະນຸມັດດ້ວຍ PIN</h2>
            {!who ? (<>
              <span className="muted small">ໃຫ້ຜູ້ທີ່ມີສິດອະນຸມັດ ເລືອກຊື່ຕົນເອງ ແລ້ວໃສ່ PIN {ONLINE_PIN_LEN} ຕົວ. ລະບົບບັນທຶກວ່າໃຜເປັນຄົນອະນຸມັດ.</span>
              {codes && approvers.length === 0 && <div className="empty">ບໍ່ມີໃຜມີສິດອະນຸມັດແທນໃນບໍລິສັດນີ້</div>}
              <div className="usersgrid">{approvers.map(e => <button key={e.id} type="button" className="ucard" onClick={() => { setPick(e.id); setPin(''); setErr(''); }}><span className="uav">{initials(e.name)}</span><span className="unm">{e.name}</span><span className="url">{e.code}</span></button>)}</div>
            </>) : (<>
              <div className="ucard sel" style={{ alignSelf: 'center', minWidth: 176 }}><span className="uav">{initials(who.name)}</span><span className="unm">{who.name}</span><span className="url">{who.code}</span></div>
              <PinPad value={pin} onChange={setPin} onComplete={d => go(who.code, d)} disabled={busy} shake={shake} />
              <div role="status" aria-live="polite" className="small" style={{ textAlign: 'center', minHeight: 22 }}>{busy ? 'ກຳລັງກວດ… (ລໍສັກຄູ່)' : ''}</div>
            </>)}
            {err && <div className="error" role="alert">{err}</div>}
            <div className="row">{who && <button className="btn ghost grow" disabled={busy} onClick={() => { setPick(null); setPin(''); setErr(''); }}>‹ ປ່ຽນຄົນ</button>}<button className="btn ghost grow" disabled={busy} onClick={close}>ຍົກເລີກ</button></div>
          </div>
        </div>
      )}
    </>
  );
}
