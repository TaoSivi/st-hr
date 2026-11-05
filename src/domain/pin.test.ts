import { describe, expect, it } from 'vitest';
import { afterFail, hashPin, lockedMinutes, LOCK_MINUTES, MAX_FAILS, ONLINE_PIN_LEN, pinFields, pinMatches, pinProblem, tempPin } from './pin';

describe('which PINs are allowed', () => {
  it('4 to 6 digits', () => {
    expect(pinProblem('2580')).toBeNull();
    expect(pinProblem('905132')).toBeNull();
    expect(pinProblem('258')).toMatch('4–6');
    expect(pinProblem('9051327')).toMatch('4–6');
    expect(pinProblem('12a4')).toMatch('ຕົວເລກ');
    expect(pinProblem('')).toMatch('ຕົວເລກ');
  });
  it('not the ones everyone tries first', () => {
    for (const p of ['0000', '111111', '1234', '123456', '4321', '654321', '6789']) expect(pinProblem(p), p).not.toBeNull();
  });
  it('a temporary PIN always passes the rules', () => {
    for (let i = 0; i < 200; i++) { const p = tempPin(); expect(pinProblem(p), p).toBeNull(); expect(p).toHaveLength(6); }
    for (let i = 0; i < 200; i++) { const p = tempPin(ONLINE_PIN_LEN); expect(pinProblem(p, true), p).toBeNull(); } // the online length passes the online check
  });
});

describe('storing and checking a PIN', () => {
  it('keeps only a salted hash, never the PIN', async () => {
    const f = await pinFields('2580', false);
    expect(JSON.stringify(f)).not.toContain('2580');
    expect(f.pinHash).toMatch(/^[0-9a-f]{64}$/);
    expect(f.pinSalt).toMatch(/^[0-9a-f]{32}$/);
    expect(f.pinMustChange).toBeUndefined();
  });
  it('the same PIN gives a different hash for each person (salt)', async () => {
    const a = await pinFields('2580', false), b = await pinFields('2580', false);
    expect(a.pinHash).not.toBe(b.pinHash);
  });
  it('matches the right PIN only', async () => {
    const f = await pinFields('2580', false);
    expect(await pinMatches(f, '2580')).toBe(true);
    expect(await pinMatches(f, '2581')).toBe(false);
    expect(await pinMatches({}, '2580')).toBe(false); // no PIN set: nobody gets in
  });
  it('a reset PIN must be changed at the next sign-in', async () => {
    expect((await pinFields('905132', true)).pinMustChange).toBe(true);
  });
  it('hashing is stable', async () => expect(await hashPin('2580', 'abc')).toBe(await hashPin('2580', 'abc')));
});

describe('locking an account after wrong PINs', () => {
  const t0 = 1_000_000;
  it(`${MAX_FAILS} wrong PINs lock it for ${LOCK_MINUTES} minutes`, () => {
    let s;
    for (let i = 0; i < MAX_FAILS - 1; i++) s = afterFail(s, t0);
    expect(lockedMinutes(s, t0)).toBe(0);
    s = afterFail(s, t0);
    expect(lockedMinutes(s, t0)).toBe(LOCK_MINUTES);
    expect(lockedMinutes(s, t0 + 60_000)).toBe(LOCK_MINUTES - 1);
    expect(lockedMinutes(s, t0 + LOCK_MINUTES * 60_000)).toBe(0);
  });
  it('after the lock runs out, the count starts again', () => {
    let s;
    for (let i = 0; i < MAX_FAILS; i++) s = afterFail(s, t0);
    s = afterFail(s, t0 + LOCK_MINUTES * 60_000 + 1);
    expect(s.fails).toBe(1);
    expect(lockedMinutes(s, t0 + LOCK_MINUTES * 60_000 + 1)).toBe(0);
  });
});
