import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeToRgba,
  encodeJpeg,
  prepareBytesForOpenAiVision,
  rasterToOpenAiCompatible,
  resizeToMaxSide,
  rotateClockwise,
  sniffImageFormat,
} from "./index";

/** Canonical 1×1 red PNG (valid IDAT). */
function minimalRedPng(): Uint8Array {
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return new Uint8Array(Buffer.from(b64, "base64"));
}

describe("sniffImageFormat", () => {
  it("detects PNG and JPEG", () => {
    const png = minimalRedPng();
    expect(sniffImageFormat(png)).toBe("png");
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    expect(sniffImageFormat(jpeg)).toBe("jpeg");
  });
});

describe("rotateClockwise", () => {
  it("rotates 3×1 RGB strip 90° CW to 1×3 (left→top)", () => {
    const data = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
    ]);
    const frame = { width: 3, height: 1, data };
    const r = rotateClockwise(frame, 90);
    expect(r.width).toBe(1);
    expect(r.height).toBe(3);
    expect(Array.from(r.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(r.data.slice(4, 8))).toEqual([0, 255, 0, 255]);
    expect(Array.from(r.data.slice(8, 12))).toEqual([0, 0, 255, 255]);
  });

  it("is identity for 0° (clone)", async () => {
    const png = minimalRedPng();
    const frame = await decodeToRgba(png, "png");
    const a = rotateClockwise(frame, 0);
    expect(a.width).toBe(frame.width);
    expect(a.data).not.toBe(frame.data);
    expect(Array.from(a.data)).toEqual(Array.from(frame.data));
  });
});

describe("resizeToMaxSide", () => {
  it("shrinks when larger than max", () => {
    const data = new Uint8ClampedArray(100 * 200 * 4);
    data.fill(255);
    const frame = { width: 100, height: 200, data };
    const out = resizeToMaxSide(frame, 50, 50);
    expect(out.width).toBe(25);
    expect(out.height).toBe(50);
  });
});

describe("compatible raster", () => {
  it("uses PNG when alpha < 255", () => {
    const d = new Uint8ClampedArray(2 * 2 * 4);
    for (let i = 0; i < 4; i++) {
      d[i * 4] = 1;
      d[i * 4 + 1] = 2;
      d[i * 4 + 2] = 3;
      d[i * 4 + 3] = 128;
    }
    const frame = { width: 2, height: 2, data: d };
    const out = rasterToOpenAiCompatible(frame, 90);
    expect(out.mime).toBe("image/png");
    expect(out.bytes[0]).toBe(0x89);
  });

  it("uses JPEG when fully opaque", () => {
    const d = new Uint8ClampedArray(2 * 2 * 4);
    for (let i = 0; i < 4; i++) {
      d[i * 4] = 9;
      d[i * 4 + 1] = 8;
      d[i * 4 + 2] = 7;
      d[i * 4 + 3] = 255;
    }
    const frame = { width: 2, height: 2, data: d };
    const out = rasterToOpenAiCompatible(frame, 90);
    expect(out.mime).toBe("image/jpeg");
    expect(out.bytes[0]).toBe(0xff);
    expect(out.bytes[1]).toBe(0xd8);
  });

  it("passes through PNG bytes in prepareBytesForOpenAiVision", async () => {
    const png = minimalRedPng();
    const out = await prepareBytesForOpenAiVision(png);
    expect(out.mime).toBe("image/png");
    expect(Array.from(out.bytes)).toEqual(Array.from(png));
  });

  it("roundtrips canonical PNG through decode", async () => {
    const png = minimalRedPng();
    const frame = await decodeToRgba(png, "png");
    expect(frame.width).toBe(1);
    expect(frame.height).toBe(1);
    expect(frame.data[0]).toBeGreaterThan(200);
  });
});

describe("HEIC (optional fixture)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const heicPath = join(here, "../../../fixtures/pipeline/images/sample.heic");

  it.skipIf(!existsSync(heicPath))("decodes sample.heic to RGBA", async () => {
    const bytes = new Uint8Array(readFileSync(heicPath));
    const frame = await decodeToRgba(bytes, "heic");
    expect(frame.width).toBeGreaterThan(0);
    expect(frame.height).toBeGreaterThan(0);
    expect(frame.data.length).toBe(frame.width * frame.height * 4);
  });
});

describe("encodeJpeg", () => {
  it("emits valid JPEG header from RGBA", () => {
    const d = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < 4 * 4; i++) {
      d[i * 4] = 200;
      d[i * 4 + 1] = 100;
      d[i * 4 + 2] = 50;
      d[i * 4 + 3] = 255;
    }
    const frame = { width: 4, height: 4, data: d };
    const jpg = encodeJpeg(frame, 90);
    expect(jpg[0]).toBe(0xff);
    expect(jpg[1]).toBe(0xd8);
  });

  it("roundtrips JPEG through decodeToRgba", async () => {
    const d = new Uint8ClampedArray(4 * 4 * 4);
    d.fill(255);
    for (let i = 0; i < 4 * 4; i++) d[i * 4 + 2] = 0;
    const frame = { width: 4, height: 4, data: d };
    const jpg = encodeJpeg(frame, 90);
    const again = await decodeToRgba(jpg, "jpeg");
    expect(again.width).toBe(4);
    expect(again.height).toBe(4);
  });
});
