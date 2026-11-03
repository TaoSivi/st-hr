import type { Company } from '../domain/company';
import { meKey, storePrefix } from './companies';

/**
 * While the app keeps its data in this browser only, a backup file is the one copy that survives a lost phone,
 * a cleared browser or a new computer. It holds one company: its registry entry and every stored collection, as they are.
 */
export interface Backup { app: 'st-hr'; version: 1; exportedAt: string; company: Company; data: Record<string, string> }

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
const keysOf = (s: KV) => Array.from({ length: s.length }, (_, i) => s.key(i)).filter((k): k is string => !!k);

export function makeBackup(storage: KV, company: Company, now: Date): Backup {
  const prefix = storePrefix(company.id);
  const data: Record<string, string> = {};
  // who is signed in on this device is not company data, so it is not carried to another device
  for (const k of keysOf(storage)) if (k.startsWith(prefix) && k !== meKey(company.id)) data[k] = storage.getItem(k) ?? '';
  return { app: 'st-hr', version: 1, exportedAt: now.toISOString(), company, data };
}

/** Why a file cannot be restored, or null. Every stored key must belong to the company in the file, so a file can never touch another company. */
export function backupProblem(x: unknown): string | null {
  const b = x as Partial<Backup> | null;
  if (!b || typeof b !== 'object' || b.app !== 'st-hr') return 'ບໍ່ແມ່ນໄຟລ໌ສຳຮອງຂອງ ST HR';
  if (b.version !== 1) return 'ໄຟລ໌ສຳຮອງລຸ້ນນີ້ ລະບົບຍັງບໍ່ຮູ້ຈັກ';
  if (!b.company?.id || !b.company?.name) return 'ໄຟລ໌ບໍ່ຄົບ: ບໍ່ມີຂໍ້ມູນບໍລິສັດ';
  if (!b.data || typeof b.data !== 'object') return 'ໄຟລ໌ບໍ່ຄົບ: ບໍ່ມີຂໍ້ມູນ';
  const prefix = storePrefix(b.company.id);
  const keys = Object.keys(b.data);
  if (!keys.length) return 'ໄຟລ໌ສຳຮອງວ່າງເປົ່າ';
  if (keys.some(k => !k.startsWith(prefix))) return 'ໄຟລ໌ມີຂໍ້ມູນຂອງບໍລິສັດອື່ນປົນ — ບໍ່ກູ້ຄືນ';
  if (Object.values(b.data).some(v => typeof v !== 'string')) return 'ໄຟລ໌ເສຍຫາຍ';
  return null;
}

/** Replace this company's stored data with the file's. Other companies are not touched. */
export function restoreBackup(storage: KV, b: Backup, saveCompany: (c: Company) => void): number {
  const problem = backupProblem(b);
  if (problem) throw new Error(problem);
  const prefix = storePrefix(b.company.id);
  for (const k of keysOf(storage)) if (k.startsWith(prefix) && k !== meKey(b.company.id)) storage.removeItem(k);
  const entries = Object.entries(b.data);
  for (const [k, v] of entries) storage.setItem(k, v);
  saveCompany(b.company);
  return entries.length;
}

export const backupFileName = (company: Pick<Company, 'name'>, now: Date) =>
  `ST-HR_ສຳຮອງ_${company.name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()}_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.json`;
