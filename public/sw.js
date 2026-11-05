// Offline shell. The whole app (page, scripts, styles, face models) is saved the moment this worker installs,
// so it opens with no signal even if the person never reloaded after the first visit (Safari included).
//  - pages: network first (a deploy is picked up as soon as there is signal), but only wait a few seconds, then the saved copy
//  - /assets/ and /models/ never change under the same name: saved copy first
//  - everything else on this site: network first, saved copy when the network fails
// Other sites (map tiles, fonts) are left alone.
const CACHE = 'sthr-v2';
const SCOPE = self.registration.scope; // e.g. https://host/st-hr/
const MODELS = [
  'tiny_face_detector_model-weights_manifest.json', 'tiny_face_detector_model.bin',
  'face_landmark_68_tiny_model-weights_manifest.json', 'face_landmark_68_tiny_model.bin',
  'face_recognition_model-weights_manifest.json', 'face_recognition_model.bin'
];

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);
/** Safari refuses a page answered with a redirected response: hand back a plain copy. */
const plain = res => (res && res.redirected ? new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers }) : res);
const noQuery = url => { const u = new URL(url); u.search = ''; return u.href; };

async function precache() {
  const cache = await caches.open(CACHE);
  const save = async url => {
    try {
      const res = await fetch(url, { cache: 'reload' });
      if (res.ok && !res.redirected) { await cache.put(url, res.clone()); return res; }
    } catch { /* the next visit tries again */ }
    return null;
  };
  const home = await save(SCOPE);
  const html = home ? await home.clone().text() : '';
  const queue = [SCOPE + 'manifest.webmanifest', ...MODELS.map(m => SCOPE + 'models/' + m)];
  for (const m of html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)) queue.push(new URL(m[1], SCOPE).href);
  const seen = new Set([SCOPE]);
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const res = await save(url);
    if (res && /\.js$/.test(url)) {
      // chunks the script loads later (the face library): named inside the script
      const code = await res.clone().text();
      for (const m of code.matchAll(/assets\/[A-Za-z0-9_.-]+\.(?:js|css)/g)) queue.push(new URL('./' + m[0], SCOPE).href);
      for (const m of code.matchAll(/["']\.\/([A-Za-z0-9_.-]+\.js)["']/g)) queue.push(new URL(m[1], url).href);
    }
  }
}

self.addEventListener('install', e => { e.waitUntil(precache().then(() => self.skipWaiting(), () => self.skipWaiting())); });

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function page(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await withTimeout(fetch(req), 4000);
    if (res.ok && !res.redirected) cache.put(noQuery(req.url), res.clone());
    return res;
  } catch {
    return plain((await cache.match(noQuery(req.url))) || (await cache.match(SCOPE)) || (await cache.match(SCOPE + 'index.html'))) || Response.error();
  }
}

async function asset(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit && /\/(assets|models)\//.test(req.url)) return hit;
  try {
    const res = await withTimeout(fetch(req), 6000);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return hit || Response.error();
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(req.mode === 'navigate' ? page(req) : asset(req));
});
