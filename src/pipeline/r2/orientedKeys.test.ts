import { describe, expect, it } from "vitest";
import { contentTypeForExt, orientedObjectKey, orientedThumbObjectKey } from "./orientedKeys";

describe("orientedKeys", () => {
  it("builds stable keys", () => {
    expect(orientedObjectKey("cube1", "abc", ".JPG")).toBe("cube1/abc.jpg");
    expect(orientedObjectKey("cube1", "abc", "png")).toBe("cube1/abc.png");
    expect(orientedThumbObjectKey("cube1", "abc")).toBe("cube1/abc_thumb.webp");
  });

  it("maps extensions to content types", () => {
    expect(contentTypeForExt("jpeg")).toBe("image/jpeg");
    expect(contentTypeForExt(".HEIC")).toBe("image/heic");
    expect(contentTypeForExt("bin")).toBe("application/octet-stream");
  });
});
