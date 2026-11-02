/** Text of the review reason for a scan made on a phone other than the one bound to the account. The prefix is what the rest of the code matches on. */
export const DEVICE_REASON = 'ເຄື່ອງໃໝ່ (ບໍ່ແມ່ນເຄື່ອງທີ່ຜູກໄວ້ກັບບັນຊີນີ້)';
export const isDeviceReason = (r: string) => r.startsWith('ເຄື່ອງໃໝ່');

export interface DeviceVerdict { ok: boolean; bind: boolean; reason?: string }

/**
 * An account is bound to one phone. The first phone used binds itself; after that a scan from any other phone is not refused
 * (the time is still saved) but goes to the head's review queue, so a colleague signing in on their own phone cannot clock someone else in unseen.
 */
export function deviceVerdict(bound: string | undefined, current: string): DeviceVerdict {
  if (!current) return { ok: false, bind: false, reason: DEVICE_REASON };
  if (!bound) return { ok: true, bind: true };
  return bound === current ? { ok: true, bind: false } : { ok: false, bind: false, reason: DEVICE_REASON };
}

/** Why a phone cannot be requested as the new bound phone, or null. */
export function deviceChangeBlock(bound: string | undefined, requested: string): string | null {
  if (!requested) return 'ອ່ານລະຫັດເຄື່ອງບໍ່ໄດ້';
  if (bound === requested) return 'ເຄື່ອງນີ້ຖືກຜູກໄວ້ກັບບັນຊີນີ້ແລ້ວ';
  return null;
}
