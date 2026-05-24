import jpeg from "jpeg-js";
import UPNG from "upng-js";
import webpDecode from "@jsquash/webp/decode";
import { ensureJsquashWebpDecoderInit } from "./jsquashWebpInit";
import { sniffImageFormat } from "./sniff";
import type { ImageFormatHint, RgbaFrame } from "./types";
import { decodeHeicToRgba } from "./heic";

/** jpeg-js default safety cap (production Workers / untrusted uploads). */
export const JPEG_DECODE_DEFAULT_MAX_MEMORY_MB = 512;

/** Practical “unlimited” for golden / local full-resolution fixtures. */
export const JPEG_DECODE_UNLIMITED_MEMORY_MB = 16_384;

export interface JpegDecodeEnv {
  CW_EVAL_JPEG_DECODE_MAX_MEMORY_MB?: string;
}

/**
 * `CW_EVAL_JPEG_DECODE_MAX_MEMORY_MB`: positive MB cap, or `0` / `unlimited` for no cap.
 * Unset → {@link JPEG_DECODE_DEFAULT_MAX_MEMORY_MB}.
 */
export function parseJpegDecodeMaxMemoryMb(
  env: JpegDecodeEnv = {}
): number {
  const raw =
    env.CW_EVAL_JPEG_DECODE_MAX_MEMORY_MB ??
    (typeof process !== "undefined"
      ? (process as NodeJS.Process).env?.CW_EVAL_JPEG_DECODE_MAX_MEMORY_MB
      : undefined);
  if (raw === undefined || raw === "") {
    return JPEG_DECODE_DEFAULT_MAX_MEMORY_MB;
  }
  if (/^0|unlimited|none|off|false$/i.test(String(raw).trim())) {
    return JPEG_DECODE_UNLIMITED_MEMORY_MB;
  }
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : JPEG_DECODE_DEFAULT_MAX_MEMORY_MB;
}

function ensureRgbaFrame(w: number, h: number, data: Uint8Array): RgbaFrame {
  const n = w * h;
  if (data.length === n * 4) {
    return {
      width: w,
      height: h,
      data: new Uint8ClampedArray(data.buffer, data.byteOffset, n * 4),
    };
  }
  if (data.length === n * 3) {
    const out = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      out[i * 4] = data[i * 3]!;
      out[i * 4 + 1] = data[i * 3 + 1]!;
      out[i * 4 + 2] = data[i * 3 + 2]!;
      out[i * 4 + 3] = 255;
    }
    return { width: w, height: h, data: out };
  }
  throw new Error(`Unexpected decoded byte length ${data.length} for ${w}x${h}`);
}

function decodePngToRgba(bytes: Uint8Array): RgbaFrame {
  const copy = Uint8Array.from(bytes);
  const png = UPNG.decode(copy.buffer);
  if (png.error) {
    throw new Error(String(png.error));
  }
  if (png.width == null || png.height == null) {
    throw new Error("png_decode_missing_dimensions");
  }
  const bufs = UPNG.toRGBA8(png);
  if (!bufs || bufs.length === 0) {
    throw new Error("png_to_rgba_empty");
  }
  const rgba = new Uint8ClampedArray(bufs[0]);
  return { width: png.width, height: png.height, data: rgba };
}

function decodeJpegToRgba(bytes: Uint8Array): RgbaFrame {
  const raw = jpeg.decode(bytes, {
    useTArray: true,
    formatAsRGBA: true,
    maxMemoryUsageInMB: parseJpegDecodeMaxMemoryMb(),
  });
  return ensureRgbaFrame(raw.width, raw.height, raw.data as Uint8Array);
}

async function decodeWebpToRgba(bytes: Uint8Array): Promise<RgbaFrame> {
  await ensureJsquashWebpDecoderInit();
  const copy = Uint8Array.from(bytes);
  const imageData = await webpDecode(copy.buffer);
  return {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(
      imageData.data.buffer,
      imageData.data.byteOffset,
      imageData.data.length
    ),
  };
}

/**
 * Decode arbitrary deck image bytes to RGBA8 (JPEG, PNG, WebP, HEIC/HEIF).
 */
export async function decodeToRgba(
  bytes: Uint8Array,
  hint?: ImageFormatHint
): Promise<RgbaFrame> {
  const format =
    hint && hint !== "unknown" ? hint : sniffImageFormat(bytes);
  if (format === "png") return decodePngToRgba(bytes);
  if (format === "jpeg") return decodeJpegToRgba(bytes);
  if (format === "webp") return decodeWebpToRgba(bytes);
  if (format === "heic") return decodeHeicToRgba(bytes);
  throw new Error(`Unsupported or unknown image format (sniff=${sniffImageFormat(bytes)})`);
}
