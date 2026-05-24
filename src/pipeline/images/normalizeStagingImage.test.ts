import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeStagingImage,
  normalizeStagingImageFallback,
  parseStagingImageConfig,
  type StagingImagesBinding,
} from "./normalizeStagingImage";
import { readImageDimensions } from "./readImageDimensions";

function mockImagesBinding(
  onTransform: (opts: Record<string, string | number>) => Uint8Array
): StagingImagesBinding {
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
              return new Response(bytes, {
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
      })
    ).toEqual({ maxSide: 1024, jpegQuality: 85 });
  });
});

describe("readImageDimensions", () => {
  it("reads golden JPEG dimensions", () => {
    const path = join(
      process.cwd(),
      "fixtures/eval-golden/cases/ArcaneLessons/image.jpg"
    );
    const bytes = new Uint8Array(readFileSync(path));
    const dims = readImageDimensions(bytes, "jpeg");
    expect(Math.max(dims.width, dims.height)).toBe(5712);
    expect(Math.min(dims.width, dims.height)).toBe(4284);
  });
});

describe("normalizeStagingImage", () => {
  it("caps dimensions via images binding mock", async () => {
    const path = join(
      process.cwd(),
      "fixtures/eval-golden/cases/ArcaneLessons/image.jpg"
    );
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
    const path = join(
      process.cwd(),
      "fixtures/eval-golden/cases/ArcaneLessons/image.jpg"
    );
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
});
