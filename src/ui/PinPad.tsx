import { useEffect, useRef } from 'react';
import { ONLINE_PIN_LEN } from '../domain/pin';

/**
 * The PIN number pad, as in ST POS: dots that fill as you press, a 3x4 pad, and the PIN goes in by itself at the last digit.
 * The parent holds the digits so it can clear them after a wrong PIN. A physical keyboard works too.
 */
export default function PinPad({ value, onChange, onComplete, len = ONLINE_PIN_LEN, disabled, shake, label }: {
  value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; len?: number; disabled?: boolean; shake?: boolean; label?: string;
}) {
  const live = useRef({ value, onChange, onComplete, disabled });
  live.current = { value, onChange, onComplete, disabled };

  const press = (k: string) => {
    const { value: v, onChange: change, onComplete: done, disabled: off } = live.current;
    if (off) return;
    if (k === 'C') return change('');
    if (k === '⌫') return change(v.slice(0, -1));
    if (v.length >= len) return;
    const next = v + k;
    change(next);
    if (next.length === len) done?.(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('⌫');
      else if (e.key === 'Escape') press('C');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [len]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="pinpad" aria-label={label ?? `PIN ${len} ຕົວເລກ`}>
      <div className={`pindots${shake ? ' shake' : ''}`} role="img" aria-label={`ໃສ່ແລ້ວ ${value.length} ຈາກ ${len} ຕົວ`}>
        {Array.from({ length: len }, (_, i) => <span key={i} className={i < value.length ? 'f' : ''} />)}
      </div>
      <div className="numpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map(k => (
          <button key={k} type="button" disabled={disabled} aria-label={k === 'C' ? 'ລຶບທັງໝົດ' : k === '⌫' ? 'ລຶບຕົວສຸດທ້າຍ' : k} onClick={() => press(k)}>{k}</button>
        ))}
      </div>
    </div>
  );
}
