import type { Branch, Employee, LeaveRequest, Shift } from '../domain/types';
import { defaultSettings } from '../domain/defaults';
import type { LocalStore } from './store';

export const COMPANY = 'demo-co';

// Sample people and numbers for the demo only.
export const shifts: Shift[] = [
  { id: 'morning', name: 'ກະເຊົ້າ', start: '06:00', end: '14:00', breakStart: '10:00', breakEnd: '10:30' },
  { id: 'evening', name: 'ກະແລງ', start: '14:00', end: '22:00', breakStart: '18:00', breakEnd: '18:30' }
];

export const branches: Branch[] = [
  { id: 'b-front', companyId: COMPANY, name: 'ສາຂາໜ້າຮ້ານ', lat: 17.9757, lng: 102.6331, radiusM: 100 },
  { id: 'b-store', companyId: COMPANY, name: 'ສາງກາງ', lat: 17.9631, lng: 102.6142, radiusM: 100 }
];

const emp = (id: string, code: string, name: string, dept: string, position: string, roles: Employee['roles'], shiftId: string,
  startDate: string, baseSalary: number, allowance: number, payMethod: Employee['payMethod'], bankName?: string): Employee => ({
  id, companyId: COMPANY, code, name, dept, position, roles, homeBranchId: 'b-front', shiftId, startDate, baseSalary, allowance,
  payMethod, bankName, bankAccount: bankName ? '[ເລກບັນຊີ]' : undefined
});

export const employees: Employee[] = [
  emp('e-owner', 'ST-001', 'Admin', 'ບໍລິຫານ', 'ເຈົ້າຂອງຮ້ານ', ['owner', 'employee'], 'morning', '2020-01-01', 0, 0, 'bank', 'LDB'),
  emp('e-acc', 'ST-002', 'ແສງດາວ ພົມມະວົງ', 'ບໍລິຫານ', 'ບັນຊີ', ['accountant', 'employee'], 'morning', '2021-03-01', 5_000_000, 300_000, 'bank', 'JDB'),
  emp('e-head', 'ST-003', 'ສົມພອນ ແກ້ວມະນີ', 'ບໍລິຫານ', 'ຜູ້ຈັດການຮ້ານ', ['head', 'employee'], 'morning', '2021-03-01', 8_500_000, 500_000, 'bank', 'LDB'),
  emp('e-noy', 'ST-007', 'ນ້ອຍ ວົງສາ', 'ເສີບ', 'ຫົວໜ້າພະນັກງານເສີບ', ['head', 'employee'], 'evening', '2022-06-15', 4_800_000, 300_000, 'bank', 'ST Bank'),
  emp('e-kl', 'ST-012', 'ຄຳຫຼ້າ ອິນທະວົງ', 'ຄົວ', 'ພໍ່ຄົວໃຫຍ່', ['employee'], 'morning', '2022-01-02', 6_240_000, 300_000, 'bank', 'LDB'),
  emp('e-bm', 'ST-015', 'ບຸນມີ ສີສຸວັນ', 'ຄົວ', 'ຜູ້ຊ່ວຍພໍ່ຄົວ', ['employee'], 'morning', '2023-09-10', 3_600_000, 200_000, 'cash'),
  emp('e-wn', 'ST-021', 'ວັນນາ ສຸລິຍະ', 'ເສີບ', 'ພະນັກງານເສີບ', ['employee'], 'evening', '2024-05-05', 3_200_000, 200_000, 'bank', 'JDB'),
  emp('e-al', 'ST-024', 'ອາລຸນີ ດວງດີ', 'ແຄຊເຊຍ', 'ແຄຊເຊຍ', ['employee'], 'morning', '2024-07-12', 3_500_000, 200_000, 'cash'),
  emp('e-mn', 'ST-038', 'ມະນີວອນ ແສງທອງ', 'ບາ', 'ບາຣິສຕ້າ', ['employee'], 'evening', '2026-09-01', 3_000_000, 0, 'bank', 'ST Bank')
];

const leaves: LeaveRequest[] = [
  { id: 'lv-1', companyId: COMPANY, employeeId: 'e-wn', type: 'personal', from: '2026-11-07', to: '2026-11-07', days: 1,
    reason: 'ຕິດຕໍ່ເອກະສານຢູ່ຫ້ອງການເມືອງ', createdAt: new Date(Date.now() - 3 * 3600000).toISOString(), approvals: [], status: 'pending' },
  { id: 'lv-2', companyId: COMPANY, employeeId: 'e-bm', type: 'sick', from: '2026-11-03', to: '2026-11-03', days: 1,
    reason: 'ໄປໂຮງໝໍກວດຕາມນັດ', createdAt: new Date(Date.now() - 30 * 3600000).toISOString(), approvals: [], status: 'pending' }
];

export async function seed(store: LocalStore) {
  if (store.isSeeded()) return;
  const by = 'system';
  for (const b of branches) await store.put('branches', b, by, 'seed');
  for (const e of employees) await store.put('employees', e, by, 'seed');
  for (const l of leaves) await store.put('leaves', l, by, 'seed');
  await store.put('settings', { id: COMPANY, ...defaultSettings(COMPANY) }, by, 'seed');
  store.markSeeded();
}
