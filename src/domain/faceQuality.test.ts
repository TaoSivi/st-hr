import { describe, expect, it } from 'vitest';
import { BLURRY, DARK_LUMA, exposureBoost, frameAdvice, frameStats, ISSUE_TEXT, MAX_BOOST, TOO_BRIGHT, TOO_DARK } from './faceQuality';

/** An RGBA image from a function of (x, y) → grey level. */
const image = (w: number, h: number, grey: (x: number, y: number) => number) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = grey(x, y); d[i + 3] = 255; }
  return d;
};
const W = 64, H = 48;
const checker = (period: number) => (x: number, y: number) => (((x / period) | 0) + ((y / period) | 0)) % 2 ? 220 : 30;
/** 3×3 box blur of a grey image, applied n times: a stand-in for an out-of-focus lens. */
const blur = (d: Uint8ClampedArray, n: number) => {
  let cur = d;
  for (let k = 0; k < n; k++) {
    const out = new Uint8ClampedArray(cur.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) { s += cur[(yy * W + xx) * 4]; c++; } }
      const i = (y * W + x) * 4; out[i] = out[i + 1] = out[i + 2] = s / c; out[i + 3] = 255;
    }
    cur = out;
  }
  return cur;
};

describe('measuring a frame', () => {
  it('reads brightness as the mean grey level', () => {
    expect(frameStats(image(W, H, () => 100), W, H).luma).toBeCloseTo(100, 0);
    expect(frameStats(image(W, H, () => 0), W, H).luma).toBe(0);
    expect(frameStats(image(W, H, () => 255), W, H).luma).toBeCloseTo(255, 0);
  });
  it('a flat frame has no sharpness; a detailed one has a lot; blurring takes it away', () => {
    const sharp = image(W, H, checker(2));
    expect(frameStats(image(W, H, () => 128), W, H).sharpness).toBe(0);
    const s0 = frameStats(sharp, W, H).sharpness;
    const s1 = frameStats(blur(sharp, 1), W, H).sharpness;
    const s3 = frameStats(blur(sharp, 3), W, H).sharpness;
    expect(s0).toBeGreaterThan(s1);
    expect(s1).toBeGreaterThan(s3);
    expect(s0).toBeGreaterThan(BLURRY);
    expect(s3).toBeLessThan(BLURRY);
  });
  it('does not blow up on a tiny or empty image', () => {
    expect(frameStats([], 0, 0)).toEqual({ luma: 0, sharpness: 0 });
    expect(frameStats(image(2, 2, () => 50), 2, 2)).toEqual({ luma: 50, sharpness: 0 });
  });
});

describe('brightening a dark frame', () => {
  it('leaves normal and bright frames alone', () => {
    expect(exposureBoost(DARK_LUMA)).toBe(1);
    expect(exposureBoost(130)).toBe(1);
    expect(exposureBoost(220)).toBe(1);
    expect(exposureBoost(NaN)).toBe(1);
  });
  it('lifts a dark frame towards normal, never by more than the cap', () => {
    expect(exposureBoost(55)).toBeCloseTo(2, 5);
    expect(exposureBoost(40)).toBeCloseTo(2.75, 5);
    expect(exposureBoost(10)).toBe(MAX_BOOST);
    expect(exposureBoost(0)).toBe(MAX_BOOST);
    expect(55 * exposureBoost(55)).toBeCloseTo(110, 0);
  });
});

describe('what to tell the person', () => {
  const ok = { luma: 120, sharpness: 300 };
  it('a good frame with a good face needs no advice', () => expect(frameAdvice(ok, 0.45)).toBeNull());
  it('too dark or too bright is named first, since a dark frame also looks blurry', () => {
    expect(frameAdvice({ luma: TOO_DARK - 1, sharpness: 5 }, null)).toBe('dark');
    expect(frameAdvice({ luma: TOO_BRIGHT + 1, sharpness: 5 }, null)).toBe('bright');
    expect(frameAdvice({ luma: TOO_DARK, sharpness: 300 }, 0.4)).toBeNull();
  });
  it('a blurry frame, a face that is too small, and no face at all each get their own advice', () => {
    expect(frameAdvice({ luma: 120, sharpness: BLURRY - 1 }, 0.4)).toBe('blur');
    expect(frameAdvice(ok, 0.1)).toBe('far');
    expect(frameAdvice(ok, null)).toBe('noface');
  });
  it('every issue has a Lao sentence', () => {
    for (const k of ['dark', 'bright', 'blur', 'far', 'noface'] as const) expect(ISSUE_TEXT[k], k).toMatch(/[຀-໿]/);
  });
});
