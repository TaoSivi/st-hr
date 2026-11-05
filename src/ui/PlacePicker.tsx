import { useState } from 'react';
import { getPosition, searchPlaces, type Place } from '../device/geo';

/**
 * Two ways to set a branch's point, shared by "new branch" and "edit branch":
 * one button that takes where you stand right now, and a search box (a shop name, a street, a village) with its answers to tap.
 * It only reports a point; the form decides when to save.
 */
export default function PlacePicker({ lat, lng, onPick }: { lat: string; lng: string; onPick: (p: { lat: number; lng: number }, note: string) => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState<'' | 'gps' | 'search'>('');
  const [err, setErr] = useState('');

  const here = async () => {
    setErr(''); setBusy('gps');
    const p = await getPosition();
    setBusy('');
    if (!p) return setErr('ອ່ານຕຳແໜ່ງບໍ່ໄດ້ — ເປີດສິດຕຳແໜ່ງ (Location) ໃຫ້ເວັບນີ້ ແລ້ວລອງໃໝ່, ຫຼື ຄົ້ນຫາຊື່ບ່ອນແທນ');
    onPick({ lat: p.lat, lng: p.lng }, `ໃຊ້ຕຳແໜ່ງປັດຈຸບັນ (ຄາດເຄື່ອນ ±${Math.round(p.accuracyM)} ມ.)`);
    setFound(null);
  };
  const search = async () => {
    setErr(''); setBusy('search');
    try { setFound(await searchPlaces(q)); } catch (e: any) { setFound(null); setErr(e?.message || 'ຄົ້ນຫາບໍ່ໄດ້'); }
    setBusy('');
  };
  const la = Number(lat), ln = Number(lng), ok = lat.trim() !== '' && lng.trim() !== '' && Number.isFinite(la) && Number.isFinite(ln);

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row wrap">
        <button type="button" className="btn" disabled={busy !== ''} onClick={here}>{busy === 'gps' ? 'ກຳລັງອ່ານຕຳແໜ່ງ…' : '📍 ໃຊ້ຕຳແໜ່ງຂ້ອຍຕອນນີ້'}</button>
        <span className="muted small">ຢືນຢູ່ສາຂາແລ້ວກົດປຸ່ມດຽວ</span>
      </div>
      <form className="row wrap" onSubmit={e => { e.preventDefault(); if (busy === '') search(); }} role="search">
        <input className="input grow" style={{ minWidth: 200 }} placeholder="ຫຼື ຄົ້ນຫາຊື່ບ່ອນ / ທີ່ຢູ່ (ເຊັ່ນ ຕະຫຼາດເຊົ້າ ວຽງຈັນ)" aria-label="ຄົ້ນຫາບ່ອນ" value={q} onChange={e => setQ(e.target.value)} />
        <button type="submit" className="btn ghost" disabled={busy !== '' || q.trim().length < 2}>{busy === 'search' ? 'ກຳລັງຄົ້ນຫາ…' : '🔍 ຄົ້ນຫາ'}</button>
      </form>
      {err && <span className="small" role="alert" style={{ color: 'var(--bad)' }}>{err}</span>}
      {found && found.length === 0 && <span className="muted small">ບໍ່ພົບບ່ອນນີ້ — ລອງຊື່ອື່ນ ຫຼື ຂຽນໃຫ້ລະອຽດຂຶ້ນ (ບ້ານ, ເມືອງ)</span>}
      {found && found.length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          <span className="muted small">ກົດເລືອກບ່ອນທີ່ຖືກ:</span>
          {found.map((p, i) => (
            <button key={i} type="button" className="btn ghost" style={{ justifyContent: 'flex-start', textAlign: 'left', height: 'auto', padding: '8px 12px', whiteSpace: 'normal' }}
              onClick={() => { onPick({ lat: p.lat, lng: p.lng }, 'ເລືອກຈາກການຄົ້ນຫາ'); setFound(null); setQ(''); }}>
              <span className="col" style={{ gap: 0, alignItems: 'flex-start' }}><span>{p.name}</span><span className="muted small">{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</span></span>
            </button>))}
        </div>)}
      {ok && <a className="small" href={`https://www.google.com/maps?q=${la},${ln}`} target="_blank" rel="noopener noreferrer">ເບິ່ງຈຸດນີ້ໃນແຜນທີ່ ↗</a>}
    </div>
  );
}
