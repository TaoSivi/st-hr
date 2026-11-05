import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { peekSheetInfo, sheetsApi } from './sheets';

// Every trip to Apps Script costs a second or two, so the app must not make a trip it can avoid.
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };

describe('Google Sheet: fewer trips', () => {
  const g = globalThis as any;
  let calls: string[];
  const answer = (body: any) => new Response(JSON.stringify({ ok: true, data: body }));
  const fakeFetch = (async (_u: string, init: any) => { const a = JSON.parse(init.body).action as string; calls.push(a); return a === 'info' ? answer({ companyId: 'c1', name: 'KKK', users: [{ code: 'ST-001', name: 'Boun', role: 'owner' }] }) : answer(null); }) as any;
  const tokens = { get: () => null as string | null, set: () => {} };
  beforeEach(() => { calls = []; g.localStorage = memory(); });
  afterEach(() => { delete g.localStorage; });

  it('asks for the sign-in info once while it is fresh, and remembers it for the next visit', async () => {
    const api = sheetsApi('https://x/exec', fakeFetch, tokens);
    await Promise.all([api.info(), api.info()]);
    await api.info();
    expect(calls).toEqual(['info']);
    expect(peekSheetInfo()).toEqual({ companyId: 'c1', name: 'KKK', users: [{ code: 'ST-001', name: 'Boun', role: 'owner' }] });
  });

  it('nothing remembered gives nothing, and rubbish in storage is ignored', () => {
    expect(peekSheetInfo()).toBeNull();
    g.localStorage.setItem('sthr-sheets-info', '{"nope":1}');
    expect(peekSheetInfo()).toBeNull();
    g.localStorage.setItem('sthr-sheets-info', 'not json');
    expect(peekSheetInfo()).toBeNull();
  });
});
