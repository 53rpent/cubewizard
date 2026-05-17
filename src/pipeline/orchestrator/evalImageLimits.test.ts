import { describe, expect, it } from "vitest";
import {
  EVAL_IMAGE_SIDE_UNLIMITED,
  EVAL_JPEG_QUALITY_DEFAULT,
  parseEvalJpegQuality,
  parseEvalMaxImageSide,
  parseEvalOrientMaxSide,
} from "./evalImageLimits";

describe("parseEvalMaxImageSide", () => {
  it("defaults to unlimited (source resolution)", () => {
    expect(parseEvalMaxImageSide(undefined)).toBe(EVAL_IMAGE_SIDE_UNLIMITED);
    expect(parseEvalMaxImageSide("")).toBe(EVAL_IMAGE_SIDE_UNLIMITED);
    expect(parseEvalMaxImageSide("full")).toBe(EVAL_IMAGE_SIDE_UNLIMITED);
    expect(parseEvalMaxImageSide("0")).toBe(EVAL_IMAGE_SIDE_UNLIMITED);
  });

  it("honors explicit positive limits without an upper cap", () => {
    expect(parseEvalMaxImageSide("3000")).toBe(3000);
    expect(parseEvalMaxImageSide("8192")).toBe(8192);
  });

  it("treats invalid small values as unlimited", () => {
    expect(parseEvalMaxImageSide("100")).toBe(EVAL_IMAGE_SIDE_UNLIMITED);
  });
});

describe("parseEvalJpegQuality", () => {
  it("defaults to 100 and clamps 60–100", () => {
    expect(parseEvalJpegQuality(undefined)).toBe(EVAL_JPEG_QUALITY_DEFAULT);
    expect(parseEvalJpegQuality("100")).toBe(100);
    expect(parseEvalJpegQuality("50")).toBe(60);
    expect(parseEvalJpegQuality("150")).toBe(100);
  });
});

describe("parseEvalOrientMaxSide", () => {
  it("delegates to parseEvalMaxImageSide", () => {
    expect(parseEvalOrientMaxSide(undefined)).toBe(EVAL_IMAGE_SIDE_UNLIMITED);
    expect(parseEvalOrientMaxSide("2048")).toBe(2048);
  });
});
