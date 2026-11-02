import type { Branch, Settings } from './types';

/** Great-circle distance in metres (haversine). */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Nearest branch and the distance to it; the employee may clock in at any branch. */
export function nearestBranch(lat: number, lng: number, branches: Branch[]): { branch: Branch; distanceM: number } | null {
  let best: { branch: Branch; distanceM: number } | null = null;
  for (const b of branches) {
    const d = distanceMeters(lat, lng, b.lat, b.lng);
    if (!best || d < best.distanceM) best = { branch: b, distanceM: d };
  }
  return best;
}

export const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Minutes late beyond the grace period; 0 when on time. Graced minutes are not forgiven once exceeded. */
export function lateMinutes(shiftStart: string, clockIn: Date, graceMinutes: number): number {
  const late = clockIn.getHours() * 60 + clockIn.getMinutes() - minutesOf(shiftStart);
  return late > graceMinutes ? late : 0;
}

export function workedMinutes(inAt: Date, outAt: Date): number {
  return Math.max(0, Math.round((outAt.getTime() - inAt.getTime()) / 60000));
}

export interface ScanInput {
  gps?: { lat: number; lng: number } | null;
  faceScore?: number | null; // null = face not found
  deviceTime: Date;
  serverTime: Date;
}

export interface ScanVerdict {
  ok: boolean;
  reasons: string[];
  branchId?: string;
  distanceM?: number;
}

/**
 * Decide whether a scan is accepted or goes to the head's review queue.
 * A failed check never blocks the scan: the time is always saved, just as "pending".
 */
export function evaluateScan(input: ScanInput, branches: Branch[], s: Settings): ScanVerdict {
  const reasons: string[] = [];
  let branchId: string | undefined;
  let distanceM: number | undefined;

  if (input.faceScore == null) reasons.push('ບໍ່ພົບໃບໜ້າ');
  else if (input.faceScore < s.faceMinScore) reasons.push(`ໜ້າກົງກັນຕ່ຳ ${Math.round(input.faceScore)}%`);

  if (!input.gps) reasons.push('ບໍ່ມີ GPS');
  else {
    const near = nearestBranch(input.gps.lat, input.gps.lng, branches);
    if (near) {
      branchId = near.branch.id;
      distanceM = Math.round(near.distanceM);
      if (near.distanceM > near.branch.radiusM) reasons.push(`ຢູ່ໄກຮ້ານ ${distanceM} ມ.`);
    } else reasons.push('ບໍ່ມີສາຂາໃນລະບົບ');
  }

  const skew = Math.abs(input.serverTime.getTime() - input.deviceTime.getTime()) / 60000;
  if (skew > s.maxClockSkewMin) reasons.push(`ໂມງໂທລະສັບຕ່າງ ${Math.round(skew)} ນທ`);

  return { ok: reasons.length === 0, reasons, branchId, distanceM };
}

/** Pick `n` distinct items with a seeded PRNG so the daily sample is reproducible for auditors. */
export function dailySample<T>(items: T[], n: number, seed: string): T[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rand = () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pool = [...items];
  const out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}
