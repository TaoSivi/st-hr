export const money = (n: number) => Math.round(n).toLocaleString('en-US');
export const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const sameDay = (iso: string, d: Date) => ymd(new Date(iso)) === ymd(d);
export const initials = (name: string) => name.split(' ').map(w => w[0]).join('').slice(0, 2);

const DAYS = ['ອາທິດ', 'ຈັນ', 'ອັງຄານ', 'ພຸດ', 'ພະຫັດ', 'ສຸກ', 'ເສົາ'];
const MONTHS = ['ມັງກອນ', 'ກຸມພາ', 'ມີນາ', 'ເມສາ', 'ພຶດສະພາ', 'ມິຖຸນາ', 'ກໍລະກົດ', 'ສິງຫາ', 'ກັນຍາ', 'ຕຸລາ', 'ພະຈິກ', 'ທັນວາ'];
export const laoDate = (d: Date) => `ວັນ${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
export const laoMonth = (y: number, m: number) => `${MONTHS[m]} ${y}`;

export const LEAVE_TYPES: Record<string, string> = { annual: 'ລາພັກປະຈຳປີ', sick: 'ລາປ່ວຍ', personal: 'ລາກິດ', unpaid: 'ລາບໍ່ຮັບເງິນເດືອນ' };
export const ROLE_NAMES: Record<string, string> = { employee: 'ພະນັກງານ', head: 'ຫົວໜ້າ', accountant: 'ບັນຊີ', owner: 'ເຈົ້າຂອງ / HR', auditor: 'ຜູ້ກວດສອບ' };

export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** 365 → "1 ປີ", 90 → "90 ມື້": the retention period as Admin set it. */
export const retentionLabel = (days: number) => (days % 365 === 0 ? `${days / 365} ປີ` : `${days} ມື້`);
