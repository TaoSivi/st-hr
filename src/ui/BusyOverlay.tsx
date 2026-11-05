import { useEffect, useRef, useState } from 'react';
import { onSheetsWaiting } from '../data/sheets';

const SHOW_AFTER_MS = 350; // a quick answer never flashes a card
const SHOW_AT_LEAST_MS = 700; // once shown, stays long enough to be read instead of blinking

/**
 * "One moment" card: when someone taps something and the Google Sheet takes a while to answer, a calm card says what is happening.
 * It appears only if the wait passes a third of a second, and it never shows for the refresh that runs by itself in the background.
 */
export default function BusyOverlay() {
  const [label, setLabel] = useState<string | null>(null);
  const shownAt = useRef(0);
  const timers = useRef<{ show?: number; hide?: number }>({});

  useEffect(() => {
    const t = timers.current;
    const off = onSheetsWaiting(list => {
      window.clearTimeout(t.hide);
      if (list.length) {
        const text = list[list.length - 1].label;
        if (shownAt.current) { setLabel(text); return; } // already on screen: just update the words
        window.clearTimeout(t.show);
        t.show = window.setTimeout(() => { shownAt.current = Date.now(); setLabel(text); }, SHOW_AFTER_MS);
      } else {
        window.clearTimeout(t.show);
        if (!shownAt.current) return;
        const left = Math.max(0, SHOW_AT_LEAST_MS - (Date.now() - shownAt.current));
        t.hide = window.setTimeout(() => { shownAt.current = 0; setLabel(null); }, left);
      }
    });
    return () => { off(); window.clearTimeout(t.show); window.clearTimeout(t.hide); };
  }, []);

  if (!label) return null;
  return (
    <div className="busy-back" role="status" aria-live="polite" aria-busy="true">
      <div className="busy-card">
        <div className="busy-ring" aria-hidden="true"><span /></div>
        <b className="busy-title">{label}<span className="busy-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></b>
        <span className="busy-sub">ລໍສັກຄູ່ ເຊີບເວີ Google ຕອບຊ້າເລັກນ້ອຍ — ຢ່າປິດໜ້ານີ້</span>
      </div>
    </div>
  );
}
