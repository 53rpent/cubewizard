import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  combineClockwiseRotations,
  cropCenter,
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

  it("is identity for 0° (no copy)", async () => {
    const png = minimalRedPng();
    const frame = await decodeToRgba(png, "png");
    expect(rotateClockwise(frame, 0)).toBe(frame);
  });

  it("180° CW matches two 90° steps on landscape aspect", () => {
    const w = 4;
    const h = 3;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i++) data[i] = (i * 11) % 256;
    const frame = { width: w, height: h, data };
    const twice = rotateClockwise(rotateClockwise(frame, 90), 90);
    const direct = rotateClockwise(frame, 180);
    expect(Array.from(direct.data)).toEqual(Array.from(twice.data));
  });

  it("270° CW matches three 90° steps", () => {
    const data = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
    ]);
    const frame = { width: 3, height: 1, data };
    const once = rotateClockwise(rotateClockwise(rotateClockwise(frame, 90), 90), 90);
    const direct = rotateClockwise(frame, 270);
    expect(direct.width).toBe(once.width);
    expect(direct.height).toBe(once.height);
    expect(Array.from(direct.data)).toEqual(Array.from(once.data));
  });

  it("0/90/180/270 are four distinct orientations on landscape aspect", () => {
    const w = 4;
    const h = 3;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i++) data[i] = (i * 13 + 7) % 256;
    const frame = { width: w, height: h, data };
    const fps = [0, 90, 180, 270].map((deg) => {
      const f = deg === 0 ? frame : rotateClockwise(frame, deg);
      let hsh = 0;
      for (let i = 0; i < f.data.length; i++) hsh = (hsh * 31 + f.data[i]!) | 0;
      return `${deg}:${hsh}`;
    });
    expect(new Set(fps).size).toBe(4);
    expect(fps[0]).not.toBe(fps[2]);
  });

  it("is not matrix transpose (reflection on non-square frames)", () => {
    const w = 4;
    const h = 3;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        data[i] = x * 40 + y;
        data[i + 3] = 255;
      }
    }
    const frame = { width: w, height: h, data };
    const transposed = new Uint8ClampedArray(h * w * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = (y * w + x) * 4;
        const di = (x * h + y) * 4;
        transposed[di] = data[si]!;
        transposed[di + 1] = data[si + 1]!;
        transposed[di + 2] = data[si + 2]!;
        transposed[di + 3] = data[si + 3]!;
      }
    }
    const rotated = rotateClockwise(frame, 90).data;
    expect(Array.from(rotated)).not.toEqual(Array.from(transposed));
  });

  it("four 90° steps restore the original (not a mirrored copy)", () => {
    const w = 4;
    const h = 3;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i++) data[i] = (i * 17 + 3) % 256;
    const frame = { width: w, height: h, data };
    let out = frame;
    for (let i = 0; i < 4; i++) out = rotateClockwise(out, 90);
    expect(out.width).toBe(frame.width);
    expect(out.height).toBe(frame.height);
    expect(Array.from(out.data)).toEqual(Array.from(frame.data));

    const flipped = new Uint8ClampedArray(frame.data);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = (y * w + x) * 4;
        const di = (y * w + (w - 1 - x)) * 4;
        for (let c = 0; c < 4; c++) flipped[di + c] = frame.data[si + c]!;
      }
    }
    expect(Array.from(out.data)).not.toEqual(Array.from(flipped));
  });
});

describe("combineClockwiseRotations", () => {
  it("sums modulo 360", () => {
    expect(combineClockwiseRotations(90, 90)).toBe(180);
    expect(combineClockwiseRotations(90, 270)).toBe(0);
  });
});

describe("cropCenter", () => {
  it("crops the middle fraction of the frame", () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    data.fill(0);
    data[(1 * 4 + 1) * 4] = 255;
    const frame = { width: 4, height: 4, data };
    const out = cropCenter(frame, 0.5);
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(out.data[0]).toBe(255);
  });
});

describe("resizeToMaxSide", () => {
  it("is a no-op when max side is 0 (unlimited)", () => {
    const data = new Uint8ClampedArray(100 * 200 * 4);
    const frame = { width: 100, height: 200, data };
    expect(resizeToMaxSide(frame, 0, 0)).toBe(frame);
  });

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
