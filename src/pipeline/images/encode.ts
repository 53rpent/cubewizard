import jpeg from "jpeg-js";
import UPNG from "upng-js";
import type { RgbaFrame } from "./types";

/** True if any pixel has alpha < 255 (matches Pillow RGBA/P branch intent). */
export function frameHasTransparency(frame: RgbaFrame): boolean {
  const { data, width, height } = frame;
  const n = width * height;
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3]! < 255) return true;
  }
  return false;
}

export function encodeJpeg(frame: RgbaFrame, quality: number): Uint8Array {
  const raw = {
    data: frame.data,
    width: frame.width,
    height: frame.height,
  };
  const packed = jpeg.encode(raw, quality);
  const out = packed.data;
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

/** PNG RGBA8, 8-bit (UPNG ctype 6). */
export function encodePng(frame: RgbaFrame): Uint8Array {
  const ab = UPNG.encode(
    [frame.data],
    frame.width,
    frame.height,
    0
  ) as ArrayBuffer;
  return new Uint8Array(ab);
}
