import type { AuditEntry } from '../domain/types';

/**
 * The only door between the UI and storage. Demo mode keeps everything in the browser;
 * production swaps in ApiStore (same interface) pointed at the Docker backend.
 */
export interface DataStore {
  list<T>(collection: string): Promise<T[]>;
  get<T>(collection: string, id: string): Promise<T | undefined>;
  put<T extends { id: string }>(collection: string, item: T, by: string, action: string): Promise<T>;
  audit(): Promise<AuditEntry[]>;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export class LocalStore implements DataStore {
  constructor(private companyId: string, private prefix = 'sthr:') {}

  private read<T>(collection: string): T[] {
    const key = this.prefix + collection;
    const raw = localStorage.getItem(key);
    try {
      return JSON.parse(raw || '[]');
    } catch {
      // never let the next write silently replace unreadable data: keep a copy to recover from
      try { localStorage.setItem(key + ':corrupt', raw ?? ''); } catch { /* storage full */ }
      return [];
    }
  }
  private write(collection: string, rows: unknown[]) {
    try {
      localStorage.setItem(this.prefix + collection, JSON.stringify(rows));
    } catch (e: any) {
      throw new Error(e?.name === 'QuotaExceededError' ? 'ໜ່ວຍຄວາມຈຳໃນເຄື່ອງເຕັມ ບັນທຶກບໍ່ໄດ້' : 'ບັນທຶກບໍ່ໄດ້');
    }
  }

  async list<T>(collection: string): Promise<T[]> {
    return this.read<T>(collection);
  }
  async get<T>(collection: string, id: string): Promise<T | undefined> {
    return this.read<T & { id: string }>(collection).find(r => r.id === id);
  }
  async put<T extends { id: string }>(collection: string, item: T, by: string, action: string): Promise<T> {
    const rows = this.read<T>(collection);
    const i = rows.findIndex(r => r.id === item.id);
    const before = i >= 0 ? rows[i] : undefined;
    const previousRows = rows.slice();
    if (i >= 0) rows[i] = item;
    else rows.push(item);
    this.write(collection, rows);
    // append-only audit. Photos are left out: they are large and already live on the record itself.
    const strip = (v: unknown) => (v && typeof v === 'object' && (v as any).photo ? { ...(v as any), photo: '[ຮູບ]' } : v);
    try {
      const log = this.read<AuditEntry>('audit');
      log.push({ id: uid(), companyId: this.companyId, at: new Date().toISOString(), by, action, entity: collection, entityId: item.id, before: strip(before), after: strip(item) });
      this.write('audit', log);
    } catch (e) {
      // a change must never exist without its audit entry: undo the data write, then report the failure
      this.write(collection, previousRows);
      throw e;
    }
    return item;
  }
  async audit(): Promise<AuditEntry[]> {
    return this.read<AuditEntry>('audit');
  }
  isSeeded() {
    return localStorage.getItem(this.prefix + 'seeded') === '1';
  }
  markSeeded() {
    localStorage.setItem(this.prefix + 'seeded', '1');
  }
  reset() {
    Object.keys(localStorage).filter(k => k.startsWith(this.prefix)).forEach(k => localStorage.removeItem(k));
  }
}

/** Production backend (not built yet): same contract over HTTP. */
export class ApiStore implements DataStore {
  constructor(private baseUrl: string, private token: string) {}
  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await fetch(this.baseUrl + path, { ...init, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.token } });
    if (!r.ok) throw new Error(`API ${r.status}`);
    return r.json();
  }
  list<T>(c: string) { return this.req<T[]>(`/${c}`); }
  get<T>(c: string, id: string) { return this.req<T>(`/${c}/${id}`); }
  put<T extends { id: string }>(c: string, item: T, _by: string, action: string) {
    return this.req<T>(`/${c}/${item.id}`, { method: 'PUT', body: JSON.stringify({ item, action }) });
  }
  audit() { return this.req<AuditEntry[]>('/audit'); }
}

export { uid };
