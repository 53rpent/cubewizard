import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeToRgba } from "./decode";

const repoRoot = join(fileURLToPath(import.meta.url), "../../../..");
const arcaneJpg = join(repoRoot, "fixtures/eval-golden/cases/ArcaneLessons/image.jpg");

describe("decodeToRgba large golden JPEG", () => {
  it.skipIf(!existsSync(arcaneJpg))(
    "decodes ArcaneLessons fixture at full resolution",
    async () => {
      const bytes = new Uint8Array(readFileSync(arcaneJpg));
      const frame = await decodeToRgba(bytes, "jpeg");
      expect(Math.max(frame.width, frame.height)).toBeGreaterThan(5000);
      expect(Math.min(frame.width, frame.height)).toBeGreaterThan(4000);
    }
  );
});
