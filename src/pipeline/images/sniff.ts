import type { ImageFormatHint } from "./types";

/**
 * Magic-byte sniff for deck uploads (staging `image.*` and URL downloads).
 * HEIC: ISO BMFF `ftyp` + brand (heic, heix, mif1, msf1, hevc, …).
 */
export function sniffImageFormat(bytes: Uint8Array): ImageFormatHint {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  const b4 = String.fromCharCode(
    bytes[4],
    bytes[5],
    bytes[6],
    bytes[7]
  );
  if (b4 === "ftyp" && bytes.length >= 12) {
    const brand = String.fromCharCode(
      bytes[8],
      bytes[9],
      bytes[10],
      bytes[11]
    );
    const heicBrands = new Set([
      "heic",
      "heix",
      "hevc",
      "hevx",
      "mif1",
      "msf1",
      "avif",
    ]);
    if (heicBrands.has(brand)) return "heic";
  }
  return "unknown";
}
