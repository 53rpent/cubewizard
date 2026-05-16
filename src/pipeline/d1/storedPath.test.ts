import { describe, expect, it } from "vitest";
import { normalizeStoredImagePathRelativeToOutput } from "./storedPath";

describe("normalizeStoredImagePathRelativeToOutput", () => {
  it("strips repeated output/ prefixes and normalizes slashes", () => {
    expect(normalizeStoredImagePathRelativeToOutput("output\\output/stored_images/x.jpg")).toBe(
      "stored_images/x.jpg"
    );
    expect(normalizeStoredImagePathRelativeToOutput("/stored_images/x.jpg")).toBe(
      "stored_images/x.jpg"
    );
  });
});
