import { useState } from 'react';
import { useHR } from '../app/state';
import type { Employee } from '../domain/types';
import { isActiveOn } from '../domain/hiring';
import { afterFail, lockedMinutes, MAX_FAILS, pinFields, pinMatches, pinProblem, type LockState } from '../domain/pin';
import { ymd } from './format';

const lockKey = (companyId: string, code: string) => `sthr-lock:${companyId}:${code.trim().toUpperCase()}`;
const readLock = (k: string): LockState | undefined => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? undefined; } catch { return undefined; } };
const writeLock = (k: string, s: LockState | null) => { try { s ? localStorage.setItem(k, JSON.stringify(s)) : localStorage.removeItem(k); } catch { /* private mode: no lock memory */ } };

const pinInput = (value: string, set: (v: string) => void, label: string, auto?: string) => (
  <label className="field">{label}
    <input className="input" type="password" inputMode="numeric" autoComplete={auto ?? 'current-password'} maxLength={6} value={value}
      onChange={e => set(e.target.value.replace(/\D/g, '').slice(0, 6))} style={{ letterSpacing: 6, fontSize: 20 }} />
  </label>
);

/** Choose a PIN twice; used for the first owner PIN and after a reset. */
export function NewPin({ who, title, note, onSet, onCancel, online }: { who: Employee; title: string; note: string; onSet: (pin: string) => Promise<void>; onCancel: () => void; online?: boolean }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    const p = pinProblem(a, online);
    if (p) return setErr(p);
    if (a !== b) return setErr('PIN ທັງສອງບໍ່ກົງກັນ');
    setBusy(true);
    try { await onSet(a); } catch (e: any) { setErr(e?.message || 'ບັນທຶກບໍ່ໄດ້'); setBusy(false); }
  };
  return (
    <div className="card col">
      <h2>{title}</h2>
      <span className="muted">{who.name} ({who.code})</span>
      <span className="muted small">{note}</span>
      {pinInput(a, setA, online ? 'PIN ໃໝ່ (6 ຕົວເລກ)' : 'PIN ໃໝ່ (4–6 ຕົວເລກ)', 'new-password')}
      {pinInput(b, setB, 'ໃສ່ PIN ອີກເທື່ອ', 'new-password')}
      {err && <div className="error" role="alert">{err}</div>}
      <div className="row"><button className="btn ghost grow" onClick={onCancel}>ຍົກເລີກ</button><button className="btn grow" disabled={busy || !a || !b} onClick={go}>ບັນທຶກ PIN</button></div>
    </div>
  );
}

/**
 * Sign in for a real company: employee code + PIN. The demo company keeps its quick "pick a person" list so every role can be tried.
 * A company where nobody has a PIN yet (created before PINs existed) lets an owner set the first one.
 */
export default function Login() {
  const hr = useHR();
  const today = ymd(new Date());
  const active = hr.employees.filter(e => isActiveOn(e, today));
  const anyPin = active.some(e => e.pinHash);
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState<Employee | null>(null); // signed in with a reset PIN: must pick their own first
  const [firstOwner, setFirstOwner] = useState<Employee | null>(null);

  const signIn = async () => {
    setErr('');
    const k = lockKey(hr.companyId, code);
    const lock = readLock(k);
    const wait = lockedMinutes(lock, Date.now());
    if (wait) return setErr(`ໃສ່ PIN ຜິດຫຼາຍເທື່ອ — ລໍອີກ ${wait} ນາທີ`);
    const e = active.find(x => x.code.trim().toUpperCase() === code.trim().toUpperCase());
    if (e && !e.pinHash) return setErr('ບັນຊີນີ້ຍັງບໍ່ມີ PIN — ຂໍ PIN ຈາກເຈົ້າຂອງ / HR');
    setBusy(true);
    const ok = !!e && await pinMatches(e, pin);
    setBusy(false);
    if (!ok) {
      const next = afterFail(lock, Date.now());
      writeLock(k, next);
      setPin('');
      const left = lockedMinutes(next, Date.now());
      return setErr(left ? `ໃສ່ PIN ຜິດ ${MAX_FAILS} ເທື່ອ — ລໍ ${left} ນາທີ ແລ້ວລອງໃໝ່` : `ລະຫັດພະນັກງານ ຫຼື PIN ບໍ່ຖືກ (ລອງໄດ້ອີກ ${MAX_FAILS - next.fails} ເທື່ອ)`);
    }
    writeLock(k, null);
    if (e!.pinMustChange) return setChanging(e!);
    hr.setMe(e!.id);
  };

  const setOwnPin = (e: Employee, action: string) => async (p: string) => {
    if (await pinMatches(e, p)) throw new Error('PIN ໃໝ່ຕ້ອງບໍ່ຊ້ຳກັບ PIN ຊົ່ວຄາວ');
    await hr.save('employees', { ...e, ...(await pinFields(p, false)) }, action, e.id);
    hr.setMe(e.id);
  };

  if (changing) return <NewPin who={changing} title="ຕັ້ງ PIN ຂອງເຈົ້າເອງ" note="PIN ທີ່ໄດ້ຮັບເປັນ PIN ຊົ່ວຄາວ. ຕັ້ງ PIN ໃໝ່ທີ່ມີແຕ່ເຈົ້າຮູ້ ກ່ອນເຂົ້າໃຊ້." onSet={setOwnPin(changing, 'pin-change')} onCancel={() => { setChanging(null); setPin(''); }} />;
  if (firstOwner) return <NewPin who={firstOwner} title="ຕັ້ງ PIN ເຈົ້າຂອງ" note="ບໍລິສັດນີ້ຍັງບໍ່ມີ PIN. ຕັ້ງ PIN ໃຫ້ເຈົ້າຂອງກ່ອນ ແລ້ວອອກ PIN ໃຫ້ພະນັກງານໃນໜ້າ ສິດ & ການອະນຸມັດ." onSet={setOwnPin(firstOwner, 'pin-first')} onCancel={() => setFirstOwner(null)} />;

  if (!anyPin) {
    const owners = active.filter(e => e.roles.includes('owner'));
    return (
      <div className="card col">
        <h2>ຕັ້ງ PIN ເທື່ອທຳອິດ</h2>
        <span className="muted small">ບໍລິສັດນີ້ຍັງບໍ່ມີໃຜມີ PIN. ເລືອກເຈົ້າຂອງເພື່ອຕັ້ງ PIN — ຫຼັງຈາກນັ້ນທຸກຄົນຕ້ອງເຂົ້າດ້ວຍລະຫັດພະນັກງານ + PIN.</span>
        {owners.map(o => <button key={o.id} className="btn ghost" onClick={() => setFirstOwner(o)}>{o.name} ({o.code})</button>)}
        {!owners.length && <div className="error">ບໍ່ພົບເຈົ້າຂອງໃນບໍລິສັດນີ້</div>}
      </div>
    );
  }

  return (
    <form className="card col" onSubmit={e => { e.preventDefault(); signIn(); }}>
      <h2>ເຂົ້າລະບົບ</h2>
      <label className="field">ລະຫັດພະນັກງານ
        <input className="input" autoComplete="username" autoCapitalize="characters" placeholder="ເຊັ່ນ ST-012" value={code} onChange={e => setCode(e.target.value)} style={{ fontSize: 18 }} />
      </label>
      {pinInput(pin, setPin, 'PIN')}
      {err && <div className="error" role="alert">{err}</div>}
      <button className="btn block" type="submit" disabled={busy || !code.trim() || pin.length < 4}>ເຂົ້າລະບົບ</button>
      <span className="muted small">ລືມ PIN: ຂໍໃຫ້ເຈົ້າຂອງ / HR ຕັ້ງ PIN ຊົ່ວຄາວໃຫ້ໃໝ່.</span>
    </form>
  );
}
