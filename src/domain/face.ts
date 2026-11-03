import type { Employee } from './types';

/** Face templates: one averaged descriptor per head pose. The front one lives in `faceEnrolled`, the side ones in `facePoses`. */
export type PoseId = 'front' | 'left' | 'right';
export const POSES: { id: PoseId; label: string; hint: string }[] = [
  { id: 'front', label: 'ມອງຕົງ', hint: 'ມອງຕົງໃສ່ກ້ອງ' },
  { id: 'left', label: 'ຫັນຊ້າຍ', hint: 'ຄ່ອຍໆຫັນໜ້າໄປທາງຊ້າຍ ເລັກນ້ອຍ' },
  { id: 'right', label: 'ຫັນຂວາ', hint: 'ຄ່ອຍໆຫັນໜ້າໄປທາງຂວາ ເລັກນ້ອຍ' }
];
export const SAMPLES_PER_POSE = 2;

/** Head turn limits, as a share of the jaw width (0 = facing the camera). */
export const FRONT_MAX_YAW = 0.2;
export const SIDE_MIN_YAW = 0.25; // straight-on faces measure up to ~0.19 on real photos, so a side pose has to be clearly beyond that
export const SIDE_MAX_YAW = 0.45;

/**
 * How far the nose sits off the middle of the jaw, from the 68 face landmarks (jaw ends are points 0 and 16, nose tip is 30).
 * Measured in the raw camera image: the sign only says which way, so the pose check never relies on it being "left" or "right".
 */
export function yawOf(points: { x: number }[]): number {
  const left = points[0].x, right = points[16].x, nose = points[30].x;
  const width = right - left;
  return width === 0 ? 0 : (nose - (left + right) / 2) / width;
}

/**
 * Whether a frame with this head turn counts for the pose. The person picks which way "left" goes (a mirrored preview confuses everyone),
 * so the first side pose takes either direction and the second must be the opposite one.
 */
export function poseOk(pose: PoseId, yaw: number, firstSideYaw?: number): boolean {
  if (pose === 'front') return Math.abs(yaw) <= FRONT_MAX_YAW;
  if (Math.abs(yaw) < SIDE_MIN_YAW || Math.abs(yaw) > SIDE_MAX_YAW) return false;
  return pose === 'left' || firstSideYaw === undefined || Math.sign(yaw) !== Math.sign(firstSideYaw);
}

export function averageDescriptors(list: number[][]): number[] {
  return list[0].map((_, i) => list.reduce((a, d) => a + d[i], 0) / list.length);
}

/**
 * Euclidean distance → 0..100 score. Distance 0.3 or less = 100, 0.54 ≈ 70 (default pass mark),
 * 0.6 (face-api's usual "same person" limit) ≈ 62.
 */
export function matchScore(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  const d = Math.sqrt(sum);
  return Math.max(0, Math.min(100, Math.round((100 * (1.1 - d)) / 0.8)));
}

type FaceOwner = Pick<Employee, 'faceEnrolled' | 'facePoses' | 'faceReenroll'>;

export const faceTemplates = (e: Pick<Employee, 'faceEnrolled' | 'facePoses'>): number[][] => (e.faceEnrolled ? [e.faceEnrolled, ...(e.facePoses ?? [])] : []);

/** Best match of a fresh face against every pose on file; null when nothing is enrolled. */
export function bestFaceScore(descriptor: number[], e: Pick<Employee, 'faceEnrolled' | 'facePoses'>): number | null {
  const all = faceTemplates(e);
  return all.length ? Math.max(...all.map(t => matchScore(descriptor, t))) : null;
}

/** Face has to be (re)taken at the next clock-in: never enrolled, or a re-enrolment was approved. */
export const needsEnroll = (e: FaceOwner) => !e.faceEnrolled || !!e.faceReenroll;

/** Why someone cannot ask to re-enrol their face now, or null. */
export function faceResetBlock(e: FaceOwner): string | null {
  if (!e.faceEnrolled) return 'ຍັງບໍ່ໄດ້ລົງທະບຽນໃບໜ້າ — ຈະຖືກຖາມຕອນກົດເຂົ້າວຽກ ບໍ່ຕ້ອງຂໍ';
  if (e.faceReenroll) return 'ໄດ້ຮັບອະນຸມັດແລ້ວ — ກົດເຂົ້າວຽກເພື່ອຖ່າຍໃບໜ້າໃໝ່';
  return null;
}
