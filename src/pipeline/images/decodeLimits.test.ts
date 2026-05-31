import { describe, expect, it } from "vitest";
import { decodeToRgba } from "./decode";
import { assertDecodeBudget, MAX_RGBA_BYTES } from "./decodeLimits";
import { readImageDimensions } from "./readImageDimensions";

/** Minimal PNG with IHDR claiming huge dimensions (decompression bomb probe). */
function makeBombPng(width: number, height: number): Uint8Array {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = new Uint8Array(13);
  const view = new DataView(ihdrData.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  const ihdrType = new TextEncoder().encode("IHDR");
  const ihdrLen = new Uint8Array(4);
  new DataView(ihdrLen.buffer).setUint32(0, 13, false);
  const ihdrCrc = new Uint8Array(4);
  const iendLen = new Uint8Array(4);
  const iendType = new TextEncoder().encode("IEND");
  const iendCrc = new Uint8Array(4);
  const out = new Uint8Array(
    signature.length +
      ihdrLen.length +
      ihdrType.length +
      ihdrData.length +
      ihdrCrc.length +
      iendLen.length +
      iendType.length +
      iendCrc.length,
  );
  let off = 0;
  out.set(signature, off);
  off += signature.length;
  out.set(ihdrLen, off);
  off += 4;
  out.set(ihdrType, off);
  off += 4;
  out.set(ihdrData, off);
  off += ihdrData.length;
  out.set(ihdrCrc, off);
  off += 4;
  out.set(iendLen, off);
  off += 4;
  out.set(iendType, off);
  off += 4;
  out.set(iendCrc, off);
  return out;
}

describe("assertDecodeBudget", () => {
  it("rejects dimensions exceeding RGBA memory budget", () => {
    expect(() => assertDecodeBudget(10000, 10000)).toThrow(/rgba_budget_exceeded/);
  });

  it("accepts large camera JPEG dimensions within budget", () => {
    expect(() => assertDecodeBudget(5712, 4284)).not.toThrow();
  });

  it("respects optional max pixel cap", () => {
    expect(() => assertDecodeBudget(2000, 2000, 1000 * 1000)).toThrow(/dimensions_exceed_max_pixels/);
  });
});

describe("PNG decompression bomb guard", () => {
  it("rejects huge declared dimensions from PNG header before decode", () => {
    const bomb = makeBombPng(10000, 10000);
    const dims = readImageDimensions(bomb, "png");
    expect(() => assertDecodeBudget(dims.width, dims.height)).toThrow(/rgba_budget_exceeded/);
  });

  it("decodeToRgba rejects bomb PNG via header gate", async () => {
    const bomb = makeBombPng(10000, 10000);
    await expect(decodeToRgba(bomb, "png")).rejects.toThrow(/rgba_budget_exceeded/);
  });

  it("rejects PNG that would exceed MAX_RGBA_BYTES", () => {
    const side = Math.ceil(Math.sqrt(MAX_RGBA_BYTES / 4)) + 100;
    const bomb = makeBombPng(side, side);
    const dims = readImageDimensions(bomb, "png");
    expect(() => assertDecodeBudget(dims.width, dims.height)).toThrow(/rgba_budget_exceeded/);
  });
});
