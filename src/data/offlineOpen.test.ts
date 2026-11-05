import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RemoteStore, type Backend, type Row } from './remote';
import { clearLocalCache, localCache } from './offlineCache';
import { sheetsApi } from './sheets';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; }, keys: () => [...m.keys()] }; };
const g = globalThis as any;
beforeEach(() => {
  const ls = memory();
  g.localStorage = new Proxy(ls, { ownKeys: t => t.keys(), getOwnPropertyDescriptor: (t, k) => (typeof k === 'string' && t.getItem(k) !== null ? { enumerable: true, configurable: true, value: t.getItem(k) } : undefined) });
});
afterEach(() => { delete g.localStorage; });

/** A database that can lose its signal. */
class Net implements Backend {
  down = false;
  data: Record<string, Row[]> = {
    branches: [{ id: 'b1', data: { id: 'b1', name: 'ສາຂາຫຼັກ', lat: 17.97, lng: 102.6 } }],
    employees: [{ id: 'e1', data: { id: 'e1', code: 'ST-001', name: 'ສົມ' } }],
    scans: [{ id: 's1', data: { id: 's1', employeeId: 'e1', kind: 'in', photo: 'data:image/jpeg;base64,AAAA' } }]
  };
  async list(_c: string, col: string) { if (this.down) throw new TypeError('Failed to fetch'); return this.data[col] ?? []; }
  async get() { return undefined; }
  async upsert() { if (this.down) throw new TypeError('Failed to fetch'); }
  async del() {}
  async addAudit() {}
  async listAudit() { return []; }
}

describe('opening the app with no signal', () => {
  it('shows the last data this phone was given', async () => {
    const be = new Net(), cache = localCache('c1');
    const online = new RemoteStore(be, 'c1', undefined, cache);
    expect(await online.list('branches')).toHaveLength(1);
    be.down = true;
    const fresh = new RemoteStore(be, 'c1', undefined, localCache('c1')); // the app was closed and opened again
    expect((await fresh.list<any>('branches'))[0].name).toBe('ສາຂາຫຼັກ');
  });
  it('a joined collection (the people) still reads when its parts were kept', async () => {
    const be = new Net(), store = new RemoteStore(be, 'c1', undefined, localCache('c1'));
    await store.list('employees');
    be.down = true;
    expect((await new RemoteStore(be, 'c1', undefined, localCache('c1')).list<any>('employees'))[0]).toMatchObject({ code: 'ST-001', name: 'ສົມ' });
  });
  it('without a kept copy the failure still shows (nothing is invented)', async () => {
    const be = new Net(); be.down = true;
    await expect(new RemoteStore(be, 'c1', undefined, localCache('c1')).list('branches')).rejects.toThrow('Failed to fetch');
  });
  it('a refusal from the server is not mistaken for a missing signal', async () => {
    const be = new Net(), store = new RemoteStore(be, 'c1', undefined, localCache('c1'));
    await store.list('branches');
    be.list = async () => { throw new Error('ບໍ່ມີສິດ'); };
    await expect(store.list('branches')).rejects.toThrow('ບໍ່ມີສິດ');
  });
  it('scans are kept without their photos, and a scan waiting in the outbox still shows', async () => {
    const be = new Net();
    let box: any[] = [];
    const outbox = { read: () => box, write: (q: any[]) => { box = q; } };
    const s = new RemoteStore(be, 'c1', outbox, localCache('c1'));
    await s.list('scans');
    expect(localStorage.getItem('sthr-cache:c1:scans')).not.toContain('base64');
    be.down = true;
    const again = new RemoteStore(be, 'c1', outbox, localCache('c1'));
    await again.put('scans', { id: 's2', employeeId: 'e1', kind: 'out' }, 'e1', 'clock-out'); // no signal → outbox
    expect((await again.list<any>('scans')).map(x => x.id)).toEqual(['s1', 's2']);
  });
  it('sign-out wipes what was kept, but not the clock-ins still waiting to be sent', () => {
    localCache('c1').write('branches', [{ id: 'b', data: {} }]);
    localStorage.setItem('sthr-outbox:c1', '[{"x":1}]');
    clearLocalCache();
    expect(localCache('c1').read('branches')).toBeNull();
    expect(localStorage.getItem('sthr-outbox:c1')).toBe('[{"x":1}]');
  });
  it('a full phone does not break reading', async () => {
    const be = new Net();
    g.localStorage.setItem = () => { throw new Error('quota'); };
    expect(await new RemoteStore(be, 'c1', undefined, localCache('c1')).list('branches')).toHaveLength(1);
  });
});

describe('Google Sheet: staying signed in with no signal', () => {
  let down: boolean;
  const member = { userId: 'u1', companyId: 'c1', employeeId: 'e1', roles: ['employee'] };
  const company = { id: 'c1', name: 'KKK' } as any;
  const fakeFetch = (async (_u: string, init: any) => {
    if (down) throw new TypeError('Failed to fetch');
    const a = JSON.parse(init.body).action as string;
    if (a === 'me') return new Response(JSON.stringify({ ok: true, data: { ...member, company } }));
    if (a === 'login') return new Response(JSON.stringify({ ok: true, data: { token: 't', member, company } }));
    if (a === 'logout') return new Response(JSON.stringify({ ok: true, data: true }));
    return new Response(JSON.stringify({ ok: false, error: 'ຕ້ອງເຂົ້າລະບົບກ່ອນ', code: 'auth' }));
  }) as any;
  let tok: string | null;
  const tokens = { get: () => tok, set: (t: string | null) => { tok = t; } };
  beforeEach(() => { down = false; tok = null; });

  it('opens as the same person and company when the signal is gone', async () => {
    await sheetsApi('https://x/exec', fakeFetch, tokens).signIn('ST-001', '1234');
    down = true;
    const reopened = sheetsApi('https://x/exec', fakeFetch, tokens); // app closed and opened again
    expect(await reopened.currentMember()).toEqual(member);
    expect(await reopened.loadCompany()).toEqual(company);
  });
  it('still asks the server when it can: a closed account is signed out, not kept in', async () => {
    const api = sheetsApi('https://x/exec', fakeFetch, tokens);
    await api.signIn('ST-001', '1234');
    tok = 'revoked';
    const reject = (async () => new Response(JSON.stringify({ ok: false, error: 'ຕ້ອງເຂົ້າລະບົບກ່ອນ', code: 'auth' }))) as any;
    expect(await sheetsApi('https://x/exec', reject, tokens).currentMember()).toBeNull();
    down = true; tok = 'revoked2';
    await expect(sheetsApi('https://x/exec', fakeFetch, tokens).currentMember()).rejects.toThrow(); // nothing kept any more
  });
  it('after sign-out nothing is kept for the next person', async () => {
    const api = sheetsApi('https://x/exec', fakeFetch, tokens);
    await api.signIn('ST-001', '1234');
    await api.signOut();
    tok = 'someone-elses'; down = true;
    await expect(sheetsApi('https://x/exec', fakeFetch, tokens).currentMember()).rejects.toThrow();
  });
  it('without a token it never claims a person', async () => {
    down = true;
    expect(await sheetsApi('https://x/exec', fakeFetch, tokens).currentMember()).toBeNull();
  });
});
