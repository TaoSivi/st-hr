import { describe, expect, it } from 'vitest';
import { closeDelayMs } from './closing';

describe('how long a closing animation is given', () => {
  it('the full time normally, none for people who asked for reduced motion', () => {
    expect(closeDelayMs(260, false)).toBe(260);
    expect(closeDelayMs(260, true)).toBe(0);
  });
});
