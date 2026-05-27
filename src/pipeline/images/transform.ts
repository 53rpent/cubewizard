import type { RgbaFrame } from "./types";

function rgbaAt(d: Uint8ClampedArray, idx: number): number {
  return d[idx] ?? 0;
}

function sampleBilinear(src: RgbaFrame, sx: number, sy: number): [number, number, number, number] {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(x0 + 1, src.width - 1);
  const y1 = Math.min(y0 + 1, src.height - 1);
  const fx = sx - x0;
  const fy = sy - y0;
  const w = src.width;
  const d = src.data;
  function px(x: number, y: number, c: number) {
    return rgbaAt(d, (y * w + x) * 4 + c);
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
export function resizeToMaxSide(frame: RgbaFrame, maxWidth: number, maxHeight: number): RgbaFrame {
  if (maxWidth <= 0 || maxHeight <= 0) return frame;
  const { width: w, height: h } = frame;
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

/**
 * Center crop by `fraction` of width/height (0–1], preserving aspect of the source frame.
 * Used for orientation API input so edge deck-bleed does not dominate rotation.
 */
export function cropCenter(frame: RgbaFrame, fraction: number): RgbaFrame {
  const f = Math.min(1, Math.max(0.1, fraction));
  const cw = Math.max(1, Math.floor(frame.width * f));
  const ch = Math.max(1, Math.floor(frame.height * f));
  const x0 = Math.floor((frame.width - cw) / 2);
  const y0 = Math.floor((frame.height - ch) / 2);
  const out = new Uint8ClampedArray(cw * ch * 4);
  const sw = frame.width;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = ((y0 + y) * sw + (x0 + x)) * 4;
      const di = (y * cw + x) * 4;
      out[di] = rgbaAt(frame.data, si);
      out[di + 1] = rgbaAt(frame.data, si + 1);
      out[di + 2] = rgbaAt(frame.data, si + 2);
      out[di + 3] = rgbaAt(frame.data, si + 3);
    }
  }
  return { width: cw, height: ch, data: out };
}

/**
 * One 90° clockwise step with expand (no flips / transpose — rotation only).
 * Top-left origin, +x right, +y down. W×H → H×W.
 */
export function rotate90ClockwiseOnce(frame: RgbaFrame): RgbaFrame {
  const w = frame.width;
  const h = frame.height;
  const src = frame.data;
  const nw = h;
  const nh = w;
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let oy = 0; oy < nh; oy++) {
    for (let ox = 0; ox < nw; ox++) {
      const sx = oy;
      const sy = h - 1 - ox;
      const si = (sy * w + sx) * 4;
      const di = (oy * nw + ox) * 4;
      out[di] = rgbaAt(src, si);
      out[di + 1] = rgbaAt(src, si + 1);
      out[di + 2] = rgbaAt(src, si + 2);
      out[di + 3] = rgbaAt(src, si + 3);
    }
  }
  return { width: nw, height: nh, data: out };
}

/**
 * Clockwise rotation by repeated 90° steps only (0, 90, 180, 270).
 */
export function rotateClockwise(frame: RgbaFrame, degrees: number): RgbaFrame {
  const steps = ((((degrees % 360) + 360) % 360) / 90) | 0;
  if (steps === 0) return frame;
  let out = frame;
  for (let i = 0; i < steps; i++) {
    out = rotate90ClockwiseOnce(out);
  }
  return out;
}
