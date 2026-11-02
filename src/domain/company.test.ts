import { beforeEach, describe, expect, it } from 'vitest';
import {
  addDays, addMonths, applyPayment, branchBlock, countedEmployees, effectivePlan, extendValidUntil, featureBlock, featureOn, GRACE_DAYS, hireBlock, limitsOf, newCompany,
  planState, PLANS, priceFor, TRIAL_DAYS, validateCompanyName, validatePayment, type Company
} from './company';
import { createCompany, DEMO_COMPANY_ID, deleteCompany, getCompany, listCompanies, listPayments, meKey, recordPayment, storePrefix } from '../data/companies';
import { LocalStore } from '../data/store';
import { seed, seedNewCompany } from '../data/seed';

const co = (over: Partial<Company> = {}): Company => ({ id: 'c1', name: 'A', plan: 'basic', createdAt: '2026-01-01', validUntil: '2026-12-31', ...over });

describe('dates', () => {
  it('addMonths keeps the day, clamps to the month end, crosses years', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-12-31', 12)).toBe('2027-12-31');
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
  });
  it('addDays crosses month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('plan state and the plan in force', () => {
  it('active through the last day, grace for the next 7, then expired', () => {
    const c = co({ validUntil: '2026-12-31' });
    expect(planState(c, '2026-12-31')).toBe('active');
    expect(planState(c, '2027-01-01')).toBe('grace');
    expect(planState(c, addDays('2026-12-31', GRACE_DAYS))).toBe('grace');
    expect(planState(c, addDays('2026-12-31', GRACE_DAYS + 1))).toBe('expired');
  });
  it('no end date means it never runs out', () => expect(planState(co({ validUntil: undefined }), '2099-01-01')).toBe('active'));
  it('the chosen plan holds during grace and drops to Free once expired', () => {
    expect(effectivePlan(co(), '2027-01-03')).toBe('basic');
    expect(effectivePlan(co(), '2027-02-01')).toBe('free');
  });
});

describe('limits and features', () => {
  it('limits follow the effective plan; overrides win', () => {
    expect(limitsOf(co(), '2026-11-02')).toEqual({ maxEmployees: PLANS.basic.maxEmployees, maxBranches: PLANS.basic.maxBranches });
    expect(limitsOf(co(), '2027-06-01')).toEqual({ maxEmployees: PLANS.free.maxEmployees, maxBranches: PLANS.free.maxBranches });
    expect(limitsOf(co({ limitOverrides: { maxEmployees: 99 } }), '2026-11-02')).toEqual({ maxEmployees: 99, maxBranches: PLANS.basic.maxBranches });
  });
  it('features come from the plan: Free none, Basic Excel, Pro everything', () => {
    expect(featureOn(co({ plan: 'free', validUntil: undefined }), 'excelExport', '2026-11-02')).toBe(false);
    expect(featureOn(co({ plan: 'basic' }), 'excelExport', '2026-11-02')).toBe(true);
    expect(featureOn(co({ plan: 'basic' }), 'payItems', '2026-11-02')).toBe(false);
    expect(featureOn(co({ plan: 'pro' }), 'payItems', '2026-11-02')).toBe(true);
  });
  it('an expired plan loses its features', () => expect(featureOn(co({ plan: 'pro' }), 'excelExport', '2027-06-01')).toBe(false));
  it('a per-company override beats the plan in both directions', () => {
    expect(featureOn(co({ plan: 'basic', featureOverrides: { payItems: true } }), 'payItems', '2026-11-02')).toBe(true);
    expect(featureOn(co({ plan: 'pro', featureOverrides: { excelExport: false } }), 'excelExport', '2026-11-02')).toBe(false);
    expect(featureOn(co({ plan: 'pro', featureOverrides: {} }), 'excelExport', '2026-11-02')).toBe(true);
  });
  it('the message says whether the plan lacks it or has expired; nothing when on', () => {
    expect(featureBlock(co({ plan: 'basic' }), 'payItems', '2026-11-02')).toMatch('ຍົກລະດັບ');
    expect(featureBlock(co({ plan: 'pro' }), 'excelExport', '2027-06-01')).toMatch('ໝົດອາຍຸ');
    expect(featureBlock(co({ plan: 'pro' }), 'excelExport', '2026-11-02')).toBeNull();
  });
});

describe('employee and branch limits', () => {
  it('counts people not yet gone, including future hires; leavers whose last day passed do not count', () => {
    const list = [{}, { endDate: '2026-12-01' }, { endDate: '2026-11-02' }, { endDate: '2026-11-01' }];
    expect(countedEmployees(list, '2026-11-02')).toBe(3);
  });
  it('a hire is refused exactly at the limit, allowed just below', () => {
    const c = co({ plan: 'free', validUntil: undefined });
    expect(hireBlock(c, PLANS.free.maxEmployees - 1, '2026-11-02')).toBeNull();
    expect(hireBlock(c, PLANS.free.maxEmployees, '2026-11-02')).toMatch(`${PLANS.free.maxEmployees}`);
  });
  it('a branch is refused at the limit; an override raises it', () => {
    const c = co({ plan: 'free', validUntil: undefined });
    expect(branchBlock(c, 1, '2026-11-02')).toMatch('ສາຂາ');
    expect(branchBlock({ ...c, limitOverrides: { maxBranches: 3 } }, 1, '2026-11-02')).toBeNull();
  });
  it('an expired Pro company is held to Free limits, with its data untouched', () => {
    expect(hireBlock(co({ plan: 'pro' }), 6, '2027-06-01')).not.toBeNull();
    expect(hireBlock(co({ plan: 'pro' }), 6, '2026-11-02')).toBeNull();
  });
});

describe('payments', () => {
  it('extends from the later of the old end date and today', () => {
    expect(extendValidUntil('2026-12-31', '2026-11-02', 1)).toBe('2027-01-31'); // paying early keeps the remaining days
    expect(extendValidUntil('2026-10-01', '2026-11-02', 1)).toBe('2026-12-02'); // paying late does not back-date
    expect(extendValidUntil(undefined, '2026-11-02', 12)).toBe('2027-11-02');
  });
  it('a payment sets the plan, ends the trial and extends the period', () => {
    const t = newCompany('c9', ' New Co ', '2026-11-02');
    expect(t).toMatchObject({ name: 'New Co', plan: 'pro', trial: true, validUntil: addDays('2026-11-02', TRIAL_DAYS) });
    const paid = applyPayment(t, { plan: 'basic', months: 2 }, '2026-11-10');
    expect(paid).toMatchObject({ plan: 'basic', trial: false, validUntil: '2027-02-02' }); // trial ends 2 Dec; the 2 paid months start after it
  });
  it('validates plan, months and amount', () => {
    expect(validatePayment({ plan: 'basic', months: 1, amount: 300_000 })).toEqual([]);
    expect(validatePayment({ plan: 'free', months: 1, amount: 0 }).join()).toMatch('Free');
    for (const months of [0, 37, 1.5, NaN]) expect(validatePayment({ plan: 'basic', months, amount: 1 }).join(), String(months)).toMatch('ເດືອນ');
    for (const amount of [-1, 1.5, NaN]) expect(validatePayment({ plan: 'basic', months: 1, amount }).join(), String(amount)).toMatch('ຈຳນວນເງິນ');
    expect(priceFor('basic', 3)).toBe(PLANS.basic.priceLakPerMonth * 3);
  });
  it('company names are required, short and unique (any case)', () => {
    expect(validateCompanyName('', [])).toHaveLength(1);
    expect(validateCompanyName('  ', [])).toHaveLength(1);
    expect(validateCompanyName('x'.repeat(61), []).join()).toMatch('60');
    expect(validateCompanyName(' acme ', [{ name: 'ACME' }]).join()).toMatch('ແລ້ວ');
    expect(validateCompanyName('Acme', [{ name: 'Other' }])).toEqual([]);
  });
});

// ---- the registry and the isolation between companies, over a browser-like localStorage ----
class Mem {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  keys() { return [...this.m.keys()]; }
}
const installStorage = () => {
  const ls = new Mem();
  (globalThis as any).localStorage = new Proxy(ls, { ownKeys: t => t.keys(), getOwnPropertyDescriptor: (t, k) => (typeof k === 'string' && t.getItem(k) !== null ? { enumerable: true, configurable: true, value: t.getItem(k) } : undefined) });
};

describe('company registry and isolation', () => {
  beforeEach(installStorage);

  it('always has the demo company, which never expires', () => {
    const all = listCompanies();
    expect(all.map(c => c.id)).toEqual([DEMO_COMPANY_ID]);
    expect(planState(all[0], '2099-01-01')).toBe('active');
    expect(featureOn(all[0], 'payItems', '2099-01-01')).toBe(true);
  });
  it('data prefixes: the demo keeps its own, others never start with it', () => {
    expect(storePrefix(DEMO_COMPANY_ID)).toBe('sthr:');
    expect(storePrefix('c-abc')).not.toMatch(/^sthr:/);
    expect(meKey(DEMO_COMPANY_ID)).toBe('sthr-me');
    expect(meKey('c-abc')).not.toBe('sthr-me');
  });
  it('a new company gets its own owner, branch, shifts and settings, and sees nothing of the demo', async () => {
    const demo = new LocalStore(DEMO_COMPANY_ID, storePrefix(DEMO_COMPANY_ID));
    await seed(demo);
    const c = createCompany('ຮ້ານ ກ', '2026-11-02');
    const store = new LocalStore(c.id, storePrefix(c.id));
    await seedNewCompany(store, c.id, 'ສົມ ໃຈດີ', '2026-11-02');
    const emps = await store.list<any>('employees');
    expect(emps).toHaveLength(1);
    expect(emps[0]).toMatchObject({ name: 'ສົມ ໃຈດີ', companyId: c.id, roles: ['employee', 'owner'], baseSalary: 0 });
    expect((await store.list<any>('branches')).map(b => b.companyId)).toEqual([c.id]);
    expect((await store.list<any>('shifts')).length).toBeGreaterThan(0);
    expect((await store.list<any>('settings'))[0].companyId).toBe(c.id);
    expect((await demo.list<any>('employees')).length).toBeGreaterThan(5); // the demo company is untouched
    expect((await demo.list<any>('employees')).some(e => e.companyId === c.id)).toBe(false);
  });
  it('writes in one company never appear in another, and each keeps its own audit log', async () => {
    const a = createCompany('A', '2026-11-02'), b = createCompany('B', '2026-11-02');
    const sa = new LocalStore(a.id, storePrefix(a.id)), sb = new LocalStore(b.id, storePrefix(b.id));
    await seedNewCompany(sa, a.id, 'owner a', '2026-11-02');
    await seedNewCompany(sb, b.id, 'owner b', '2026-11-02');
    await sa.put('leaves', { id: 'l1', note: 'only in A' }, 'x', 'test');
    expect(await sb.list('leaves')).toEqual([]);
    expect((await sa.audit()).every(e => e.companyId === a.id)).toBe(true);
    expect((await sb.audit()).every(e => e.companyId === b.id)).toBe(true);
    expect((await sa.audit()).some(e => e.entityId === 'l1')).toBe(true);
    expect((await sb.audit()).some(e => e.entityId === 'l1')).toBe(false);
  });
  it('resetting the demo never touches another company, and deleting a company never touches the demo', async () => {
    const demo = new LocalStore(DEMO_COMPANY_ID, storePrefix(DEMO_COMPANY_ID));
    await seed(demo);
    const c = createCompany('C', '2026-11-02');
    const store = new LocalStore(c.id, storePrefix(c.id));
    await seedNewCompany(store, c.id, 'owner', '2026-11-02');
    demo.reset();
    expect((await store.list<any>('employees')).length).toBe(1);
    expect(await demo.list('employees')).toEqual([]);
    await seed(demo);
    deleteCompany(c.id);
    expect((await store.list('employees'))).toEqual([]);
    expect((await demo.list<any>('employees')).length).toBeGreaterThan(5);
    expect(getCompany(c.id)).toBeUndefined();
  });
  it('the demo company cannot be deleted', () => expect(() => deleteCompany(DEMO_COMPANY_ID)).toThrow());
  it('a recorded payment is kept in history and moves the company to the paid plan', () => {
    const c = createCompany('P', '2026-11-02');
    const next = recordPayment(c, { plan: 'basic', months: 3, amount: 900_000, note: 'LDB 123' }, 'platform', '2026-11-05');
    expect(next).toMatchObject({ plan: 'basic', trial: false, validUntil: addMonths(c.validUntil!, 3) });
    expect(getCompany(c.id)).toEqual(next);
    expect(listPayments(c.id)).toHaveLength(1);
    expect(listPayments(c.id)[0]).toMatchObject({ plan: 'basic', months: 3, amount: 900_000, note: 'LDB 123', paidAt: '2026-11-05' });
    expect(listPayments('other')).toEqual([]);
  });
  it('a trial that runs out falls back to Free limits but the company and its data remain', () => {
    const c = createCompany('T', '2026-11-02');
    const later = addDays(c.validUntil!, GRACE_DAYS + 1);
    expect(effectivePlan(c, later)).toBe('free');
    expect(getCompany(c.id)).toBeDefined();
  });
});
