import { sniffImageFormat } from "./sniff";
import type { ImageFormatHint } from "./types";

/** Read pixel dimensions from JPEG/PNG headers without full decode. */
export function readImageDimensions(
  bytes: Uint8Array,
  hint?: ImageFormatHint
): { width: number; height: number; format: ImageFormatHint } {
  const format = hint && hint !== "unknown" ? hint : sniffImageFormat(bytes);
  if (format === "jpeg") {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1]!;
      const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
      if (marker >= 0xc0 && marker <= 0xc3) {
        const height = (bytes[i + 5]! << 8) | bytes[i + 6]!;
        const width = (bytes[i + 7]! << 8) | bytes[i + 8]!;
        return { width, height, format };
      }
      i += 2 + len;
    }
    throw new Error("jpeg_dimensions_unavailable");
  }
  if (format === "png" && bytes.length >= 24) {
    const width =
      (bytes[16]! << 24) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!;
    const height =
      (bytes[20]! << 24) | (bytes[21]! << 16) | (bytes[22]! << 8) | bytes[23]!;
    return { width, height, format };
  }
  throw new Error(`image_dimensions_unsupported_format:${format}`);
}
