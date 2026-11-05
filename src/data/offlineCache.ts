import type { Row } from './remote';

/**
 * What this phone keeps of the last data it was given, so the app opens with no signal: the people, branches, settings and the person's own
 * history are shown as they were, and a clock-in can still be made (it waits in the outbox until the signal is back).
 * It holds only what the server already gave that person, kept apart for each person on the phone, and it is refreshed at every online visit.
 * Photos are left out: they are large and not needed to open the app.
 */
export interface ReadCache { read(collection: string): Row[] | null; write(collection: string, rows: Row[]): void }

const prefix = (companyId: string, employeeId: string) => `sthr-cache:${companyId}:${employeeId}:`;

const slim = (collection: string, rows: Row[]): Row[] =>
  collection === 'scans' ? rows.map(r => (r.data && r.data.photo ? { ...r, data: { ...r.data, photo: undefined } } : r)) : rows;

export function localCache(companyId: string, employeeId: string): ReadCache {
  return {
    read: c => {
      try { const v = JSON.parse(localStorage.getItem(prefix(companyId, employeeId) + c) || 'null'); return Array.isArray(v) ? (v as Row[]) : null; } catch { return null; }
    },
    write: (c, rows) => {
      try { localStorage.setItem(prefix(companyId, employeeId) + c, JSON.stringify(slim(c, rows))); } catch { /* storage full: the app just needs the signal next time */ }
    }
  };
}
