/** Several companies share one system; each has its own people, settings and audit log, and its own plan. */
export type PlanId = 'free' | 'basic' | 'pro';
export type Feature = 'excelExport' | 'payItems';

export const FEATURE_LABEL: Record<Feature, string> = { excelExport: 'Export Excel (ລາຍງານ / ເງິນເດືອນ)', payItems: 'ໂບນັດ / ຄອມມິດຊັນ / ອື່ນໆ' };
export const ALL_FEATURES = Object.keys(FEATURE_LABEL) as Feature[];

export interface PlanDef { label: string; priceLakPerMonth: number; maxEmployees: number; maxBranches: number; features: Feature[] }

// ⚠️ Prices and limits are PLACEHOLDERS for the owner to set before selling. Nothing else in the code depends on these numbers.
export const PLANS: Record<PlanId, PlanDef> = {
  free: { label: 'Free', priceLakPerMonth: 0, maxEmployees: 5, maxBranches: 1, features: [] },
  basic: { label: 'Basic', priceLakPerMonth: 300_000, maxEmployees: 30, maxBranches: 3, features: ['excelExport'] },
  pro: { label: 'Pro', priceLakPerMonth: 800_000, maxEmployees: 500, maxBranches: 50, features: ['excelExport', 'payItems'] }
};
export const PLAN_ORDER: PlanId[] = ['free', 'basic', 'pro'];

/** After the paid period ends the company keeps working at full strength for this long, so a late payment never stops payroll day. */
export const GRACE_DAYS = 7;
/** A new company starts on Pro for this long. */
export const TRIAL_DAYS = 30;

export interface Company {
  id: string;
  name: string;
  plan: PlanId;
  validUntil?: string; // YYYY-MM-DD, last day of the paid / trial period; empty = no expiry (the demo company, or a free plan)
  featureOverrides?: Partial<Record<Feature, boolean>>; // the platform operator switches a feature on or off for this company only
  limitOverrides?: { maxEmployees?: number; maxBranches?: number };
  createdAt: string;
  trial?: boolean;
}

export interface Payment { id: string; companyId: string; plan: PlanId; months: number; amount: number; paidAt: string; note?: string; by: string }

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => new Date(s + 'T12:00:00');
export const addDays = (date: string, n: number) => { const d = parse(date); d.setDate(d.getDate() + n); return fmt(d); };

/** Add whole calendar months, keeping the day (31 Jan + 1 month = 28/29 Feb, not 3 Mar). */
export function addMonths(date: string, n: number): string {
  const d = parse(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return fmt(d);
}

export type PlanState = 'active' | 'grace' | 'expired';

/** Where the company is in its paid period. No end date means it never runs out. */
export function planState(c: Pick<Company, 'validUntil'>, today: string): PlanState {
  if (!c.validUntil || today <= c.validUntil) return 'active';
  return today <= addDays(c.validUntil, GRACE_DAYS) ? 'grace' : 'expired';
}

/** The plan actually in force: the chosen plan, or Free once the paid period and its grace have run out. */
export const effectivePlan = (c: Pick<Company, 'plan' | 'validUntil'>, today: string): PlanId => (planState(c, today) === 'expired' ? 'free' : c.plan);

export function limitsOf(c: Pick<Company, 'plan' | 'validUntil' | 'limitOverrides'>, today: string): { maxEmployees: number; maxBranches: number } {
  const p = PLANS[effectivePlan(c, today)];
  return { maxEmployees: c.limitOverrides?.maxEmployees ?? p.maxEmployees, maxBranches: c.limitOverrides?.maxBranches ?? p.maxBranches };
}

/** Whether a feature is on for this company today. A per-company override beats the plan, in either direction. */
export function featureOn(c: Pick<Company, 'plan' | 'validUntil' | 'featureOverrides'>, f: Feature, today: string): boolean {
  const o = c.featureOverrides?.[f];
  return o !== undefined ? o : PLANS[effectivePlan(c, today)].features.includes(f);
}

/** Why a feature is unavailable, or null when it is on. */
export function featureBlock(c: Pick<Company, 'plan' | 'validUntil' | 'featureOverrides'>, f: Feature, today: string): string | null {
  if (featureOn(c, f, today)) return null;
  return planState(c, today) === 'expired'
    ? `ແພັກເກັດໝົດອາຍຸ — "${FEATURE_LABEL[f]}" ໃຊ້ບໍ່ໄດ້ຈົນກວ່າຈະຕໍ່ອາຍຸ`
    : `ແພັກເກັດ ${PLANS[c.plan].label} ບໍ່ມີ "${FEATURE_LABEL[f]}" — ຕິດຕໍ່ຜູ້ໃຫ້ບໍລິການເພື່ອຍົກລະດັບ`;
}

/** People on the roster that count toward the limit: everyone not yet gone (future hires included, so the limit cannot be dodged by dating a hire ahead). */
export const countedEmployees = (employees: { endDate?: string }[], today: string) => employees.filter(e => !e.endDate || e.endDate >= today).length;

export function hireBlock(c: Pick<Company, 'plan' | 'validUntil' | 'limitOverrides'>, current: number, today: string): string | null {
  const { maxEmployees } = limitsOf(c, today);
  return current >= maxEmployees ? `ແພັກເກັດນີ້ມີພະນັກງານໄດ້ສູງສຸດ ${maxEmployees} ຄົນ (ມີ ${current} ຄົນແລ້ວ) — ຍົກລະດັບແພັກເກັດກ່ອນ` : null;
}

export function branchBlock(c: Pick<Company, 'plan' | 'validUntil' | 'limitOverrides'>, current: number, today: string): string | null {
  const { maxBranches } = limitsOf(c, today);
  return current >= maxBranches ? `ແພັກເກັດນີ້ມີສາຂາໄດ້ສູງສຸດ ${maxBranches} ສາຂາ (ມີ ${current} ແລ້ວ) — ຍົກລະດັບແພັກເກັດກ່ອນ` : null;
}

/** A payment extends the paid period from whichever is later: the old end date or today (paying early loses nothing; paying late does not back-date). */
export function extendValidUntil(current: string | undefined, today: string, months: number): string {
  return addMonths(current && current > today ? current : today, months);
}

export const priceFor = (plan: PlanId, months: number) => PLANS[plan].priceLakPerMonth * months;

/** Everything wrong with a payment being recorded, in Lao. */
export function validatePayment(p: { plan: PlanId; months: number; amount: number }): string[] {
  const e: string[] = [];
  if (!PLAN_ORDER.includes(p.plan)) e.push('ເລືອກແພັກເກັດ');
  else if (p.plan === 'free') e.push('ແພັກເກັດ Free ບໍ່ຕ້ອງຊຳລະ');
  if (!Number.isInteger(p.months) || p.months < 1 || p.months > 36) e.push('ຈຳນວນເດືອນຕ້ອງເປັນເລກເຕັມ 1–36');
  if (!Number.isInteger(p.amount) || p.amount < 0) e.push('ຈຳນວນເງິນຕ້ອງເປັນເລກເຕັມ ບໍ່ຕິດລົບ');
  return e;
}

/** Everything wrong with a new company's name, in Lao. */
export function validateCompanyName(name: string, existing: { name: string }[]): string[] {
  const n = name?.trim() ?? '';
  if (!n) return ['ໃສ່ຊື່ບໍລິສັດ'];
  const e: string[] = [];
  if (n.length > 60) e.push('ຊື່ບໍລິສັດຍາວເກີນ 60 ຕົວອັກສອນ');
  if (existing.some(x => x.name.trim().toLowerCase() === n.toLowerCase())) e.push(`ມີບໍລິສັດຊື່ "${n}" ແລ້ວ`);
  return e;
}

/** A brand-new company: a full-featured trial that falls back to Free when it ends. */
export const newCompany = (id: string, name: string, today: string): Company =>
  ({ id, name: name.trim(), plan: 'pro', trial: true, validUntil: addDays(today, TRIAL_DAYS), createdAt: today });

/** Record a payment: the company takes the paid plan and its period is extended (from the later of the old end date and today). */
export function applyPayment(c: Company, p: Pick<Payment, 'plan' | 'months'>, today: string): Company {
  return { ...c, plan: p.plan, trial: false, validUntil: extendValidUntil(c.validUntil, today, p.months) };
}
