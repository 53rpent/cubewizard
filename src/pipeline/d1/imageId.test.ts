import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeImageId } from "./imageId";

describe("computeImageId", () => {
  it("matches Python hashlib.sha256(...).hexdigest()[:16]", async () => {
    const cubeId = "test-cube";
    const pilot = "Ada";
    const ts = "20260101_120000";
    const py = createHash("sha256")
      .update(`${cubeId}|${pilot}|${ts}`)
      .digest("hex")
      .slice(0, 16);
    await expect(computeImageId(cubeId, pilot, ts)).resolves.toBe(py);
  });
});
