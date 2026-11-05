import { ACTIONS, PAGES, SCOPE_RIGHTS, pageRight, type Action, type ManagerPage, type RightKey, type ScopeRight } from '../domain/rights';

/** The back-office pages, as named in the menu. */
export const PAGE_LABEL: Record<ManagerPage, string> = {
  overview: 'ພາບລວມ', review: 'ກວດການລົງເວລາ', approvals: 'ອະນຸມັດຄຳຂໍ', time: 'ລົງເວລາມື້ນີ້', reports: 'ລາຍງານທີມ', map: 'ແຜນທີ່',
  leave: 'ລາພັກ & ເບີກ', staff: 'ພະນັກງານ', pay: 'ເງິນເດືອນ', access: 'ສິດ & ການອະນຸມັດ', settings: 'ກົດເກນ & ຕັ້ງຄ່າ', audit: 'ບັນທຶກການແກ້ໄຂ', records: 'ຈັດການຂໍ້ມູນ'
};

const ACTION_LABEL: Record<Action, string> = {
  'scan.review': 'ກວດການສະແກນທີ່ລໍກວດ',
  'ot.preapprove': 'ອະນຸມັດ OT ລ່ວງໜ້າ',
  'advance.decide': 'ອະນຸມັດເບີກເງິນລ່ວງໜ້າ',
  'staff.edit': 'ເພີ່ມ / ແກ້ໄຂພະນັກງານ',
  'staff.change.decide': 'ອະນຸມັດການປ່ຽນເງິນເດືອນ / ເລກບັນຊີ',
  'payroll.prepare': 'ຄິດເງິນເດືອນ',
  'payroll.lock': 'ປິດງວດເງິນເດືອນ',
  'payroll.confirmLate': 'ຢືນຢັນຫັກມາຊ້າ',
  'payroll.items': 'ເພີ່ມລາຍການເງິນເດືອນ (ໂບນັດ / ຫັກ)',
  'payroll.items.decide': 'ອະນຸມັດລາຍການເງິນເດືອນ',
  'settings.edit': 'ແກ້ກົດເກນ ແລະ ຕັ້ງຄ່າ'
};

const SCOPE_LABEL: Record<ScopeRight, string> = {
  dataAll: 'ເບິ່ງຂໍ້ມູນຂອງທຸກຄົນ',
  dataDept: 'ເບິ່ງຂໍ້ມູນພະແນກທີ່ດູແລ',
  writeAll: 'ແກ້ຂໍ້ມູນຂອງທຸກຄົນ',
  userMng: 'ຈັດການບັນຊີເຂົ້າລະບົບ ແລະ ສິດ',
  override: 'ໃສ່ PIN ອະນຸມັດແທນ'
};

export const RIGHT_LABEL = (k: RightKey): string => (k.startsWith('p.') ? 'ເປີດໜ້າ: ' + PAGE_LABEL[k.slice(2) as ManagerPage] : k in SCOPE_LABEL ? SCOPE_LABEL[k as ScopeRight] : ACTION_LABEL[k as Action]);

/** The tick boxes in the order people read them: pages, then what they may do, then how far the data reaches. */
export const RIGHT_GROUPS: { title: string; keys: RightKey[] }[] = [
  { title: 'ໜ້າທີ່ເຂົ້າໄດ້', keys: PAGES.map(pageRight) },
  { title: 'ເຮັດຫຍັງໄດ້', keys: ACTIONS },
  { title: 'ຂອບເຂດຂໍ້ມູນ ແລະ ການຈັດການ', keys: SCOPE_RIGHTS }
];
