/**
 * What is wrong with a camera frame when no face can be found, so the person is told what to fix instead of just "try again".
 * Frames are measured on a small greyscale copy (about 160 px wide) so the numbers do not depend on the phone's camera size.
 */
export interface FrameStats { luma: number; sharpness: number }

/** Mean brightness (0–255) and sharpness (variance of the Laplacian; blurry frames score low) of an RGBA image. */
export function frameStats(rgba: ArrayLike<number>, width: number, height: number): FrameStats {
  const grey = new Float32Array(width * height);
  let sum = 0;
  for (let i = 0; i < grey.length; i++) {
    const g = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    grey[i] = g;
    sum += g;
  }
  let acc = 0, accSq = 0, n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap = 4 * grey[i] - grey[i - 1] - grey[i + 1] - grey[i - width] - grey[i + width];
      acc += lap; accSq += lap * lap; n++;
    }
  }
  const mean = n ? acc / n : 0;
  return { luma: grey.length ? sum / grey.length : 0, sharpness: n ? accSq / n - mean * mean : 0 };
}

/** Below this the frame is brightened before looking for a face. Bright frames are left alone: brightening them made detection worse. */
export const DARK_LUMA = 90;
const TARGET_LUMA = 110;
export const MAX_BOOST = 4;
export const TOO_DARK = 60;
export const TOO_BRIGHT = 200;
export const BLURRY = 40; // sharpness below this: out of focus or smeared
export const FAR_FACE = 0.2; // a face narrower than this share of the frame is too far away

/** The brightness multiplier that brings a dark frame to normal (1 = leave it). */
export function exposureBoost(luma: number): number {
  if (!(luma < DARK_LUMA)) return 1;
  return Math.min(MAX_BOOST, TARGET_LUMA / Math.max(luma, 1));
}

export type FrameIssue = 'dark' | 'bright' | 'blur' | 'far' | 'noface';
export const ISSUE_TEXT: Record<FrameIssue, string> = {
  dark: 'ມືດໄປ — ໄປບ່ອນທີ່ແຈ້ງກວ່ານີ້',
  bright: 'ແສງຈ້າ ຫຼື ຍ້ອນແສງ — ຫັນໜ້າຫາແສງ ຢ່າໃຫ້ແສງຢູ່ຫຼັງ',
  blur: 'ພາບເບລອ — ເຊັດເລນກ້ອງ ແລະ ຖືໂທລະສັບໃຫ້ນິ່ງ',
  far: 'ໄກເກີນໄປ — ເຂົ້າໃກ້ກ້ອງອີກ',
  noface: 'ຫາໃບໜ້າບໍ່ເຫັນ — ມອງຕົງໃສ່ກ້ອງ ແລະ ເອົາແວ່ນດຳ / ໝວກ / ຜ້າປິດໜ້າອອກ'
};

/**
 * The most useful thing to tell someone whose frame is not working, or null when the frame itself looks fine.
 * `faceFrac` is the face's width as a share of the frame, or null when no face was found.
 * Order matters: light first, because a dark frame also looks blurry.
 */
export function frameAdvice(stats: FrameStats, faceFrac: number | null): FrameIssue | null {
  if (stats.luma < TOO_DARK) return 'dark';
  if (stats.luma > TOO_BRIGHT) return 'bright';
  if (stats.sharpness < BLURRY) return 'blur';
  if (faceFrac !== null && faceFrac < FAR_FACE) return 'far';
  if (faceFrac === null) return 'noface';
  return null;
}
