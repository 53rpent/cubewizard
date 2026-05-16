/** Default max width/height after decode (RGBA bytes ≈ 4 × side²; 2048² ≈ 16 MiB). */
export const EVAL_MAX_IMAGE_SIDE_DEFAULT = 2048;
export const EVAL_MAX_IMAGE_SIDE_CAP = 4096;

/** Smaller raster for orientation OpenAI calls only (full-res kept for extraction/upload). */
export const EVAL_ORIENT_MAX_SIDE_DEFAULT = 1280;
export const EVAL_ORIENT_MAX_SIDE_CAP = 2048;

export function parseEvalMaxImageSide(raw: string | undefined): number {
  const n = parseInt(String(raw ?? String(EVAL_MAX_IMAGE_SIDE_DEFAULT)).trim(), 10);
  if (!Number.isFinite(n) || n < 512) return EVAL_MAX_IMAGE_SIDE_DEFAULT;
  return Math.min(EVAL_MAX_IMAGE_SIDE_CAP, n);
}

export function parseEvalOrientMaxSide(raw: string | undefined): number {
  const n = parseInt(String(raw ?? String(EVAL_ORIENT_MAX_SIDE_DEFAULT)).trim(), 10);
  if (!Number.isFinite(n) || n < 512) return EVAL_ORIENT_MAX_SIDE_DEFAULT;
  return Math.min(EVAL_ORIENT_MAX_SIDE_CAP, n);
}
