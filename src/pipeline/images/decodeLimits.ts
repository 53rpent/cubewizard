export const DEFAULT_MAX_DECODE_PIXELS = 3072 * 3072;
export const MAX_RGBA_BYTES = 100 * 1024 * 1024;

/**
 * Reject image dimensions that would exceed Worker memory budget.
 * When `maxPixels` is set, also caps total pixel count (for callers that downscale immediately).
 */
export function assertDecodeBudget(width: number, height: number, maxPixels?: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("invalid_dimensions");
  }
  const pixels = width * height;
  if (maxPixels != null && pixels > maxPixels) {
    throw new Error(`dimensions_exceed_max_pixels:${width}x${height}`);
  }
  const rgbaBytes = pixels * 4;
  if (rgbaBytes > MAX_RGBA_BYTES) {
    throw new Error(`rgba_budget_exceeded:${rgbaBytes}`);
  }
}
