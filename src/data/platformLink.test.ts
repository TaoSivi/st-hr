import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPlatformHrUrl, readServerConfig, takeServerParam } from './server';

/** Opened from the platform launcher: ?server=<site>/api/t/<company>/hr points this phone at that company's HR. */
const URL_A = 'https://stdev.store/api/t/hrco/hr';
const URL_B = 'https://stdev.store/api/t/hr2/hr';

function browser(search: string, store: Record<string, string> = {}) {
  const loc = { search, pathname: '/st-hr/', hash: '' };
  const replaced: string[] = [];
  vi.stubGlobal('location', loc);
  vi.stubGlobal('history', { replaceState: (_s: unknown, _t: string, u: string) => { replaced.push(u); } });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; }
  });
  return { store, replaced };
}

describe('platform HR address', () => {
  it('accepts only <site>/api/t/<company>/hr (or a local test server)', () => {
    expect(isPlatformHrUrl(URL_A)).toBe(true);
    expect(isPlatformHrUrl('http://localhost:3000/api/t/hrco/hr')).toBe(true);
    expect(isPlatformHrUrl('http://127.0.0.1:3000/api/t/hrco/hr')).toBe(true);
    for (const bad of ['http://stdev.store/api/t/hrco/hr', 'https://stdev.store/api/t/hrco/erp', 'https://stdev.store/api/t/hrco/hr/x', 'https://stdev.store/api/t/../hr',
      'https://evil.example/x?u=https://stdev.store/api/t/hrco/hr', 'javascript:alert(1)', 'https://script.google.com/macros/s/AK/exec', '']) expect(isPlatformHrUrl(bad)).toBe(false);
  });
});

describe('takeServerParam', () => {
  beforeEach(() => { vi.stubGlobal('import.meta', {}); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('does nothing without the parameter', () => {
    const b = browser('');
    expect(takeServerParam()).toBeNull();
    expect(b.replaced).toEqual([]);
    expect(b.store).toEqual({});
  });

  it('saves a good address as the Sheets-protocol server and takes it out of the address bar', () => {
    const b = browser('?server=' + encodeURIComponent(URL_A) + '&x=1');
    expect(takeServerParam()).toBe(URL_A);
    expect(JSON.parse(b.store['sthr-server'])).toEqual({ kind: 'sheets', url: URL_A, key: '' });
    expect(b.replaced).toEqual(['/st-hr/?x=1']);
    expect(readServerConfig()).toMatchObject({ kind: 'sheets', url: URL_A });
  });

  it('refuses a bad address but still removes it from the address bar', () => {
    const b = browser('?server=' + encodeURIComponent('https://evil.example/api/t/a/erp'));
    expect(takeServerParam()).toBeNull();
    expect(b.store['sthr-server']).toBeUndefined();
    expect(b.replaced).toEqual(['/st-hr/']);
  });

  it('moving to another company clears the old sign-in so a session never crosses companies', () => {
    const b = browser('?server=' + encodeURIComponent(URL_B), {
      'sthr-server': JSON.stringify({ kind: 'sheets', url: URL_A, key: '' }), 'sthr-sheets-token': 'old', 'sthr-sheets-me': '{}', 'sthr-sheets-logins': '[]', 'sthr-sheets-info': '{}', 'sthr-online': 'c-1', other: 'keep'
    });
    expect(takeServerParam()).toBe(URL_B);
    expect(b.store['sthr-sheets-token']).toBeUndefined();
    expect(b.store['sthr-sheets-me']).toBeUndefined();
    expect(b.store['sthr-sheets-logins']).toBeUndefined();
    expect(b.store['sthr-sheets-info']).toBeUndefined();
    expect(b.store['sthr-online']).toBeUndefined();
    expect(b.store.other).toBe('keep');
    expect(JSON.parse(b.store['sthr-server']).url).toBe(URL_B);
  });

  it('opening the same company again keeps the signed-in session', () => {
    const b = browser('?server=' + encodeURIComponent(URL_A), { 'sthr-server': JSON.stringify({ kind: 'sheets', url: URL_A, key: '' }), 'sthr-sheets-token': 'keep-me', 'sthr-online': 'c-1' });
    expect(takeServerParam()).toBe(URL_A);
    expect(b.store['sthr-sheets-token']).toBe('keep-me');
    expect(b.store['sthr-online']).toBe('c-1');
  });
});
