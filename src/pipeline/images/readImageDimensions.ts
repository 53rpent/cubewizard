import { sniffImageFormat } from "./sniff";
import type { ImageFormatHint } from "./types";

function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1] ?? 0;
    const len = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
    if (marker >= 0xc0 && marker <= 0xc3) {
      const height = ((bytes[i + 5] ?? 0) << 8) | (bytes[i + 6] ?? 0);
      const width = ((bytes[i + 7] ?? 0) << 8) | (bytes[i + 8] ?? 0);
      return { width, height };
    }
    i += 2 + len;
  }
  return null;
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const width = ((bytes[16] ?? 0) << 24) | ((bytes[17] ?? 0) << 16) | ((bytes[18] ?? 0) << 8) | (bytes[19] ?? 0);
  const height = ((bytes[20] ?? 0) << 24) | ((bytes[21] ?? 0) << 16) | ((bytes[22] ?? 0) << 8) | (bytes[23] ?? 0);
  return { width, height };
}

function isRiffWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  if (bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46) return false;
  return bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}

function readVp8LossyDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30) return null;
  if (bytes[12] !== 0x56 || bytes[13] !== 0x50 || bytes[14] !== 0x38 || bytes[15] !== 0x20) return null;
  const w = (bytes[26] ?? 0) | ((bytes[27] ?? 0) << 8);
  const h = (bytes[28] ?? 0) | ((bytes[29] ?? 0) << 8);
  const width = w & 0x3fff;
  const height = h & 0x3fff;
  return width > 0 && height > 0 ? { width, height } : null;
}

function readVp8LosslessDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 25) return null;
  if (bytes[12] !== 0x56 || bytes[13] !== 0x50 || bytes[14] !== 0x38 || bytes[15] !== 0x4c) return null;
  const bits = (bytes[21] ?? 0) | ((bytes[22] ?? 0) << 8) | ((bytes[23] ?? 0) << 16) | ((bytes[24] ?? 0) << 24);
  const width = (bits & 0x3fff) + 1;
  const height = ((bits >> 14) & 0x3fff) + 1;
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Lossy WebP (VP8): width/height in 14-bit fields after frame tag. */
function readWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (!isRiffWebp(bytes)) return null;
  return readVp8LossyDimensions(bytes) ?? readVp8LosslessDimensions(bytes);
}

/** Read pixel dimensions from JPEG/PNG headers without full decode. */
export function readImageDimensions(
  bytes: Uint8Array,
  hint?: ImageFormatHint,
): { width: number; height: number; format: ImageFormatHint } {
  const format = hint && hint !== "unknown" ? hint : sniffImageFormat(bytes);
  if (format === "jpeg") {
    const dims = readJpegDimensions(bytes);
    if (!dims) throw new Error("jpeg_dimensions_unavailable");
    return { ...dims, format };
  }
  if (format === "png") {
    const dims = readPngDimensions(bytes);
    if (!dims) throw new Error("png_dimensions_unavailable");
    return { ...dims, format };
  }
  if (format === "webp") {
    const dims = readWebpDimensions(bytes);
    if (!dims) throw new Error("webp_dimensions_unavailable");
    return { ...dims, format };
  }
  throw new Error(`image_dimensions_unsupported_format:${format}`);
}
