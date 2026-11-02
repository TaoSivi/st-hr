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
    try {
      return JSON.parse(localStorage.getItem(this.prefix + collection) || '[]');
    } catch {
      return [];
    }
  }
  private write(collection: string, rows: unknown[]) {
    localStorage.setItem(this.prefix + collection, JSON.stringify(rows));
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
    if (i >= 0) rows[i] = item;
    else rows.push(item);
    this.write(collection, rows);
    // append-only: entries are never edited or removed
    const log = this.read<AuditEntry>('audit');
    log.push({ id: uid(), companyId: this.companyId, at: new Date().toISOString(), by, action, entity: collection, entityId: item.id, before, after: item });
    this.write('audit', log);
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
