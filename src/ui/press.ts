/**
 * Tap feedback: a ripple that grows from the finger, the tap point remembered for full-screen openings that expand from it,
 * and a tiny buzz on phones that support it. Everything is skipped for people who ask for reduced motion.
 */

/** A ripple circle that is big enough to cover the whole button from wherever it was touched. */
export function rippleBox(rect: { left: number; top: number; width: number; height: number }, x: number, y: number) {
  const px = x - rect.left, py = y - rect.top;
  const reach = Math.max(Math.hypot(px, py), Math.hypot(rect.width - px, py), Math.hypot(px, rect.height - py), Math.hypot(rect.width - px, rect.height - py));
  const size = Math.ceil(reach * 2);
  return { size, left: px - size / 2, top: py - size / 2 };
}

/** Things that get a ripple. Each also needs `position: relative; overflow: hidden` (set in the stylesheet). */
export const RIPPLE_HOSTS = '.btn, .clock-btn, .day-action, .bottomnav button, .loc-chip, .tabs button, .subtabs button, .drawer button, .mgr nav button, .fab, .cal-d';
/** Things that give a small buzz. */
const BUZZ_HOSTS = '.clock-btn, .bottomnav button, .cal-d, .day-action, .fab';

export const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function installPress(root: Document = document) {
  const html = root.documentElement;
  root.addEventListener('pointerdown', (e: PointerEvent) => {
    // where the finger is, for animations that open from it
    html.style.setProperty('--tap-x', `${e.clientX}px`);
    html.style.setProperty('--tap-y', `${e.clientY}px`);
    if (prefersReducedMotion()) return;
    const target = e.target instanceof Element ? e.target : null;
    const host = target?.closest<HTMLElement>(RIPPLE_HOSTS);
    if (!host || (host as HTMLButtonElement).disabled) return;
    const box = rippleBox(host.getBoundingClientRect(), e.clientX, e.clientY);
    const dot = root.createElement('span');
    dot.className = 'ripple-dot';
    dot.style.cssText = `width:${box.size}px;height:${box.size}px;left:${box.left}px;top:${box.top}px`;
    host.appendChild(dot);
    const drop = () => dot.remove();
    dot.addEventListener('animationend', drop, { once: true });
    setTimeout(drop, 900); // in case the animation never finishes (tab hidden)
    if (target?.closest(BUZZ_HOSTS) && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch { /* not allowed here */ } }
  }, { passive: true });
}
