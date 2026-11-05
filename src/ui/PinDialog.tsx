import { useEffect, useRef, useState } from 'react';
import type { Employee } from '../domain/types';
import { ONLINE_PIN_LEN } from '../domain/pin';
import PinPad from './PinPad';
import { initials } from './format';

/**
 * An Admin or Super admin looks at one person's PIN and can set a new one. The PIN is hidden until "ເບິ່ງ PIN" is pressed (every look is logged
 * by the server) and hides itself again after a short while, so it is not left on a screen someone walks away from.
 */
export default function PinDialog({ person, hasLogin, reveal, onSet, onClose }: {
  person: Employee;
  hasLogin: boolean;
  reveal?: (e: Employee) => Promise<string | null>;
  onSet: (pin: string, mustChange: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [shown, setShown] = useState<string | null | undefined>(undefined); // undefined = hidden, null = looked and not known yet
  const [pin, setPin] = useState('');
  const [mustChange, setMustChange] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const hide = useRef<number>();
  useEffect(() => () => window.clearTimeout(hide.current), []);

  const look = async () => {
    setErr(''); setBusy(true);
    try {
      setShown(await reveal!(person));
      window.clearTimeout(hide.current);
      hide.current = window.setTimeout(() => setShown(undefined), 20_000);
    } catch (e: any) { setErr(e?.message || 'ເປີດ PIN ບໍ່ໄດ້'); }
    setBusy(false);
  };
  const save = async (value: string) => {
    setErr(''); setDone(''); setBusy(true);
    try {
      await onSet(value, mustChange);
      setShown(value); setPin('');
      setDone(mustChange ? 'ຕັ້ງ PIN ໃໝ່ແລ້ວ — ພະນັກງານຕ້ອງປ່ຽນເອງຕອນເຂົ້າຄັ້ງຕໍ່ໄປ' : 'ຕັ້ງ PIN ໃໝ່ແລ້ວ');
      window.clearTimeout(hide.current);
      hide.current = window.setTimeout(() => setShown(undefined), 20_000);
    } catch (e: any) { setErr(e?.message || 'ຕັ້ງ PIN ບໍ່ໄດ້'); setPin(''); }
    setBusy(false);
  };

  return (
    <div className="sheet-back" style={{ overflow: 'auto' }} role="dialog" aria-modal="true" aria-label={`PIN ຂອງ ${person.name}`} onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="card col" style={{ maxWidth: 420, margin: '6vh auto', width: 'calc(100% - 32px)' }}>
        <div className="row" style={{ gap: 12 }}>
          <span className="uav">{initials(person.name)}</span>
          <div className="col grow" style={{ gap: 0 }}><b style={{ fontSize: 18 }}>{person.name}</b><span className="muted small">{person.code}</span></div>
        </div>

        {reveal && hasLogin && (
          <div className="col" style={{ alignItems: 'center', gap: 8, padding: '14px 10px', borderRadius: 18, background: 'var(--ok-bg)' }}>
            <span className="muted small">PIN ປັດຈຸບັນ</span>
            <b style={{ fontSize: 34, letterSpacing: 10, paddingLeft: 10, minHeight: 44 }} aria-live="polite">
              {typeof shown === 'string' ? shown : shown === null ? <span style={{ fontSize: 15, letterSpacing: 0, fontWeight: 500 }}>ຍັງບໍ່ຮູ້ PIN ນີ້</span> : '••••'}
            </b>
            {shown === null && <span className="muted small" style={{ textAlign: 'center' }}>PIN ນີ້ຖືກຕັ້ງກ່ອນລະບົບເບິ່ງ PIN ໄດ້. ຈະເບິ່ງໄດ້ເມື່ອເຈົ້າຂອງເຂົ້າລະບົບຄັ້ງຕໍ່ໄປ ຫຼື ເຈົ້າຕັ້ງ PIN ໃໝ່ຂ້າງລຸ່ມ.</span>}
            {typeof shown === 'string'
              ? <button className="btn ghost" disabled={busy} onClick={() => { window.clearTimeout(hide.current); setShown(undefined); }}>ເຊື່ອງ PIN</button>
              : <button className="btn" disabled={busy} onClick={look}>ເບິ່ງ PIN</button>}
            <span className="muted small" style={{ textAlign: 'center' }}>ທຸກຄັ້ງທີ່ເບິ່ງ ລະບົບບັນທຶກວ່າໃຜເບິ່ງ</span>
          </div>)}

        <div className="col" style={{ gap: 8 }}>
          <b>{hasLogin ? 'ຕັ້ງ PIN ໃໝ່' : 'ສ້າງ PIN ໃຫ້ຄົນນີ້'}</b>
          <span className="muted small">ໃສ່ PIN {ONLINE_PIN_LEN} ຕົວເລກ — ໃສ່ຄົບແລ້ວກົດບັນທຶກ</span>
          <PinPad value={pin} onChange={setPin} len={ONLINE_PIN_LEN} disabled={busy} label="PIN ໃໝ່" />
          <label className="row" style={{ minHeight: 44 }}><input type="checkbox" checked={mustChange} onChange={e => setMustChange(e.target.checked)} />ໃຫ້ພະນັກງານປ່ຽນ PIN ເອງຕອນເຂົ້າຄັ້ງຕໍ່ໄປ</label>
        </div>

        {done && <div className="pill ok" role="status" style={{ height: 'auto', padding: '8px 12px', whiteSpace: 'normal' }}>{done}</div>}
        {err && <div className="error" role="alert">{err}</div>}
        <div className="row">
          <button className="btn ghost grow" disabled={busy} onClick={onClose}>ປິດ</button>
          <button className="btn grow" disabled={busy || pin.length !== ONLINE_PIN_LEN} onClick={() => save(pin)}>ບັນທຶກ PIN ໃໝ່</button>
        </div>
      </div>
    </div>
  );
}
