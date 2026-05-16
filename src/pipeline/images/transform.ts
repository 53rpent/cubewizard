import type { RgbaFrame } from "./types";

function sampleBilinear(
  src: RgbaFrame,
  sx: number,
  sy: number
): [number, number, number, number] {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(x0 + 1, src.width - 1);
  const y1 = Math.min(y0 + 1, src.height - 1);
  const fx = sx - x0;
  const fy = sy - y0;
  const w = src.width;
  const d = src.data;
  function px(x: number, y: number, c: number) {
    return d[(y * w + x) * 4 + c]!;
  }
  const r =
    px(x0, y0, 0) * (1 - fx) * (1 - fy) +
    px(x1, y0, 0) * fx * (1 - fy) +
    px(x0, y1, 0) * (1 - fx) * fy +
    px(x1, y1, 0) * fx * fy;
  const g =
    px(x0, y0, 1) * (1 - fx) * (1 - fy) +
    px(x1, y0, 1) * fx * (1 - fy) +
    px(x0, y1, 1) * (1 - fx) * fy +
    px(x1, y1, 1) * fx * fy;
  const b =
    px(x0, y0, 2) * (1 - fx) * (1 - fy) +
    px(x1, y0, 2) * fx * (1 - fy) +
    px(x0, y1, 2) * (1 - fx) * fy +
    px(x1, y1, 2) * fx * fy;
  const a =
    px(x0, y0, 3) * (1 - fx) * (1 - fy) +
    px(x1, y0, 3) * fx * (1 - fy) +
    px(x0, y1, 3) * (1 - fx) * fy +
    px(x1, y1, 3) * fx * fy;
  return [r, g, b, a];
}

/**
 * Downscale if either dimension exceeds max; preserves aspect ratio (PIL thumbnail semantics).
 */
export function resizeToMaxSide(
  frame: RgbaFrame,
  maxWidth: number,
  maxHeight: number
): RgbaFrame {
  const { width: w, height: h, data } = frame;
  if (w <= maxWidth && h <= maxHeight) return frame;
  const scale = Math.min(maxWidth / w, maxHeight / h);
  const nw = Math.max(1, Math.floor(w * scale));
  const nh = Math.max(1, Math.floor(h * scale));
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const sx = ((x + 0.5) / nw) * w - 0.5;
      const sy = ((y + 0.5) / nh) * h - 0.5;
      const [r, g, b, a] = sampleBilinear(frame, sx, sy);
      const di = (y * nw + x) * 4;
      out[di] = Math.round(r);
      out[di + 1] = Math.round(g);
      out[di + 2] = Math.round(b);
      out[di + 3] = Math.round(a);
    }
  }
  return { width: nw, height: nh, data: out };
}

/** Sum clockwise rotation steps (each 0|90|180|270). */
export function combineClockwiseRotations(a: number, b: number): number {
  return (((a + b) % 360) + 360) % 360;
}

/** One 90° clockwise step: new size (H×W), maps old (x,y) → new (y, x). */
function rotate90ClockwiseOnce(frame: RgbaFrame): RgbaFrame {
  const w = frame.width;
  const h = frame.height;
  const src = frame.data;
  const nw = h;
  const nh = w;
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = y;
      const ny = x;
      const si = (y * w + x) * 4;
      const di = (ny * nw + nx) * 4;
      out[di] = src[si]!;
      out[di + 1] = src[si + 1]!;
      out[di + 2] = src[si + 2]!;
      out[di + 3] = src[si + 3]!;
    }
  }
  return { width: nw, height: nh, data: out };
}

function rotate180(frame: RgbaFrame): RgbaFrame {
  const w = frame.width;
  const h = frame.height;
  const src = frame.data;
  const out = new Uint8ClampedArray(w * h * 4);
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const si = i * 4;
    const di = (n - 1 - i) * 4;
    out[di] = src[si]!;
    out[di + 1] = src[si + 1]!;
    out[di + 2] = src[si + 2]!;
    out[di + 3] = src[si + 3]!;
  }
  return { width: w, height: h, data: out };
}

function rotate270ClockwiseOnce(frame: RgbaFrame): RgbaFrame {
  const w = frame.width;
  const h = frame.height;
  const src = frame.data;
  const nw = h;
  const nh = w;
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = h - 1 - y;
      const ny = x;
      const si = (y * w + x) * 4;
      const di = (ny * nw + nx) * 4;
      out[di] = src[si]!;
      out[di + 1] = src[si + 1]!;
      out[di + 2] = src[si + 2]!;
      out[di + 3] = src[si + 3]!;
    }
  }
  return { width: nw, height: nh, data: out };
}

/**
 * Clockwise rotation (0, 90, 180, 270), expand canvas like PIL `rotate(..., expand=True)`.
 * Uses one output buffer per call (no chained 90° steps for 180/270).
 */
export function rotateClockwise(frame: RgbaFrame, degrees: number): RgbaFrame {
  const d = (((degrees % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  if (d === 0) return frame;
  if (d === 90) return rotate90ClockwiseOnce(frame);
  if (d === 180) return rotate180(frame);
  return rotate270ClockwiseOnce(frame);
}
