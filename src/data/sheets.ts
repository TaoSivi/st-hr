import type { AuditEntry } from '../domain/types';
import type { Company } from '../domain/company';
import type { Backend, Row } from './remote';

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

const TOKEN = 'sthr-sheets-token';
const store = {
  get: () => { try { return localStorage.getItem(TOKEN); } catch { return null; } },
  set: (t: string | null) => { try { t ? localStorage.setItem(TOKEN, t) : localStorage.removeItem(TOKEN); } catch { /* private mode: signs in again next time */ } }
};

/** Apps Script's own answer when the address is wrong or the web app is not shared with "Anyone". */
const looksLikeLoginPage = (s: string) => /<html|<!doctype/i.test(s.slice(0, 200));

type Fetch = typeof fetch;
class SheetError extends Error { constructor(message: string, public code = '') { super(message); } }

export function sheetsApi(url: string, fetchImpl?: Fetch, tokens = store) {
  const doFetch: Fetch = (...a) => (fetchImpl ?? fetch)(...a);

  let approval: string | null = null; // set only while an action approved with someone else's PIN is running

  async function post<T>(body: Record<string, unknown>): Promise<T> {
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
  const asMember = (r: { token: string; member: SheetMember; company?: Company }) => { tokens.set(r.token); firstCompany = r.company; infoTrip = null; return r.member; };

  return {
    backend,
    info,
    hasToken: () => !!tokens.get(),
    async currentMember(): Promise<SheetMember | null> {
      if (!tokens.get()) return null;
      try {
        const { company, ...m } = await post<SheetMember & { company?: Company }>({ action: 'me' });
        firstCompany = company;
        return m;
      } catch (e: any) { if (e?.code === 'auth') return null; throw e; }
    },
    async signIn(code: string, pin: string) { return asMember(await post({ action: 'login', code, pin })); },
    async signOut() { try { await post({ action: 'logout' }); } finally { tokens.set(null); } },
    async loadCompany(): Promise<Company> {
      const c = firstCompany;
      firstCompany = undefined;
      return c ?? await post<Company>({ action: 'company' });
    },
    async createCompany(p: { signupCode: string; company: Company; ownerEmployeeId: string; ownerCode: string; pin: string; superAdmin?: { employeeId: string; code: string; pin: string } }) {
      return asMember(await post({ action: 'create', signupCode: p.signupCode, company: p.company, owner: { employeeId: p.ownerEmployeeId, code: p.ownerCode }, pin: p.pin, superAdmin: p.superAdmin }));
    },
    /** A colleague with the right types their PIN: the answer is a short-lived approval to run one action with (see withApproval). */
    approve: (code: string, pin: string) => post<{ approval: string; approverId: string; approverName: string; seconds: number }>({ action: 'approve', code, pin }),
    async withApproval<T>(token: string, run: () => Promise<T>): Promise<T> { approval = token; try { return await run(); } finally { approval = null; } },
    createLogin: (employeeId: string, code: string, pin: string) => post<true>({ action: 'createLogin', employeeId, code, pin }),
    setPin: (employeeId: string, pin: string) => post<true>({ action: 'setPin', employeeId, pin }),
    changeOwnPin: (pin: string) => post<true>({ action: 'changeOwnPin', pin }),
    removeLogin: (employeeId: string) => post<true>({ action: 'removeLogin', employeeId }),
    listLogins: async () => new Set(await post<string[]>({ action: 'listLogins' }))
  };
}

export type SheetsApi = ReturnType<typeof sheetsApi>;
