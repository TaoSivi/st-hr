import { useEffect, useState } from 'react';
import { approveWith, readOnlineCompany, signInInfo } from '../data/server';
import type { SheetCard } from '../data/sheets';
import PinPad from './PinPad';
import { initials } from './format';
import { ONLINE_PIN_LEN } from '../domain/pin';

type Pending = { reason: string; ok: (approval: string) => void; no: (e: Error) => void };
let open: ((p: Pending) => void) | null = null;

/** Asks the Super admin to type their PIN on this screen. Resolves with the approval; rejects if they cancel. */
export function askSuperApproval(reason: string): Promise<string> {
  return new Promise((ok, no) => {
    if (!open) return no(new Error('ຕ້ອງໃຫ້ Super admin ອະນຸມັດ: ' + reason));
    open({ reason, ok, no });
  });
}

/** The PIN card shown whenever an Admin does something the Super admin must approve. Mounted once, at the top of the app. */
export default function SuperApprovalHost() {
  const [req, setReq] = useState<Pending | null>(null);
  const [cards, setCards] = useState<SheetCard[] | null>(null);
  const [who, setWho] = useState<SheetCard | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    open = p => { setReq(p); setWho(null); setPin(''); setErr(''); setBusy(false); };
    return () => { open = null; };
  }, []);
  useEffect(() => {
    if (!req) return;
    signInInfo(readOnlineCompany() ?? '').then(i => {
      const supers = (i.cards ?? []).filter(c => c.role === 'superadmin');
      setCards(supers);
      if (supers.length === 1) setWho(supers[0]);
    }).catch(() => setCards([]));
  }, [req]);

  if (!req) return null;
  const close = (e?: Error) => { if (e) req.no(e); setReq(null); setCards(null); };
  const go = async (digits: string) => {
    if (!who) return;
    setErr(''); setBusy(true);
    try {
      const a = await approveWith(who.code, digits);
      req.ok(a.approval);
      setReq(null); setCards(null);
    } catch (e: any) {
      setErr(/fetch|network/i.test(e?.message) ? 'ເຊື່ອມຕໍ່ເຊີບເວີບໍ່ໄດ້ — ກວດອິນເຕີເນັດ' : e?.message || 'ອະນຸມັດບໍ່ໄດ້');
      setPin(''); setShake(true); setTimeout(() => setShake(false), 400); setBusy(false);
    }
  };

  return (
    <div className="sheet-back" style={{ zIndex: 3500, overflow: 'auto' }} role="dialog" aria-modal="true" aria-label="Super admin ອະນຸມັດ">
      <div className="card col" style={{ maxWidth: 420, margin: '8vh auto', width: 'calc(100% - 32px)' }}>
        <h2>ຕ້ອງໃຫ້ Super admin ອະນຸມັດ</h2>
        <span className="small" style={{ background: 'var(--warn-bg)', color: 'var(--warn)', borderRadius: 12, padding: '8px 12px' }}>{req.reason}</span>
        {cards === null && <div className="empty">ກຳລັງເບິ່ງ…</div>}
        {cards && cards.length === 0 && <div className="error" role="alert">ບໍ່ພົບບັນຊີ Super admin</div>}
        {!who && cards && cards.length > 1 && <>
          <span className="muted small">ໃຫ້ Super admin ເລືອກຊື່ຕົນເອງ ແລ້ວໃສ່ PIN {ONLINE_PIN_LEN} ຕົວ</span>
          <div className="usersgrid">{cards.map(c => <button key={c.code} type="button" className="ucard" onClick={() => { setWho(c); setPin(''); setErr(''); }}><span className="uav">{initials(c.name)}</span><span className="unm">{c.name}</span><span className="url">{c.code}</span></button>)}</div>
        </>}
        {who && <>
          <div className="ucard sel" style={{ alignSelf: 'center', minWidth: 176 }}><span className="uav">{initials(who.name)}</span><span className="unm">{who.name}</span><span className="url">{who.code} · Super admin</span></div>
          <span className="muted small" style={{ textAlign: 'center' }}>ໃຫ້ Super admin ໃສ່ PIN ຢູ່ຈໍນີ້ — ໃຊ້ໄດ້ເທື່ອດຽວ ແລະ ມີບັນທຶກວ່າໃຜອະນຸມັດ</span>
          <PinPad value={pin} onChange={setPin} onComplete={go} disabled={busy} shake={shake} />
          <div role="status" aria-live="polite" className="small" style={{ textAlign: 'center', minHeight: 22 }}>{busy ? 'ກຳລັງກວດ…' : ''}</div>
        </>}
        {err && <div className="error" role="alert">{err}</div>}
        <button className="btn ghost" disabled={busy} onClick={() => close(new Error('ຍົກເລີກການອະນຸມັດ'))}>ຍົກເລີກ</button>
      </div>
    </div>
  );
}
