import { useEffect, useState, type ReactNode } from 'react';

/** Small motion helpers shared by every screen. All of them stand still when the phone asks for reduced motion. */
export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A number that counts up to its value when it first appears, and glides to a new value when it changes. */
export function useCountUp(to: number, ms = 700): number {
  const [v, setV] = useState(() => (reducedMotion() ? to : 0));
  useEffect(() => {
    if (reducedMotion()) { setV(to); return; }
    let raf = 0;
    const from = v, t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(from + (to - from) * (1 - Math.pow(1 - p, 3))); // ease out
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

/** `<CountUp to={1234567} format={money} />` — whole numbers by default. */
export function CountUp({ to, format }: { to: number; format?: (n: number) => string }) {
  const v = useCountUp(Number.isFinite(to) ? to : 0);
  const n = Math.round(v);
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{format ? format(n) : String(n)}</span>;
}

/** A ring that fills to `share` (0..1) a moment after it appears. The middle is whatever is passed in. */
export function Ring({ share, size = 64, stroke = 6, color = 'var(--accent)', track = 'rgba(255,255,255,.2)', children, label }: { share: number; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode; label?: string }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const s = Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0));
  const [armed, setArmed] = useState(reducedMotion());
  useEffect(() => { const id = requestAnimationFrame(() => setArmed(true)); return () => cancelAnimationFrame(id); }, []);
  return (
    <span className="ring" style={{ width: size, height: size }} role={label ? 'img' : undefined} aria-label={label}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={armed ? c * (1 - s) : c} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="ring-arc" />
      </svg>
      <span className="ring-mid">{children}</span>
    </span>
  );
}

/** Shown while the first data is on its way: the shape of the screen, shimmering, instead of a blank line of text. */
export function LoadingSkeleton({ title = 'ກຳລັງໂຫຼດ…', hint }: { title?: string; hint?: string }) {
  return (
    <div className="skel-page" role="status" aria-live="polite">
      <div className="skel-bar skel-head" />
      <div className="skel-row"><div className="skel-bar skel-pill" /><div className="skel-bar skel-pill" /><div className="skel-bar skel-pill" /></div>
      <div className="skel-card"><div className="skel-bar" style={{ width: '45%' }} /><div className="skel-bar" style={{ width: '80%' }} /><div className="skel-bar" style={{ width: '62%' }} /></div>
      <div className="skel-card"><div className="skel-bar" style={{ width: '55%' }} /><div className="skel-bar" style={{ width: '70%' }} /></div>
      <div className="skel-say"><b>{title}</b>{hint && <span className="muted small">{hint}</span>}</div>
    </div>
  );
}
