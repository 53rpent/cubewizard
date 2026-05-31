import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeStagingImage,
  normalizeStagingImageFallback,
  parseStagingImageConfig,
  type StagingImagesBinding,
} from "./normalizeStagingImage";
import { readImageDimensions } from "./readImageDimensions";

/** Minimal PNG IHDR bomb for staging fallback dimension gate. */
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

function mockImagesBinding(onTransform: (opts: Record<string, string | number>) => Uint8Array): StagingImagesBinding {
  return {
    async info() {
      return { width: 5712, height: 4284, format: "jpeg" };
    },
    input() {
      const chain = {
        transform(opts: Record<string, string | number>) {
          lastOpts = opts;
          return chain;
        },
        output() {
          return Promise.resolve({
            response() {
              const bytes = onTransform(lastOpts);
              return new Response(bytes as BodyInit, {
                status: 200,
                headers: { "Content-Type": "image/jpeg" },
              });
            },
          });
        },
      };
      let lastOpts: Record<string, string | number> = {};
      return chain;
    },
  };
}

describe("parseStagingImageConfig", () => {
  it("uses staging vars with defaults", () => {
    expect(parseStagingImageConfig({})).toEqual({ maxSide: 3072, jpegQuality: 100 });
    expect(
      parseStagingImageConfig({
        CW_STAGING_MAX_IMAGE_SIDE: "1024",
        CW_STAGING_JPEG_QUALITY: "85",
      }),
    ).toEqual({ maxSide: 1024, jpegQuality: 85 });
  });
});

describe("readImageDimensions", () => {
  it("reads golden JPEG dimensions", () => {
    const path = join(process.cwd(), "fixtures/eval-golden/cases/ArcaneLessons/image.jpg");
    const bytes = new Uint8Array(readFileSync(path));
    const dims = readImageDimensions(bytes, "jpeg");
    expect(Math.max(dims.width, dims.height)).toBe(5712);
    expect(Math.min(dims.width, dims.height)).toBe(4284);
  });
});

describe("normalizeStagingImage", () => {
  it("caps dimensions via images binding mock", async () => {
    const path = join(process.cwd(), "fixtures/eval-golden/cases/ArcaneLessons/image.jpg");
    const input = new Uint8Array(readFileSync(path));
    const fallback = await normalizeStagingImageFallback(input, {
      maxSide: 3072,
      jpegQuality: 90,
    });
    const images = mockImagesBinding(() => fallback.bytes);
    const out = await normalizeStagingImage(images, input, {
      maxSide: 3072,
      jpegQuality: 90,
    });
    expect(out.method).toBe("images_binding");
    expect(out.width).toBeLessThanOrEqual(3072);
    expect(out.height).toBeLessThanOrEqual(3072);
    expect(out.originalWidth).toBe(5712);
    expect(out.bytes[0]).toBe(0xff);
    expect(out.bytes[1]).toBe(0xd8);
  });

  it("fallback downscales ArcaneLessons below max side", async () => {
    const path = join(process.cwd(), "fixtures/eval-golden/cases/ArcaneLessons/image.jpg");
    const input = new Uint8Array(readFileSync(path));
    const out = await normalizeStagingImage(null, input, {
      maxSide: 3072,
      jpegQuality: 90,
    });
    expect(out.method).toBe("decode_fallback");
    expect(out.width).toBeLessThanOrEqual(3072);
    expect(out.height).toBeLessThanOrEqual(3072);
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(3072);
  });

  it("fallback rejects PNG dimension bomb before decode", async () => {
    const bomb = makeBombPng(10000, 10000);
    await expect(normalizeStagingImageFallback(bomb, { maxSide: 3072, jpegQuality: 90 })).rejects.toThrow(
      /rgba_budget_exceeded/,
    );
  });
});
