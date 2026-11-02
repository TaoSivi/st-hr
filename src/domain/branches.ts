import type { Branch } from './types';

/** Everything wrong with a branch record, in Lao. A branch's GPS point and radius decide whether a scan counts, so a bad one silently breaks clock-in. */
export function validateBranch(b: Pick<Branch, 'id' | 'name' | 'lat' | 'lng' | 'radiusM'>, existing: Pick<Branch, 'id' | 'name'>[]): string[] {
  const err: string[] = [];
  const name = b.name?.trim() ?? '';
  if (!name) err.push('ຕ້ອງໃສ່ຊື່ສາຂາ');
  else if (existing.some(x => x.id !== b.id && x.name.trim().toLowerCase() === name.toLowerCase())) err.push(`ມີສາຂາຊື່ "${name}" ແລ້ວ`);
  if (!Number.isFinite(b.lat) || b.lat < -90 || b.lat > 90) err.push('ລະຕິຈູດຕ້ອງຢູ່ລະຫວ່າງ -90 ຫາ 90');
  if (!Number.isFinite(b.lng) || b.lng < -180 || b.lng > 180) err.push('ລອງຈິຈູດຕ້ອງຢູ່ລະຫວ່າງ -180 ຫາ 180');
  // (0, 0) is what an empty or failed GPS read looks like; no real shop is in the Atlantic Ocean
  else if (b.lat === 0 && b.lng === 0) err.push('ຕຳແໜ່ງ 0,0 ບໍ່ຖືກຕ້ອງ (ອ່ານ GPS ບໍ່ສຳເລັດ?)');
  if (!Number.isInteger(b.radiusM) || b.radiusM < 10 || b.radiusM > 2000) err.push('ລັດສະໝີຕ້ອງເປັນເລກເຕັມ 10–2000 ແມັດ');
  return err;
}
