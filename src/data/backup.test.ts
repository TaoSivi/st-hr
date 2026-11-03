import { describe, expect, it } from 'vitest';
import { backupFileName, backupProblem, makeBackup, restoreBackup, type Backup } from './backup';
import { DEMO_COMPANY_ID, meKey, storePrefix } from './companies';
import type { Company } from '../domain/company';

/** A Storage-like map, as localStorage behaves. */
function fakeStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    dump: () => Object.fromEntries(m)
  };
}

const shop: Company = { id: 'c-shop', name: 'ຮ້ານ ST', plan: 'basic', createdAt: '2026-11-01' };
const other: Company = { id: 'c-other', name: 'ບໍລິສັດອື່ນ', plan: 'free', createdAt: '2026-11-01' };
const P = storePrefix(shop.id), O = storePrefix(other.id);

describe('backing up one company', () => {
  it('takes every stored collection of that company and nothing else', () => {
    const s = fakeStorage({ [P + 'employees']: '[1]', [P + 'scans']: '[2]', [O + 'employees']: '[9]', [meKey(shop.id)]: 'e-1', 'sthr-companies': '[]' });
    const b = makeBackup(s, shop, new Date('2026-11-03T10:00:00Z'));
    expect(b.data).toEqual({ [P + 'employees']: '[1]', [P + 'scans']: '[2]' });
    expect(b).toMatchObject({ app: 'st-hr', version: 1, company: shop, exportedAt: '2026-11-03T10:00:00.000Z' });
  });
  it('the demo company and a real one never share keys', () => {
    expect(storePrefix(DEMO_COMPANY_ID).startsWith(P) || P.startsWith(storePrefix(DEMO_COMPANY_ID))).toBe(false);
  });
  it('names the file after the company and the day, without characters a file name cannot hold', () => {
    expect(backupFileName({ name: 'ຮ້ານ A/B: ສາຂາ*1' }, new Date(2026, 10, 3))).toBe('ST-HR_ສຳຮອງ_ຮ້ານ A B ສາຂາ 1_2026-11-03.json');
  });
});

describe('restoring', () => {
  const good = (): Backup => ({ app: 'st-hr', version: 1, exportedAt: 'x', company: shop, data: { [P + 'employees']: '[1,2]' } });
  it('refuses anything that is not a whole ST HR backup, saying why', () => {
    expect(backupProblem(null)).toMatch('ບໍ່ແມ່ນໄຟລ໌ສຳຮອງ');
    expect(backupProblem({ app: 'other' })).toMatch('ບໍ່ແມ່ນໄຟລ໌ສຳຮອງ');
    expect(backupProblem({ ...good(), version: 2 })).toMatch('ລຸ້ນ');
    expect(backupProblem({ ...good(), company: { id: '', name: '' } })).toMatch('ບໍລິສັດ');
    expect(backupProblem({ ...good(), data: {} })).toMatch('ວ່າງ');
    expect(backupProblem({ ...good(), data: { [P + 'x']: 5 } })).toMatch('ເສຍຫາຍ');
    expect(backupProblem(good())).toBeNull();
  });
  it('a file can never write into another company', () => {
    expect(backupProblem({ ...good(), data: { [P + 'employees']: '[]', [O + 'employees']: '[]' } })).toMatch('ບໍລິສັດອື່ນ');
    expect(backupProblem({ ...good(), data: { 'sthr-companies': '[]' } })).toMatch('ບໍລິສັດອື່ນ');
  });
  it('replaces that company\'s data, leaves other companies and the signed-in person alone, and registers the company', () => {
    const s = fakeStorage({ [P + 'employees']: '[0]', [P + 'old']: 'gone', [O + 'employees']: '[9]', [meKey(shop.id)]: 'e-1' });
    const saved: Company[] = [];
    const n = restoreBackup(s, good(), c => saved.push(c));
    expect(n).toBe(1);
    expect(s.dump()).toEqual({ [P + 'employees']: '[1,2]', [O + 'employees']: '[9]', [meKey(shop.id)]: 'e-1' });
    expect(saved).toEqual([shop]);
  });
  it('a bad file changes nothing', () => {
    const s = fakeStorage({ [P + 'employees']: '[0]' });
    expect(() => restoreBackup(s, { ...good(), data: { [O + 'x']: '1' } }, () => {})).toThrow();
    expect(s.dump()).toEqual({ [P + 'employees']: '[0]' });
  });
  it('a backup made here restores to the same data elsewhere', () => {
    const a = fakeStorage({ [P + 'employees']: '[{"name":"ສົມ"}]', [P + 'settings']: '{}' });
    const b = fakeStorage();
    restoreBackup(b, JSON.parse(JSON.stringify(makeBackup(a, shop, new Date()))), () => {});
    expect(b.dump()).toEqual(a.dump());
  });
});
