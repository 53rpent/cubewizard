import { encode as encodeWebp } from "@jsquash/webp";
import { decodeToRgba } from "../images/decode";
import { ensureJsquashWebpEncoderInit } from "../images/jsquashWebpInit";
import { resizeToMaxSide } from "../images/transform";
import type { ImageFormatHint } from "../images/types";
import { THUMB_MAX_SIDE, THUMB_WEBP_QUALITY } from "./orientedKeys";

export { THUMB_MAX_SIDE, THUMB_WEBP_QUALITY };

/** `@jsquash/webp` encoder signature (injectable for tests — WASM fetch can fail under Vitest/Node). */
export type WebpEncodeFn = (
  data: ImageData,
  options?: { quality?: number }
) => Promise<ArrayBuffer>;

/**
 * `@jsquash/webp` only reads `data` / `width` / `height` (see `encode.js` in the package).
 * Avoid relying on `globalThis.ImageData` so Vitest runs on Node without canvas.
 */
function frameAsImageDataLike(frame: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}): ImageData {
  return {
    data: new Uint8ClampedArray(frame.data),
    width: frame.width,
    height: frame.height,
    colorSpace: "srgb",
  } as ImageData;
}

/**
 * Decode → fit inside {@link THUMB_MAX_SIDE} (bilinear) → WebP, matching `oriented_r2.build_thumb_webp_bytes`
 * intent (Pillow LANCZOS → here bilinear + @jsquash/webp).
 */
export async function buildThumbWebpBytesFromImageBytes(
  bytes: Uint8Array,
  format: ImageFormatHint,
  encodeImpl: WebpEncodeFn = encodeWebp
): Promise<Uint8Array> {
  if (encodeImpl === encodeWebp) {
    await ensureJsquashWebpEncoderInit();
  }
  let frame = await decodeToRgba(bytes, format);
  frame = resizeToMaxSide(frame, THUMB_MAX_SIDE, THUMB_MAX_SIDE);
  const imageData = frameAsImageDataLike(frame);
  const buf = await encodeImpl(imageData, { quality: THUMB_WEBP_QUALITY });
  return new Uint8Array(buf);
}
