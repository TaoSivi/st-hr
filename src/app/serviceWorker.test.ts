import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * public/sw.js run against a pretend site, to prove the app opens with no signal:
 * everything it needs is saved when the worker installs (no reload needed), and a page opened offline is answered from that copy.
 */
const SCOPE = 'https://h.example/st-hr/';
const SITE: Record<string, string> = {
  '': '<!doctype html><link rel="manifest" href="./manifest.webmanifest"><script type="module" src="./assets/index-AAA.js"></script><link rel="stylesheet" href="./assets/index-BBB.css">',
  'manifest.webmanifest': '{}',
  'assets/index-AAA.js': 'const f=()=>import("./face-api.esm-CCC.js");const deps=["assets/face-api.esm-CCC.js","assets/browser-DDD.js"];',
  'assets/index-BBB.css': 'body{}',
  'assets/face-api.esm-CCC.js': 'export default 1',
  'assets/browser-DDD.js': 'export default 2'
};
for (const m of ['tiny_face_detector_model-weights_manifest.json', 'tiny_face_detector_model.bin', 'face_landmark_68_tiny_model-weights_manifest.json', 'face_landmark_68_tiny_model.bin', 'face_recognition_model-weights_manifest.json', 'face_recognition_model.bin']) SITE['models/' + m] = 'm';

let store: Map<string, Response>;
let online: boolean;
let redirected: Set<string>;
let handlers: Record<string, (e: any) => void>;

const keyOf = (k: any) => (typeof k === 'string' ? k : k.url);
const cacheApi = {
  async open() {
    return {
      async put(k: any, r: Response) { store.set(keyOf(k), r); },
      async match(k: any) { const r = store.get(keyOf(k)); return r ? r.clone() : undefined; }
    };
  },
  async keys() { return ['sthr-v1', 'sthr-v2']; },
  async delete() { return true; }
};
const deleted: string[] = [];

function boot() {
  store = new Map(); online = true; redirected = new Set(); handlers = {}; deleted.length = 0;
  const fakeFetch = async (input: any) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!online) throw new TypeError('Failed to fetch');
    const rel = url.replace(SCOPE, '').split('?')[0];
    if (!(rel in SITE)) return new Response('missing', { status: 404 });
    const res = new Response(SITE[rel]);
    if (redirected.has(rel)) Object.defineProperty(res, 'redirected', { value: true });
    return res;
  };
  const self = { registration: { scope: SCOPE }, addEventListener: (t: string, f: any) => { handlers[t] = f; }, skipWaiting() {}, clients: { claim: async () => {} } };
  runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    self, caches: { ...cacheApi, delete: async (k: string) => { deleted.push(k); return true; } }, fetch: fakeFetch, URL, Response, Promise, setTimeout, clearTimeout, location: { origin: 'https://h.example' }
  });
}
const install = async () => { let p: Promise<unknown> = Promise.resolve(); handlers.install({ waitUntil: (x: Promise<unknown>) => { p = x; } }); await p; };
const ask = async (url: string, mode: string = 'navigate') => {
  let out: Promise<Response> | undefined;
  handlers.fetch({ request: { url, method: 'GET', mode }, respondWith: (p: Promise<Response>) => { out = p; } });
  return out ? out : undefined;
};

beforeEach(boot);

describe('the worker saves the whole app when it installs', () => {
  it('the page, its script and style, the face library they load later, the manifest and every face model', async () => {
    await install();
    const saved = [...store.keys()].map(k => k.replace(SCOPE, ''));
    for (const want of Object.keys(SITE)) expect(saved, want).toContain(want);
  });
  it('an old copy is cleared when a new version takes over', async () => {
    let p: Promise<unknown> = Promise.resolve();
    handlers.activate({ waitUntil: (x: Promise<unknown>) => { p = x; } });
    await p;
    expect(deleted).toEqual(['sthr-v1']);
  });
  it('a failed fetch while installing does not stop it installing', async () => {
    online = false;
    await expect(install()).resolves.toBeUndefined();
  });
});

describe('opening the app with no signal', () => {
  it('a page is answered from the saved copy, with or without a query', async () => {
    await install(); online = false;
    for (const url of [SCOPE, SCOPE + '?demo', SCOPE + 'index.html']) {
      const res = await ask(url);
      expect(res, url).toBeDefined();
      expect(await res!.text(), url).toContain('assets/index-AAA.js');
    }
  });
  it('scripts, styles and models come from the saved copy', async () => {
    await install(); online = false;
    for (const f of ['assets/index-AAA.js', 'assets/face-api.esm-CCC.js', 'models/face_recognition_model.bin']) expect(await (await ask(SCOPE + f, 'cors'))!.text(), f).not.toBe('');
  });
  it('other sites are never touched', async () => {
    await install();
    expect(await ask('https://fonts.googleapis.com/css2?x=1', 'cors')).toBeUndefined();
  });
  it('a page is still served when it was saved from a redirect (Safari refuses redirected answers)', async () => {
    await install(); online = false;
    store.set(SCOPE, Object.assign(new Response('<p>home</p>'), {}));
    Object.defineProperty(store.get(SCOPE)!, 'redirected', { value: true });
    const res = (await ask(SCOPE))!;
    expect(res.redirected).toBe(false);
    expect(await res.text()).toContain('home');
  });
});

describe('with signal', () => {
  it('a page comes from the network and refreshes the saved copy', async () => {
    await install();
    SITE[''] = SITE[''] + '<!-- v2 -->';
    try {
      const res = await ask(SCOPE);
      expect(await res!.text()).toContain('v2');
      online = false;
      expect(await (await ask(SCOPE))!.text()).toContain('v2');
    } finally { SITE[''] = SITE[''].replace('<!-- v2 -->', ''); }
  });
  it('a file that is not saved yet is fetched and then saved', async () => {
    await install();
    SITE['assets/late-EEE.js'] = 'x';
    try {
      expect(await (await ask(SCOPE + 'assets/late-EEE.js', 'cors'))!.text()).toBe('x');
      online = false;
      expect(await (await ask(SCOPE + 'assets/late-EEE.js', 'cors'))!.text()).toBe('x');
    } finally { delete SITE['assets/late-EEE.js']; }
  });
});
