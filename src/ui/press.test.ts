import { describe, expect, it } from 'vitest';
import { rippleBox, RIPPLE_HOSTS } from './press';

const rect = { left: 100, top: 200, width: 200, height: 60 };

describe('the ripple that grows from the finger', () => {
  it('is centred on the touch point', () => {
    const b = rippleBox(rect, 150, 230);
    expect(b.left + b.size / 2).toBeCloseTo(50, 5); // x inside the button
    expect(b.top + b.size / 2).toBeCloseTo(30, 5); // y inside the button
  });
  it('is big enough to cover the whole button from any corner or the middle', () => {
    const covers = (x: number, y: number) => {
      const b = rippleBox(rect, x, y);
      const r = b.size / 2;
      const cx = x - rect.left, cy = y - rect.top;
      return [[0, 0], [rect.width, 0], [0, rect.height], [rect.width, rect.height]].every(([px, py]) => Math.hypot(px - cx, py - cy) <= r + 1e-9);
    };
    for (const [x, y] of [[100, 200], [300, 260], [100, 260], [300, 200], [200, 230], [101, 201]]) expect(covers(x, y), `${x},${y}`).toBe(true);
  });
  it('grows when the touch is near a corner, because the far corner is farther away', () => {
    expect(rippleBox(rect, 101, 201).size).toBeGreaterThan(rippleBox(rect, 200, 230).size);
  });
  it('lists the controls that ripple, and not the small icon buttons that carry badges', () => {
    expect(RIPPLE_HOSTS).toContain('.clock-btn');
    expect(RIPPLE_HOSTS).toContain('.bottomnav button');
    expect(RIPPLE_HOSTS).not.toContain('.icon-btn'); // a badge sits on the edge of these and would be clipped
  });
});
