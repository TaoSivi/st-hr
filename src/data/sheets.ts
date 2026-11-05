import type { AuditEntry } from '../domain/types';
import type { Company } from '../domain/company';
import { isOffline, type Backend, type Row } from './remote';

/**
 * The Google Sheets side of the online mode. A Google Sheet holds one company; an Apps Script web app (apps-script/Code.gs) in front of it
 * signs people in and checks every read and write. This file is the app's end of that: one POST per call (or per batch of reads),
 * body as text/plain so the browser sends no pre-flight request, and a session token kept on the phone after sign-in.
 */

/** One sign-in card: the code to sign in with, the name and the top role. No pay, no face, nothing private. */
export interface SheetCard { code: string; name: string; role: string }
/** What the sign-in screen needs: the company and the people to offer as cards. Nothing private. */
export type SheetInfo = { companyId: string | null; name: string | null; users: SheetCard[] };
const INFO = 'sthr-sheets-info';
/** The last answer, kept on this device so the sign-in screen can appear at once and be refreshed behind it. */
export function peekSheetInfo(): SheetInfo | null {
  try { const i = JSON.parse(localStorage.getItem(INFO) || 'null'); return i && Array.isArray(i.users) ? (i as SheetInfo) : null; } catch { return null; }
}
const keepInfo = (i: SheetInfo) => { try { localStorage.setItem(INFO, JSON.stringify(i)); } catch { /* private mode: no head start next time */ } };
export interface SheetMember { userId: string; companyId: string; employeeId: string; roles: string[] }

/** Who this phone is signed in as (and their company), as the server last said: lets the app open with no signal. Wiped on sign-out. */
const ME = 'sthr-sheets-me';
type KeptMe = { member: SheetMember; company?: Company };
function peekMe(): KeptMe | null {
  try { const v = JSON.parse(localStorage.getItem(ME) || 'null'); return v?.member?.employeeId ? (v as KeptMe) : null; } catch { return null; }
}
function keepMe(member: SheetMember | null, company?: Company) {
  try { member ? localStorage.setItem(ME, JSON.stringify({ member, company })) : localStorage.removeItem(ME); } catch { /* private mode: needs the signal to open */ }
}

/**
 * Signing in with no signal: a person who has signed in on this phone before can type their PIN and get in, as they were.
 * The phone keeps only a salted, slow hash of the PIN (never the PIN) and who they are; it is checked here, and the real sign-in
 * is repeated by the app (with the PIN it still holds in memory) as soon as the signal is back. Refreshed at every online sign-in.
 */
const LOGINS = 'sthr-sheets-logins';
interface KeptLogin { code: string; employeeId: string; salt: string; hash: string; member: SheetMember; company?: Company }
const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
const peekLogins = (): KeptLogin[] => { try { const v = JSON.parse(localStorage.getItem(LOGINS) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const saveLogins = (l: KeptLogin[]) => { try { localStorage.setItem(LOGINS, JSON.stringify(l)); } catch { /* private mode: needs the signal each time */ } };
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
async function hashPin(pin: string, salt: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const key = await subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return hex(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 60_000 }, key, 256));
}
async function rememberLogin(code: string, pin: string, member: SheetMember, company?: Company) {
  const salt = hex(globalThis.crypto.getRandomValues(new Uint8Array(12)).buffer);
  const hash = await hashPin(pin, salt);
  if (!hash) return;
  saveLogins([...peekLogins().filter(l => !same(l.code, code)), { code: code.trim(), employeeId: member.employeeId, salt, hash, member, ...(company ? { company } : {}) }]);
}
const matches = async (l: KeptLogin, pin: string) => (await hashPin(pin, l.salt)) === l.hash;

const TOKEN = 'sthr-sheets-token';
const store = {
  get: () => { try { return localStorage.getItem(TOKEN); } catch { return null; } },
  set: (t: string | null) => { try { t ? localStorage.setItem(TOKEN, t) : localStorage.removeItem(TOKEN); } catch { /* private mode: signs in again next time */ } }
};

/** What to say while each kind of call is on its way. Calls not listed here (reads, the sign-in list, the refresh in the background) never bring up the waiting card. */
const WAIT_LABEL: Record<string, string> = {
  login: 'ກຳລັງເຂົ້າລະບົບ', logout: 'ກຳລັງອອກຈາກລະບົບ', create: 'ກຳລັງສ້າງບໍລິສັດ', approve: 'ກຳລັງກວດ PIN ຜູ້ອະນຸມັດ',
  upsert: 'ກຳລັງບັນທຶກ', del: 'ກຳລັງລຶບ', addAudit: 'ກຳລັງບັນທຶກ', createLogin: 'ກຳລັງຕັ້ງ PIN', setPin: 'ກຳລັງຕັ້ງ PIN',
  changeOwnPin: 'ກຳລັງປ່ຽນ PIN', removeLogin: 'ກຳລັງປິດບັນຊີ', revealPin: 'ກຳລັງເປີດ PIN'
};
type Waiting = { id: number; label: string };
let waitingNow: Waiting[] = [];
let waitingSeq = 0;
const waitingListeners = new Set<(w: readonly Waiting[]) => void>();
function startWaiting(label: string): () => void {
  const w = { id: ++waitingSeq, label };
  waitingNow = [...waitingNow, w];
  waitingListeners.forEach(f => f(waitingNow));
  return () => { waitingNow = waitingNow.filter(x => x !== w); waitingListeners.forEach(f => f(waitingNow)); };
}
/** The screen listens here to know when someone is waiting on the sheet and for what (the newest call's wording is last). */
export function onSheetsWaiting(f: (w: readonly Waiting[]) => void): () => void { waitingListeners.add(f); f(waitingNow); return () => { waitingListeners.delete(f); }; }

/** Apps Script's own answer when the address is wrong or the web app is not shared with "Anyone". */
const looksLikeLoginPage = (s: string) => /<html|<!doctype/i.test(s.slice(0, 200));

type Fetch = typeof fetch;
class SheetError extends Error { constructor(message: string, public code = '') { super(message); } }

export function sheetsApi(url: string, fetchImpl?: Fetch, tokens = store) {
  const doFetch: Fetch = (...a) => (fetchImpl ?? fetch)(...a);

  let approval: string | null = null; // set only while an action approved with someone else's PIN is running

  /** Calls a person is waiting on (a tap, then the answer) are announced, so the screen can say "one moment" nicely; quiet reads and the background refresh are not. */
  async function post<T>(body: Record<string, unknown>): Promise<T> {
    const waited = typeof body.action === 'string' && WAIT_LABEL[body.action];
    const done = waited ? startWaiting(waited) : null;
    try { return await send<T>(body); } finally { done?.(); }
  }
  async function send<T>(body: Record<string, unknown>): Promise<T> {
    const res = await doFetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, token: tokens.get() ?? undefined, approval: approval ?? undefined }), redirect: 'follow' });
    const text = await res.text();
    if (looksLikeLoginPage(text)) throw new SheetError('ເຊື່ອມຕໍ່ Google Sheet ບໍ່ໄດ້ — ກວດລິ້ງ Web app ແລະ ການແບ່ງປັນ "ທຸກຄົນ (Anyone)"');
    let r: { ok: boolean; data?: T; error?: string; code?: string };
    try { r = JSON.parse(text); } catch { throw new SheetError('ເຊີບເວີຕອບກັບບໍ່ຖືກຮູບແບບ'); }
    if (!r.ok) return fail(r);
    return r.data as T;
  }
  function fail(r: { error?: string; code?: string }): never {
    if (r.code === 'auth') tokens.set(null);
    throw new SheetError(r.error || 'ມີຂໍ້ຜິດພາດ', r.code);
  }

  // reads made in the same moment travel together: one trip to the sheet instead of a dozen
  let pending: { op: Record<string, unknown>; ok: (v: any) => void; no: (e: unknown) => void }[] = [];
  function read<T>(op: Record<string, unknown>): Promise<T> {
    return new Promise<T>((ok, no) => {
      pending.push({ op, ok, no });
      if (pending.length === 1) setTimeout(flushReads, 15);
    });
  }
  async function flushReads() {
    const batch = pending; pending = [];
    try {
      const results = await post<{ ok: boolean; data?: unknown; error?: string; code?: string }[]>({ action: 'multi', ops: batch.map(b => b.op) });
      batch.forEach((b, i) => {
        const r = results[i];
        if (r?.ok) b.ok(r.data);
        else { try { fail(r ?? {}); } catch (e) { b.no(e); } }
      });
    } catch (e) { batch.forEach(b => b.no(e)); }
  }

  const backend: Backend = {
    list: (_c, collection) => read<Row[]>({ action: 'list', collection }),
    get: async (_c, collection, id) => (await read<Row | null>({ action: 'get', collection, id })) ?? undefined,
    upsert: async (_c, collection, id, data) => { await post({ action: 'upsert', collection, id, data }); },
    del: async (_c, collection, id) => { await post({ action: 'del', collection, id }); },
    addAudit: async (_c, entry) => { await post({ action: 'addAudit', entry }); },
    listAudit: async () => await post<AuditEntry[]>({ action: 'listAudit' })
  };

  // sign-in and `me` bring the company along, so opening the app takes one trip fewer
  let firstCompany: Company | undefined;
  let offlineFails = 0, lockedUntil = 0; // too many wrong PINs with no signal: wait a minute
  type Info = SheetInfo;
  let infoTrip: { at: number; p: Promise<Info> } | null = null;
  // the connect step and the sign-in screen both ask: one trip to the sheet serves both for a short while
  const info = (): Promise<Info> => {
    if (infoTrip && Date.now() - infoTrip.at < 30_000) return infoTrip.p;
    const p = post<Info>({ action: 'info' }).then(i => { keepInfo(i); return i; });
    const mine = { at: Date.now(), p };
    infoTrip = mine;
    p.catch(() => { if (infoTrip === mine) infoTrip = null; });
    return p;
  };
  const asMember = (r: { token: string; member: SheetMember; company?: Company }) => { tokens.set(r.token); firstCompany = r.company; infoTrip = null; keepMe(r.member, r.company); return r.member; };

  return {
    backend,
    info,
    hasToken: () => !!tokens.get(),
    async currentMember(): Promise<SheetMember | null> {
      if (!tokens.get()) return null;
      try {
        const { company, ...m } = await post<SheetMember & { company?: Company }>({ action: 'me' });
        firstCompany = company;
        keepMe(m, company);
        return m;
      } catch (e: any) {
        if (e?.code === 'auth') { keepMe(null); return null; }
        // no signal: the person is still who the last answer said, so the app opens and a clock-in can be made
        const kept = isOffline(e) ? peekMe() : null;
        if (kept) { firstCompany = kept.company; return kept.member; }
        throw e;
      }
    },
    async signIn(code: string, pin: string) {
      let r: { token: string; member: SheetMember; company?: Company };
      try { r = await post({ action: 'login', code, pin }); } catch (e) {
        // the server refused this PIN: a copy kept on the phone that still accepts it is out of date (PIN reset, account closed)
        if (!isOffline(e)) { const kept = peekLogins().find(l => same(l.code, code)); if (kept && await matches(kept, pin).catch(() => false)) saveLogins(peekLogins().filter(l => l !== kept && !same(l.code, code))); }
        throw e;
      }
      const m = asMember(r);
      await rememberLogin(code, pin, m, r.company).catch(() => { /* works without; just needs the signal next time */ });
      return m;
    },
    /** No signal: let in someone who has signed in on this phone before, if the PIN is right. Gives no server session (the app signs in for real when the signal returns). */
    async signInOffline(code: string, pin: string): Promise<SheetMember> {
      if (Date.now() < lockedUntil) throw new SheetError('ໃສ່ PIN ຜິດຫຼາຍເທື່ອ — ລໍ 1 ນາທີ ແລ້ວລອງໃໝ່');
      const kept = peekLogins().find(l => same(l.code, code));
      if (!kept) throw new SheetError('ເຂົ້າລະບົບຕອນບໍ່ມີເນັດໄດ້ສະເພາະຄົນທີ່ເຄີຍເຂົ້າໃນເຄື່ອງນີ້ມາກ່ອນ — ຕ້ອງມີເນັດຄັ້ງທຳອິດ');
      if (!(await matches(kept, pin).catch(() => false))) {
        if (++offlineFails >= 5) { lockedUntil = Date.now() + 60_000; offlineFails = 0; }
        throw new SheetError('PIN ບໍ່ຖືກ');
      }
      offlineFails = 0;
      firstCompany = kept.company;
      return kept.member;
    },
    async signOut() { try { await post({ action: 'logout' }); } finally { tokens.set(null); keepMe(null); } },
    async loadCompany(): Promise<Company> {
      const c = firstCompany;
      firstCompany = undefined;
      if (c) return c;
      try { return await post<Company>({ action: 'company' }); } catch (e) {
        const kept = isOffline(e) ? peekMe()?.company : undefined;
        if (kept) return kept;
        throw e;
      }
    },
    async createCompany(p: { signupCode: string; company: Company; ownerEmployeeId: string; ownerCode: string; pin: string; superAdmin?: { employeeId: string; code: string; pin: string } }) {
      return asMember(await post({ action: 'create', signupCode: p.signupCode, company: p.company, owner: { employeeId: p.ownerEmployeeId, code: p.ownerCode }, pin: p.pin, superAdmin: p.superAdmin }));
    },
    /** A colleague with the right types their PIN: the answer is a short-lived approval to run one action with (see withApproval). */
    approve: (code: string, pin: string) => post<{ approval: string; approverId: string; approverName: string; seconds: number }>({ action: 'approve', code, pin }),
    async withApproval<T>(token: string, run: () => Promise<T>): Promise<T> { approval = token; try { return await run(); } finally { approval = null; } },
    createLogin: (employeeId: string, code: string, pin: string) => post<true>({ action: 'createLogin', employeeId, code, pin }),
    setPin: (employeeId: string, pin: string) => post<true>({ action: 'setPin', employeeId, pin }),
    changeOwnPin: async (pin: string) => {
      await post<true>({ action: 'changeOwnPin', pin });
      const me = peekMe()?.member.employeeId, kept = peekLogins().find(l => l.employeeId === me);
      if (kept) await rememberLogin(kept.code, pin, kept.member, kept.company).catch(() => saveLogins(peekLogins().filter(l => l !== kept))); // the old PIN must not keep working offline
      return true as const;
    },
    removeLogin: (employeeId: string) => post<true>({ action: 'removeLogin', employeeId }),
    /** An Admin or Super admin looks up a person's PIN (null when it is not known yet: it becomes known the next time that person signs in, or when a PIN is set). */
    revealPin: async (employeeId: string) => (await post<{ pin: string | null }>({ action: 'revealPin', employeeId })).pin,
    listLogins: async () => new Set(await post<string[]>({ action: 'listLogins' }))
  };
}

export type SheetsApi = ReturnType<typeof sheetsApi>;
