import type { Row } from './remote';

/**
 * What this phone keeps of the last data it was given, so the app opens with no signal: the people, branches, settings and the person's own
 * history are shown as they were, and a clock-in can still be made (it waits in the outbox until the signal is back).
 * It holds only what the server already gave this signed-in person, and it is wiped on sign-out. Photos are left out: they are large and not needed to open the app.
 */
export interface ReadCache { read(collection: string): Row[] | null; write(collection: string, rows: Row[]): void }

const prefix = (companyId: string) => `sthr-cache:${companyId}:`;

const slim = (collection: string, rows: Row[]): Row[] =>
  collection === 'scans' ? rows.map(r => (r.data && r.data.photo ? { ...r, data: { ...r.data, photo: undefined } } : r)) : rows;

export function localCache(companyId: string): ReadCache {
  return {
    read: c => {
      try { const v = JSON.parse(localStorage.getItem(prefix(companyId) + c) || 'null'); return Array.isArray(v) ? (v as Row[]) : null; } catch { return null; }
    },
    write: (c, rows) => {
      try { localStorage.setItem(prefix(companyId) + c, JSON.stringify(slim(c, rows))); } catch { /* storage full: the app just needs the signal next time */ }
    }
  };
}

/** Forget everything kept for a company (sign-out): the next person on this phone must not find it. */
export function clearLocalCache(companyId?: string) {
  try {
    const p = companyId ? prefix(companyId) : 'sthr-cache:';
    Object.keys(localStorage).filter(k => k.startsWith(p)).forEach(k => localStorage.removeItem(k));
  } catch { /* nothing to clear */ }
}
