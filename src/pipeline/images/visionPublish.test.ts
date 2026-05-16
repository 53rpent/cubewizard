import { describe, expect, it } from "vitest";
import {
  assertVisionPublishConfigured,
  safeUploadIdForKey,
  visionExtractObjectKey,
  visionOrientObjectKey,
  visionPublicBaseUrl,
} from "./visionPublish";
import { PermanentEvalError } from "../orchestrator/evalErrors";

describe("visionPublish", () => {
  it("reads public base URL from env", () => {
    expect(visionPublicBaseUrl({ DECK_IMAGE_PUBLIC_BASE_URL: "https://cdn.example.com" })).toBe(
      "https://cdn.example.com"
    );
  });

  it("builds orient step keys", () => {
    expect(visionOrientObjectKey("hedron:abc", 2)).toBe("tmp/vision/hedron:abc/orient-2.jpg");
    expect(visionExtractObjectKey("hedron:abc")).toBe("tmp/vision/hedron:abc/extract.jpg");
    expect(safeUploadIdForKey("a/b")).toBe("a_b");
  });

  it("throws when neither public base nor presign creds", () => {
    expect(() => assertVisionPublishConfigured({})).toThrow(PermanentEvalError);
    expect(() => assertVisionPublishConfigured({ CWW_ENV: "local" })).not.toThrow();
    expect(() =>
      assertVisionPublishConfigured({
        CLOUDFLARE_ACCOUNT_ID: "abc123456789",
        R2_ACCESS_KEY_ID: "k",
        R2_SECRET_ACCESS_KEY: "s",
      })
    ).not.toThrow();
  });
});
