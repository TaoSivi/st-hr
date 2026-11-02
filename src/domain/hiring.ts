import type { Branch, Employee, Shift } from './types';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date in YYYY-MM-DD. Compared by local parts: going through toISOString would shift the day in any timezone east of UTC. */
const validDate = (d: string) => {
  if (!DATE.test(d)) return false;
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(y, m - 1, day);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === day;
};

/** Employed on that date: on or after the start date and, if there is one, on or before the end date. */
export const isActiveOn = (e: Pick<Employee, 'startDate' | 'endDate'>, date: string) => date >= e.startDate && (!e.endDate || date <= e.endDate);

/** Share of a calendar month an employee was employed (1 = the whole month, 0 = not at all). Used to pro-rate pay. */
export function employedFraction(e: Pick<Employee, 'startDate' | 'endDate'>, year: number, month: number): number {
  const days = new Date(year, month + 1, 0).getDate();
  const first = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const last = `${year}-${String(month + 1).padStart(2, '0')}-${String(days).padStart(2, '0')}`;
  const from = e.startDate > first ? e.startDate : first;
  const to = e.endDate && e.endDate < last ? e.endDate : last;
  if (from > to) return 0;
  const n = Math.round((new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / 86400000) + 1;
  return n / days;
}

/** Next free ST-### code. */
export function nextEmployeeCode(existing: Pick<Employee, 'code'>[], prefix = 'ST-'): string {
  const top = existing.reduce((m, e) => Math.max(m, e.code.startsWith(prefix) ? parseInt(e.code.slice(prefix.length), 10) || 0 : 0), 0);
  return prefix + String(top + 1).padStart(3, '0');
}

/** Everything wrong with a new employee record, in Lao. New hires always start with the plain employee role: roles are granted separately by the owner. */
export function validateNewEmployee(e: Employee, existing: Employee[], shifts: Shift[], branches: Branch[]): string[] {
  const err: string[] = [];
  if (!e.name?.trim()) err.push('ຕ້ອງໃສ່ຊື່');
  if (!e.code?.trim()) err.push('ຕ້ອງມີລະຫັດ');
  else if (existing.some(x => x.code.toLowerCase() === e.code.trim().toLowerCase())) err.push(`ລະຫັດ ${e.code} ຊ້ຳກັບຄົນອື່ນ`);
  if (existing.some(x => x.name.trim() === e.name.trim() && x.dept === e.dept && !x.endDate)) err.push('ມີພະນັກງານຊື່ ແລະ ພະແນກດຽວກັນຢູ່ແລ້ວ (ກັນການໃສ່ຊ້ຳ)');
  if (!e.dept?.trim()) err.push('ຕ້ອງໃສ່ພະແນກ');
  if (!e.position?.trim()) err.push('ຕ້ອງໃສ່ຕຳແໜ່ງ');
  if (!validDate(e.startDate)) err.push('ວັນເລີ່ມວຽກບໍ່ຖືກຕ້ອງ');
  if (!Number.isFinite(e.baseSalary) || e.baseSalary <= 0) err.push('ເງິນເດືອນພື້ນຖານຕ້ອງຫຼາຍກວ່າ 0');
  if (!Number.isFinite(e.allowance) || e.allowance < 0) err.push('ເບ້ຍລ້ຽງຕ້ອງບໍ່ຕິດລົບ');
  if (!shifts.some(s => s.id === e.shiftId)) err.push('ເລືອກກະທີ່ມີຢູ່ໃນລະບົບ');
  if (!branches.some(b => b.id === e.homeBranchId)) err.push('ເລືອກສາຂາຫຼັກ');
  if (e.payMethod === 'bank' && (!e.bankName?.trim() || !e.bankAccount?.trim())) err.push('ຮັບເງິນໂອນ ຕ້ອງໃສ່ທະນາຄານ ແລະ ເລກບັນຊີ');
  if (e.roles.length !== 1 || e.roles[0] !== 'employee') err.push('ພະນັກງານໃໝ່ເລີ່ມດ້ວຍບົດບາດພະນັກງານເທົ່ານັ້ນ');
  return err;
}

/** Why someone cannot be closed out (resigned / dismissed), or null. */
export function terminationBlock(target: Employee, employees: Employee[], endDate: string, actorId: string): string | null {
  if (!validDate(endDate)) return 'ວັນສິ້ນສຸດບໍ່ຖືກຕ້ອງ';
  if (endDate < target.startDate) return 'ວັນສິ້ນສຸດຕ້ອງບໍ່ກ່ອນວັນເລີ່ມວຽກ';
  if (target.endDate) return 'ພະນັກງານຄົນນີ້ຖືກປິດແລ້ວ';
  if (target.id === actorId) return 'ປິດບັນຊີຂອງຕົນເອງບໍ່ໄດ້';
  const owners = employees.filter(e => e.roles.includes('owner') && !e.endDate).length;
  if (target.roles.includes('owner') && owners <= 1) return 'ຕ້ອງມີເຈົ້າຂອງຢ່າງໜ້ອຍ 1 ຄົນ';
  return null;
}
