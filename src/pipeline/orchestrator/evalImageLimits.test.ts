import { describe, expect, it } from "vitest";
import { parseEvalMaxImageSide } from "./evalImageLimits";

describe("parseEvalMaxImageSide", () => {
  it("defaults to 2048 and caps at 4096", () => {
    expect(parseEvalMaxImageSide(undefined)).toBe(2048);
    expect(parseEvalMaxImageSide("3000")).toBe(3000);
    expect(parseEvalMaxImageSide("99999")).toBe(4096);
    expect(parseEvalMaxImageSide("100")).toBe(2048);
  });
});
