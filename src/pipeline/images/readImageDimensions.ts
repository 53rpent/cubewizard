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
  throw new Error(`image_dimensions_unsupported_format:${format}`);
}
