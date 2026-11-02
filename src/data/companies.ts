import { applyPayment, newCompany, type Company, type Payment } from '../domain/company';
import { uid } from './store';

/** The sample company shipped with the demo. It never expires and has every feature. */
export const DEMO_COMPANY_ID = 'demo-co';
const KEY = 'sthr-companies';
const PAY = 'sthr-payments';

/**
 * Where a company's data lives in the browser. The demo company keeps the original prefix so existing demo data stays;
 * the others use a prefix that does NOT start with the demo one, so resetting the demo can never delete another company's data.
 */
export const storePrefix = (companyId: string) => (companyId === DEMO_COMPANY_ID ? 'sthr:' : `sthrc:${companyId}:`);
export const meKey = (companyId: string) => (companyId === DEMO_COMPANY_ID ? 'sthr-me' : `sthr-me:${companyId}`);

const readJson = <T>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; }
};

export function listCompanies(): Company[] {
  const rows = readJson<Company[]>(KEY, []);
  if (rows.some(c => c.id === DEMO_COMPANY_ID)) return rows;
  const demo: Company = { id: DEMO_COMPANY_ID, name: 'ບໍລິສັດຕົວຢ່າງ (Demo)', plan: 'pro', createdAt: '2026-11-02' };
  const all = [demo, ...rows];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage full: the demo company is still returned */ }
  return all;
}

export const getCompany = (id: string): Company | undefined => listCompanies().find(c => c.id === id);

export function saveCompany(c: Company): void {
  const all = listCompanies();
  const i = all.findIndex(x => x.id === c.id);
  if (i >= 0) all[i] = c; else all.push(c);
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function createCompany(name: string, today: string): Company {
  const c = newCompany('c-' + uid().slice(0, 8), name, today);
  saveCompany(c);
  return c;
}

export const listPayments = (companyId?: string): Payment[] => readJson<Payment[]>(PAY, []).filter(p => !companyId || p.companyId === companyId);

/** Write the payment and the company's new period together; the payment is saved first so a failure never extends a period without a record. */
export function recordPayment(c: Company, p: { plan: Payment['plan']; months: number; amount: number; note?: string }, by: string, today: string): Company {
  const payment: Payment = { id: uid(), companyId: c.id, plan: p.plan, months: p.months, amount: p.amount, paidAt: today, note: p.note, by };
  localStorage.setItem(PAY, JSON.stringify([...readJson<Payment[]>(PAY, []), payment]));
  const next = applyPayment(c, p, today);
  saveCompany(next);
  return next;
}

/** Remove a company and everything it stored. Used when a trial is abandoned; never touches other companies. */
export function deleteCompany(id: string): void {
  if (id === DEMO_COMPANY_ID) throw new Error('ລຶບບໍລິສັດຕົວຢ່າງບໍ່ໄດ້');
  const prefix = storePrefix(id);
  Object.keys(localStorage).filter(k => k.startsWith(prefix)).forEach(k => localStorage.removeItem(k));
  localStorage.removeItem(meKey(id));
  localStorage.setItem(KEY, JSON.stringify(listCompanies().filter(c => c.id !== id)));
}
