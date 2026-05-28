/**
 * Vision raster limits. `0` = use decoded source resolution (no downscale).
 * Set `CW_EVAL_MAX_IMAGE_SIDE` to a positive value only when you must cap memory (e.g. Workers).
 */
export const EVAL_IMAGE_SIDE_UNLIMITED = 0;

/** Default JPEG quality for OpenAI vision + oriented R2 JPEG (jpeg-js scale 1–100). */
export const EVAL_JPEG_QUALITY_DEFAULT = 100;

export function parseEvalJpegQuality(raw: string | undefined): number {
  const n = parseInt(String(raw ?? String(EVAL_JPEG_QUALITY_DEFAULT)).trim(), 10);
  if (!Number.isFinite(n)) return EVAL_JPEG_QUALITY_DEFAULT;
  return Math.min(100, Math.max(60, n));
}

/** @deprecated Use {@link EVAL_IMAGE_SIDE_UNLIMITED} / env unset — no default downscale. */
export const EVAL_MAX_IMAGE_SIDE_DEFAULT = EVAL_IMAGE_SIDE_UNLIMITED;

/** @deprecated Orient uses the same limit as extraction. */
export const EVAL_ORIENT_MAX_SIDE_DEFAULT = EVAL_IMAGE_SIDE_UNLIMITED;

export function parseEvalMaxImageSide(raw: string | undefined): number {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!s || s === "0" || s === "full" || s === "none" || s === "unlimited") {
    return EVAL_IMAGE_SIDE_UNLIMITED;
  }
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 512) return EVAL_IMAGE_SIDE_UNLIMITED;
  return n;
}

/** @deprecated Use {@link parseEvalMaxImageSide} — orientation shares the same limit. */
export function parseEvalOrientMaxSide(raw: string | undefined): number {
  return parseEvalMaxImageSide(raw ?? process.env.CW_EVAL_ORIENT_MAX_SIDE);
}
