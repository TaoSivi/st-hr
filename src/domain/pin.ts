/**
 * Signing in with employee code + PIN. The PIN is kept only as a salted SHA-256 hash.
 * On a shared shop device this stops one person from opening another person's account; it is not bank-grade security
 * (the data itself sits in the browser), and the face scan still checks who is clocking in.
 */
export const PIN_MIN = 4;
export const PIN_MAX = 6;
export const MAX_FAILS = 5;
export const LOCK_MINUTES = 5;
/** On a shared device the session ends by itself after this long without a touch. */
export const IDLE_LOGOUT_MIN = 3;

/** On the online system a PIN is the account password, typed on a number pad like ST POS: exactly 4 digits. It can be tried over the internet, so 5 wrong tries lock the account for 5 minutes (on the server). */
export const ONLINE_PIN_LEN = 4;

/** Why a PIN cannot be used, or null. `online` asks for exactly 6 digits. */
export function pinProblem(pin: string, online = false): string | null {
  if (!/^\d+$/.test(pin)) return 'PIN ຕ້ອງເປັນຕົວເລກເທົ່ານັ້ນ';
  if (online && pin.length !== ONLINE_PIN_LEN) return `PIN ຕ້ອງມີ ${ONLINE_PIN_LEN} ຕົວເລກ`;
  if (pin.length < PIN_MIN || pin.length > PIN_MAX) return `PIN ຕ້ອງມີ ${PIN_MIN}–${PIN_MAX} ຕົວເລກ`;
  if (/^(\d)\1+$/.test(pin)) return 'PIN ເປັນເລກດຽວກັນໝົດ ເດົາງ່າຍເກີນໄປ';
  const up = '0123456789', down = '9876543210';
  if (up.includes(pin) || down.includes(pin)) return 'PIN ເປັນເລກລຽງກັນ ເດົາງ່າຍເກີນໄປ';
  return null;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

export async function hashPin(pin: string, salt: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`)));
}

export function newSalt(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return hex(a.buffer);
}

/** The fields to store on the employee for a new PIN. `mustChange` is set for a PIN someone else chose (a reset). */
export async function pinFields(pin: string, mustChange: boolean): Promise<{ pinHash: string; pinSalt: string; pinMustChange?: boolean }> {
  const pinSalt = newSalt();
  return { pinHash: await hashPin(pin, pinSalt), pinSalt, ...(mustChange ? { pinMustChange: true } : { pinMustChange: undefined }) };
}

export async function pinMatches(e: { pinHash?: string; pinSalt?: string }, pin: string): Promise<boolean> {
  if (!e.pinHash || !e.pinSalt) return false;
  return (await hashPin(pin, e.pinSalt)) === e.pinHash;
}

/** A random temporary PIN for a reset: 6 digits (the online system takes exactly ONLINE_PIN_LEN) that pass the checks above. */
export function tempPin(len = 6): string {
  for (;;) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    const p = String(a[0] % 10 ** len).padStart(len, '0');
    if (!pinProblem(p)) return p;
  }
}

/** Failed attempts per account on this device: after MAX_FAILS wrong PINs the account waits LOCK_MINUTES. */
export interface LockState { fails: number; until?: number }

export function afterFail(s: LockState | undefined, now: number): LockState {
  const fails = (s?.until && s.until <= now ? 0 : s?.fails ?? 0) + 1;
  return fails >= MAX_FAILS ? { fails, until: now + LOCK_MINUTES * 60_000 } : { fails };
}

/** Minutes left on a lock, or 0 when the account may try again. */
export function lockedMinutes(s: LockState | undefined, now: number): number {
  return s?.until && s.until > now ? Math.ceil((s.until - now) / 60_000) : 0;
}
