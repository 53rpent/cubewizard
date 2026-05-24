import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JPEG_DECODE_DEFAULT_MAX_MEMORY_MB,
  JPEG_DECODE_UNLIMITED_MEMORY_MB,
  decodeToRgba,
  parseJpegDecodeMaxMemoryMb,
} from "./decode";

const repoRoot = join(fileURLToPath(import.meta.url), "../../../..");
const arcaneJpg = join(repoRoot, "fixtures/eval-golden/cases/ArcaneLessons/image.jpg");

describe("parseJpegDecodeMaxMemoryMb", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to 512 MB when unset", () => {
    vi.stubEnv("CW_EVAL_JPEG_DECODE_MAX_MEMORY_MB", "");
    expect(parseJpegDecodeMaxMemoryMb()).toBe(JPEG_DECODE_DEFAULT_MAX_MEMORY_MB);
  });

  it("treats 0 as unlimited", () => {
    expect(parseJpegDecodeMaxMemoryMb({ CW_EVAL_JPEG_DECODE_MAX_MEMORY_MB: "0" })).toBe(
      JPEG_DECODE_UNLIMITED_MEMORY_MB
    );
  });
});

describe("decodeToRgba large golden JPEG", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.skipIf(!existsSync(arcaneJpg))(
    "decodes ArcaneLessons fixture when jpeg decode memory is unlimited",
    async () => {
      vi.stubEnv("CW_EVAL_JPEG_DECODE_MAX_MEMORY_MB", "0");
      const bytes = new Uint8Array(readFileSync(arcaneJpg));
      const frame = await decodeToRgba(bytes, "jpeg");
      expect(frame.width).toBeGreaterThan(5000);
      expect(frame.height).toBeGreaterThan(4000);
    }
  );
});
