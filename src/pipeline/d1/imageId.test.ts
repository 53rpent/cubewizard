import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeImageId } from "./imageId";

describe("computeImageId", () => {
  it("matches Python hashlib.sha256(...).hexdigest()[:16]", async () => {
    const cubeId = "test-cube";
    const pilot = "Ada";
    const ts = "20260101_120000";
    const py = createHash("sha256").update(`${cubeId}|${pilot}|${ts}`).digest("hex").slice(0, 16);
    await expect(computeImageId(cubeId, pilot, ts)).resolves.toBe(py);
  });

  it("ignores pilot for hedron processing_timestamp", async () => {
    const cubeId = "cube1";
    const ts = "hedron:uuid-abc";
    const py = createHash("sha256").update(`${cubeId}|${ts}`).digest("hex").slice(0, 16);
    await expect(computeImageId(cubeId, "EVENT P1", ts)).resolves.toBe(py);
    await expect(computeImageId(cubeId, "claimed-user", ts)).resolves.toBe(py);
  });

  it("ignores pilot when image_source is hedron", async () => {
    const cubeId = "cube1";
    const ts = "manual-looking-ts";
    const py = createHash("sha256").update(`${cubeId}|${ts}`).digest("hex").slice(0, 16);
    await expect(computeImageId(cubeId, "A", ts, { imageSource: "hedron" })).resolves.toBe(py);
  });
});
