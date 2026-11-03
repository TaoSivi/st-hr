import type { AuditEntry, Employee } from '../domain/types';
import type { DataStore } from './store';

/**
 * The online store: the same DataStore the app already uses, over a shared database.
 * Some data is kept in separate collections so the database itself can hide it from people who should not see it:
 *   employees       → who someone is (everyone in the company reads it)
 *   employeePay     → salary, allowance, how they are paid (owner / accountant / auditor, and the person)
 *   employeeSecret  → face templates (only the person)
 *   payrollRuns     → the period's status (everyone)   payslips → each person's net pay (owner / accountant / auditor, and the person)
 * The app keeps seeing the one Employee / PayrollRun shape it always did: this class splits on write and joins on read.
 */

export interface Row { id: string; data: any }

/** The thin transport (Supabase in production, a fake in tests). */
export interface Backend {
  list(company: string, collection: string): Promise<Row[]>;
  get(company: string, collection: string, id: string): Promise<Row | undefined>;
  upsert(company: string, collection: string, id: string, data: unknown, by: string): Promise<void>;
  del(company: string, collection: string, id: string): Promise<void>;
  addAudit(company: string, entry: Omit<AuditEntry, 'id' | 'companyId' | 'at'>): Promise<void>;
  listAudit(company: string): Promise<AuditEntry[]>;
}

const PAY_KEYS = ['baseSalary', 'allowance', 'payMethod', 'bankName', 'bankAccount'] as const;
const SECRET_KEYS = ['faceEnrolled', 'facePoses'] as const;
const LOCAL_ONLY = ['pinHash', 'pinSalt'] as const; // PINs live in the sign-in system, never in a record

const pick = (o: any, keys: readonly string[]) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
const omit = (o: any, keys: readonly string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const faceCountOf = (e: Pick<Employee, 'faceEnrolled' | 'facePoses'> & { faceCount?: number }) =>
  e.faceEnrolled ? 1 + (e.facePoses?.length ?? 0) : e.faceCount ?? 0;

/** What the audit log keeps of a record: never a photo or a face / PIN value. */
const redact = (v: any) => {
  if (!v || typeof v !== 'object') return v;
  const o: any = { ...v };
  if (o.photo) o.photo = '[ຮູບ]';
  for (const k of [...SECRET_KEYS, ...LOCAL_ONLY]) if (o[k] !== undefined) o[k] = '[ລັບ]';
  return o;
};

/** Writes that could not reach the database (no signal): kept on the phone and sent when it is back. */
export interface Outbox { read(): QueuedWrite[]; write(q: QueuedWrite[]): void }
export interface QueuedWrite { collection: string; item: { id: string }; by: string; action: string }
export const OUTBOX_COLLECTIONS = ['scans']; // clock-ins must work with no signal; everything else needs the connection

export class RemoteStore implements DataStore {
  private seen = new Map<string, any>(); // `${collection}/${id}` → what the database last said, to write only what changed

  constructor(private be: Backend, private companyId: string, private outbox?: Outbox) {}

  private key = (c: string, id: string) => `${c}/${id}`;
  private remember(c: string, rows: Row[]) { for (const r of rows) this.seen.set(this.key(c, r.id), r.data); }

  private async rows(c: string): Promise<Row[]> {
    const rows = await this.be.list(this.companyId, c);
    this.remember(c, rows);
    return rows;
  }

  async list<T>(collection: string): Promise<T[]> {
    if (collection === 'employees') return this.employees() as Promise<T[]>;
    if (collection === 'payrollRuns') return this.runs() as Promise<T[]>;
    const rows = (await this.rows(collection)).map(r => r.data as T);
    if (this.outbox && OUTBOX_COLLECTIONS.includes(collection)) {
      const queued = this.outbox.read().filter(q => q.collection === collection).map(q => q.item as unknown as T);
      const ids = new Set(rows.map((r: any) => r.id));
      return [...rows, ...queued.filter((q: any) => !ids.has(q.id))];
    }
    return rows;
  }

  async get<T>(collection: string, id: string): Promise<T | undefined> {
    return (await this.list<T & { id: string }>(collection)).find(r => r.id === id);
  }

  private async employees(): Promise<Employee[]> {
    const [pub, pay, secret] = await Promise.all([this.rows('employees'), this.rows('employeePay'), this.rows('employeeSecret')]);
    const payOf = new Map(pay.map(r => [r.id, r.data]));
    const secretOf = new Map(secret.map(r => [r.id, r.data]));
    return pub.map(r => ({
      baseSalary: 0, allowance: 0, payMethod: 'cash' as const, // people who may not see pay get these placeholders
      ...r.data, ...(payOf.get(r.id) ?? {}), ...(secretOf.get(r.id) ?? {})
    }));
  }

  private async runs() {
    const [runs, slips] = await Promise.all([this.rows('payrollRuns'), this.rows('payslips')]);
    return runs.map(r => {
      const mine = slips.filter(s => s.data.runId === r.id);
      return mine.length || r.data.slips ? { ...r.data, slips: Object.fromEntries(mine.map(s => [s.data.employeeId, s.data.net])) } : r.data;
    });
  }

  async put<T extends { id: string }>(collection: string, item: T, by: string, action: string): Promise<T> {
    const before = this.seen.get(this.key(collection, item.id));
    try {
      if (collection === 'employees') await this.putEmployee(item as unknown as Employee, by);
      else if (collection === 'payrollRuns') await this.putRun(item as any, by);
      else await this.be.upsert(this.companyId, collection, item.id, item, by);
    } catch (e) {
      if (this.outbox && OUTBOX_COLLECTIONS.includes(collection) && isOffline(e)) {
        this.outbox.write([...this.outbox.read().filter(q => !(q.collection === collection && q.item.id === item.id)), { collection, item, by, action }]);
        return item; // saved on the phone; flush() sends it
      }
      throw e;
    }
    // a newer write supersedes anything still waiting in the outbox for the same row, so flush() cannot overwrite it with the old one
    if (this.outbox) this.outbox.write(this.outbox.read().filter(q => !(q.collection === collection && q.item.id === item.id)));
    await this.be.addAudit(this.companyId, { by, action, entity: collection, entityId: item.id, before: redact(before), after: redact(item) });
    this.seen.set(this.key(collection, item.id), item);
    return item;
  }

  private async putEmployee(e: Employee, by: string) {
    const prev = {
      pub: this.seen.get(this.key('employees', e.id)), pay: this.seen.get(this.key('employeePay', e.id)), secret: this.seen.get(this.key('employeeSecret', e.id))
    };
    // an explicit `faceEnrolled: undefined` means "clear it"; a record read by someone who may not see faces simply has no such key
    const clearsFace = 'faceEnrolled' in e && e.faceEnrolled === undefined && (prev.secret !== undefined || (prev.pub?.faceCount ?? 0) > 0);
    const secret = pick(e, SECRET_KEYS);
    const hasSecret = SECRET_KEYS.some(k => (e as any)[k] !== undefined);
    const faceCount = clearsFace ? 0 : hasSecret ? faceCountOf(e) : (e as any).faceCount ?? prev.pub?.faceCount;
    const pub = { ...omit(e, [...PAY_KEYS, ...SECRET_KEYS, ...LOCAL_ONLY]), ...(faceCount !== undefined ? { faceCount } : {}) };
    const pay = pick(e, PAY_KEYS);
    if (!same(pub, prev.pub)) await this.be.upsert(this.companyId, 'employees', e.id, pub, by);
    if (Object.keys(pay).length && !same(pay, prev.pay)) await this.be.upsert(this.companyId, 'employeePay', e.id, pay, by);
    if (clearsFace) await this.be.del(this.companyId, 'employeeSecret', e.id);
    else if (hasSecret && !same(secret, prev.secret)) await this.be.upsert(this.companyId, 'employeeSecret', e.id, secret, by);
    this.seen.set(this.key('employees', e.id), pub);
    if (Object.keys(pay).length) this.seen.set(this.key('employeePay', e.id), pay);
    if (clearsFace) this.seen.delete(this.key('employeeSecret', e.id)); else if (hasSecret) this.seen.set(this.key('employeeSecret', e.id), secret);
  }

  private async putRun(run: { id: string; slips?: Record<string, number> } & Record<string, unknown>, by: string) {
    const { slips, ...rest } = run;
    await this.be.upsert(this.companyId, 'payrollRuns', run.id, rest, by);
    for (const [employeeId, net] of Object.entries(slips ?? {})) {
      const id = `${run.id}:${employeeId}`;
      if (!same(this.seen.get(this.key('payslips', id))?.net, net)) await this.be.upsert(this.companyId, 'payslips', id, { id, runId: run.id, employeeId, net }, by);
    }
  }

  async remove(collection: string, id: string, by: string, action: string): Promise<void> {
    const before = this.seen.get(this.key(collection, id));
    await this.be.del(this.companyId, collection, id);
    await this.be.addAudit(this.companyId, { by, action, entity: collection, entityId: id, before: redact(before) });
    this.seen.delete(this.key(collection, id));
  }

  audit(): Promise<AuditEntry[]> {
    return this.be.listAudit(this.companyId);
  }

  /** Send what was saved while there was no signal. Returns how many went through; the rest stay queued. */
  async flush(): Promise<number> {
    if (!this.outbox) return 0;
    const queue = this.outbox.read();
    let sent = 0;
    const left: QueuedWrite[] = [];
    for (const q of queue) {
      try {
        await this.be.upsert(this.companyId, q.collection, q.item.id, q.item, q.by);
        await this.be.addAudit(this.companyId, { by: q.by, action: q.action, entity: q.collection, entityId: q.item.id, after: redact(q.item) });
        sent++;
      } catch (e) {
        if (isOffline(e)) left.push(q); else throw e; // a refusal is not a signal problem: surface it, keep the rest of the queue
      }
    }
    this.outbox.write(left);
    return sent;
  }
}

/** A failed fetch (no connection), as opposed to the database saying no. */
export function isOffline(e: unknown): boolean {
  const m = String((e as any)?.message ?? e);
  return (typeof navigator !== 'undefined' && navigator.onLine === false) || /Failed to fetch|NetworkError|Load failed|network/i.test(m);
}
