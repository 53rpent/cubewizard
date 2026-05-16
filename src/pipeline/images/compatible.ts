import { decodeToRgba } from "./decode";
import { encodeJpeg, encodePng, frameHasTransparency } from "./encode";
import { sniffImageFormat } from "./sniff";
import type { ImageFormatHint, RgbaFrame } from "./types";

export type VisionRasterMime = "image/jpeg" | "image/png";

export interface VisionRasterBytes {
  bytes: Uint8Array;
  mime: VisionRasterMime;
}

const DEFAULT_JPEG_QUALITY = 95;

/**
 * After decode: choose PNG if transparency else JPEG (mirrors Pillow branch in
 * `ImageProcessor._convert_to_compatible_format`).
 */
export function rasterToOpenAiCompatible(
  frame: RgbaFrame,
  jpegQuality: number = DEFAULT_JPEG_QUALITY
): VisionRasterBytes {
  if (frameHasTransparency(frame)) {
    return { bytes: encodePng(frame), mime: "image/png" };
  }
  return { bytes: encodeJpeg(frame, jpegQuality), mime: "image/jpeg" };
}

/**
 * Full path from raw upload bytes: pass through JPEG/PNG; decode+re-encode WebP/HEIC/etc.
 * Matches "already jpg/png → return as-is" from Python (no extra loss).
 */
export async function prepareBytesForOpenAiVision(
  bytes: Uint8Array,
  hint?: ImageFormatHint,
  jpegQuality: number = DEFAULT_JPEG_QUALITY
): Promise<VisionRasterBytes> {
  const fmt =
    hint && hint !== "unknown" ? hint : sniffImageFormat(bytes);
  if (fmt === "jpeg") {
    return { bytes: new Uint8Array(bytes), mime: "image/jpeg" };
  }
  if (fmt === "png") {
    return { bytes: new Uint8Array(bytes), mime: "image/png" };
  }
  const frame = await decodeToRgba(bytes, fmt);
  return rasterToOpenAiCompatible(frame, jpegQuality);
}
