export interface CompEarn { date: string; days: number }
export interface CompUse { from: string; days: number }

const addDays = (date: string, n: number) => {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Compensatory days earned by working on a public holiday: the share of the paid shift actually worked,
 * to the nearest half day, at most one. Working under half an hour earns nothing.
 */
export function compDaysFor(workedMin: number, paidMin: number): number {
  if (!(paidMin > 0) || !(workedMin > 0)) return 0;
  return Math.min(1, Math.round((workedMin / paidMin) * 2) / 2);
}

/**
 * Compensatory leave left on `asOf`. Days expire `expiryDays` after the holiday worked (0 = never).
 * Leave taken uses the oldest days first, and only days that had not expired on the day the leave started.
 */
export function compBalance(p: { earned: CompEarn[]; used: CompUse[]; asOf: string; expiryDays: number }): { earned: number; used: number; expired: number; left: number } {
  const buckets = [...p.earned].filter(e => e.days > 0).sort((a, b) => a.date.localeCompare(b.date)).map(e => ({ ...e, left: e.days }));
  const expiresOn = (b: { date: string }) => (p.expiryDays > 0 ? addDays(b.date, p.expiryDays) : '9999-12-31');
  let usedTotal = 0;
  for (const u of [...p.used].sort((a, b) => a.from.localeCompare(b.from))) {
    let need = u.days;
    for (const b of buckets) {
      if (need <= 0) break;
      if (b.date > u.from || expiresOn(b) < u.from || b.left <= 0) continue;
      const take = Math.min(b.left, need);
      b.left -= take; need -= take; usedTotal += take;
    }
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const earned = buckets.reduce((a, b) => a + b.days, 0);
  const expired = buckets.filter(b => b.date <= p.asOf && expiresOn(b) < p.asOf).reduce((a, b) => a + b.left, 0);
  const left = buckets.filter(b => b.date <= p.asOf && expiresOn(b) >= p.asOf).reduce((a, b) => a + b.left, 0);
  return { earned: round(earned), used: round(usedTotal), expired: round(expired), left: round(left) };
}
