import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AuditEntry } from '../domain/types';
import type { Company } from '../domain/company';
import type { Backend, Row } from './remote';
import { sheetsApi } from './sheets';

/**
 * Everything that talks to the online database: connection settings, the Supabase transport for RemoteStore,
 * and sign-in by employee code + PIN. A person's account is `<code>@<company>.sthr.app` with the PIN as the password
 * (an address that never receives mail; confirmation by e-mail is switched off in the project).
 */

/** `sheets`: a Google Sheet behind an Apps Script web app (url only). `supabase`: a Supabase project (url + anon key). */
export interface ServerConfig { kind?: 'supabase' | 'sheets'; url: string; key: string }
const CFG = 'sthr-server';
const ONLINE = 'sthr-online';

export function readServerConfig(): ServerConfig | null {
  const env = (import.meta as any).env ?? {};
  if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) return { url: env.VITE_SUPABASE_URL, key: env.VITE_SUPABASE_ANON_KEY };
  try { const c = JSON.parse(localStorage.getItem(CFG) || 'null'); return c?.url && (c.kind === 'sheets' || c?.key) ? c : null; } catch { return null; }
}
export function saveServerConfig(c: ServerConfig) { localStorage.setItem(CFG, JSON.stringify({ kind: c.kind ?? 'supabase', url: c.url.trim().replace(/\/+$/, ''), key: (c.key ?? '').trim() })); client = null; }
export const serverKind = (): 'supabase' | 'sheets' => readServerConfig()?.kind === 'sheets' ? 'sheets' : 'supabase';
const sheets = () => sheetsApi(readServerConfig()!.url);

/** Which online company this device is signed in to (or about to). */
export const readOnlineCompany = (): string | null => { try { return localStorage.getItem(ONLINE); } catch { return null; } };
export function setOnlineCompany(id: string | null) { try { id ? localStorage.setItem(ONLINE, id) : localStorage.removeItem(ONLINE); } catch { /* private mode */ } }

/** A link that sets a phone up for this company: the project address, the public key and the company id. None of it is secret. */
export const joinLink = (cfg: ServerConfig, companyId: string) => `${location.origin}${location.pathname}#join=${btoa(unescape(encodeURIComponent(JSON.stringify({ p: cfg.kind ?? 'supabase', u: cfg.url, k: cfg.key, c: companyId }))))}`;
/** Read a join link from the address bar, remember it, and clear it. Returns the company id when there was one. */
export function takeJoinLink(): string | null {
  const m = location.hash.match(/join=([^&]+)/);
  if (!m) return null;
  try {
    const j = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    if (!j.u || !j.c || (j.p !== 'sheets' && !j.k)) return null;
    saveServerConfig({ kind: j.p === 'sheets' ? 'sheets' : 'supabase', url: j.u, key: j.k ?? '' });
    setOnlineCompany(j.c);
    history.replaceState(null, '', location.pathname + location.search);
    return j.c;
  } catch { return null; }
}

let client: SupabaseClient | null = null;
export function db(): SupabaseClient {
  if (client) return client;
  const c = readServerConfig();
  if (!c) throw new Error('ຍັງບໍ່ໄດ້ເຊື່ອມຕໍ່ເຊີບເວີ');
  client = createClient(c.url, c.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sthr-auth' } });
  return client;
}

export const emailFor = (companyId: string, code: string) => `${code.trim().toLowerCase()}@${companyId}.sthr.app`;
/** The sign-in system wants 6+ characters; the PIN (6 digits online) is padded with a fixed prefix, which adds no secrecy and none is claimed. */
export const passwordFor = (pin: string) => `sthr-${pin}`;
const must = <T>(r: { data: T | null; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data as T; };

// ---------------------------------------------------------------- the database, as RemoteStore sees it
const PAGE = 1000;
const supabaseBackend: Backend = {
  async list(company, collection) {
    const out: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      const rows = must(await db().from('records').select('id,data').eq('company_id', company).eq('collection', collection).order('id').range(from, from + PAGE - 1)) as Row[];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  },
  async get(company, collection, id) {
    return (must(await db().from('records').select('id,data').eq('company_id', company).eq('collection', collection).eq('id', id).limit(1)) as Row[])[0];
  },
  async upsert(company, collection, id, data, by) {
    must(await db().from('records').upsert({ company_id: company, collection, id, data, updated_by: by }, { onConflict: 'company_id,collection,id' }));
  },
  async del(company, collection, id) {
    must(await db().from('records').delete().eq('company_id', company).eq('collection', collection).eq('id', id));
  },
  async addAudit(company, e) {
    must(await db().from('audit').insert({ company_id: company, by: e.by, action: e.action, entity: e.entity, entity_id: e.entityId, before: e.before ?? null, after: e.after ?? null }));
  },
  async listAudit(company) {
    const out: AuditEntry[] = [];
    for (let from = 0; ; from += PAGE) {
      const rows = must(await db().from('audit').select('*').eq('company_id', company).order('seq').range(from, from + PAGE - 1)) as any[];
      out.push(...rows.map(r => ({ id: String(r.seq), companyId: r.company_id, at: r.at, by: r.by, action: r.action, entity: r.entity, entityId: r.entity_id, before: r.before ?? undefined, after: r.after ?? undefined })));
      if (rows.length < PAGE) return out;
    }
  }
};

/** The database RemoteStore reads and writes, whichever kind this device is connected to. */
export const activeBackend = (): Backend => (serverKind() === 'sheets' ? sheets().backend : supabaseBackend);

// ---------------------------------------------------------------- signing in
export interface Member { userId: string; companyId: string; employeeId: string; roles: string[] }

export async function currentMember(): Promise<Member | null> {
  if (serverKind() === 'sheets') return sheets().currentMember();
  const { data } = await db().auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return null;
  const rows = must(await db().from('members').select('company_id,employee_id,roles').eq('user_id', uid).limit(1)) as any[];
  return rows[0] ? { userId: uid, companyId: rows[0].company_id, employeeId: rows[0].employee_id, roles: rows[0].roles } : null;
}

export async function signIn(companyId: string, code: string, pin: string): Promise<Member> {
  if (serverKind() === 'sheets') {
    const sh = sheets(), m = await sh.signIn(code, pin);
    if (m.companyId !== companyId) { await sh.signOut(); throw new Error('ບັນຊີນີ້ບໍ່ໄດ້ຢູ່ໃນບໍລິສັດນີ້'); }
    return m;
  }
  const r = await db().auth.signInWithPassword({ email: emailFor(companyId, code), password: passwordFor(pin) });
  if (r.error) throw new Error(/invalid|credentials/i.test(r.error.message) ? 'ລະຫັດພະນັກງານ ຫຼື PIN ບໍ່ຖືກ' : r.error.message);
  const m = await currentMember();
  if (!m || m.companyId !== companyId) { await db().auth.signOut(); throw new Error('ບັນຊີນີ້ບໍ່ໄດ້ຢູ່ໃນບໍລິສັດນີ້'); }
  return m;
}
export const signOut = async () => { if (serverKind() === 'sheets') return sheets().signOut(); await db().auth.signOut(); };

/** A Google Sheet holds exactly one company, so its id comes from the sheet rather than from the person typing it. */
export async function sheetCompany(): Promise<{ companyId: string | null; name: string | null }> { return sheets().info(); }

export async function companyName(id: string): Promise<string | null> {
  if (serverKind() === 'sheets') { const i = await sheets().info(); return i.companyId === id ? i.name : null; }
  const r = await db().rpc('public_company', { p_id: id });
  return r.error ? null : (r.data as string | null);
}

export async function loadCompany(id: string): Promise<Company> {
  if (serverKind() === 'sheets') return sheets().loadCompany();
  const rows = must(await db().from('companies').select('id,name,plan,data,created_at').eq('id', id).limit(1)) as any[];
  if (!rows[0]) throw new Error('ບໍ່ພົບບໍລິສັດ');
  return { ...(rows[0].data ?? {}), id: rows[0].id, name: rows[0].name, plan: rows[0].plan, createdAt: rows[0].data?.createdAt ?? String(rows[0].created_at).slice(0, 10) } as Company;
}

// ---------------------------------------------------------------- creating a company and its logins
export async function createCompanyOnline(p: { signupCode: string; company: Company; ownerEmployeeId: string; ownerCode: string; pin: string }): Promise<void> {
  if (serverKind() === 'sheets') { await sheets().createCompany(p); return; }
  const email = emailFor(p.company.id, p.ownerCode);
  const up = await db().auth.signUp({ email, password: passwordFor(p.pin) });
  if (up.error) throw new Error(up.error.message);
  if (!up.data.session) throw new Error('ເຊີບເວີຍັງເປີດ "Confirm email" ຢູ່ — ປິດໃນ Authentication → Providers → Email ກ່ອນ');
  const r = await db().rpc('create_company', { p_code: p.signupCode, p_company: { ...p.company, ownerEmployeeId: p.ownerEmployeeId }, p_records: [] });
  if (r.error) { await db().auth.signOut(); throw new Error(r.error.message); }
}

/** Give a person a login. The account is made on a throw-away client so the owner stays signed in as the owner. */
export async function createLogin(companyId: string, employeeId: string, code: string, pin: string): Promise<void> {
  if (serverKind() === 'sheets') { await sheets().createLogin(employeeId, code, pin); return; }
  const cfg = readServerConfig()!;
  const temp = createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const up = await temp.auth.signUp({ email: emailFor(companyId, code), password: passwordFor(pin) });
  if (up.error) {
    if (/already/i.test(up.error.message)) return resetPin(employeeId, pin); // the account exists (made earlier): just set the new PIN
    throw new Error(up.error.message);
  }
  const uid = up.data.user?.id;
  if (!uid) throw new Error('ສ້າງບັນຊີບໍ່ສຳເລັດ');
  const r = await db().rpc('link_member', { p_user: uid, p_employee: employeeId });
  if (r.error) throw new Error(r.error.message);
}
export async function resetPin(employeeId: string, pin: string): Promise<void> {
  if (serverKind() === 'sheets') { await sheets().setPin(employeeId, pin); return; }
  const r = await db().rpc('admin_set_pin', { p_employee: employeeId, p_password: passwordFor(pin) });
  if (r.error) throw new Error(r.error.message);
}
export async function changeOwnPin(pin: string): Promise<void> {
  if (serverKind() === 'sheets') { await sheets().changeOwnPin(pin); return; }
  const r = await db().auth.updateUser({ password: passwordFor(pin) });
  if (r.error) throw new Error(r.error.message);
}
export async function removeLogin(employeeId: string): Promise<void> {
  if (serverKind() === 'sheets') { await sheets().removeLogin(employeeId); return; }
  const r = await db().rpc('admin_remove_login', { p_employee: employeeId });
  if (r.error) throw new Error(r.error.message);
}
/** Employee ids that already have a login. Only the owner can read the whole list. */
export async function listLogins(companyId: string): Promise<Set<string>> {
  if (serverKind() === 'sheets') return sheets().listLogins();
  const rows = must(await db().from('members').select('employee_id').eq('company_id', companyId)) as { employee_id: string }[];
  return new Set(rows.map(r => r.employee_id));
}
