import { describe, expect, it } from "vitest";
import {
  assertVisionPublishConfigured,
  safeUploadIdForKey,
  visionExtractObjectKey,
  visionOrientObjectKey,
} from "./visionPublish";
import { PermanentEvalError } from "../orchestrator/evalErrors";

describe("visionPublish", () => {
  it("builds orient step keys", () => {
    expect(visionOrientObjectKey("hedron:abc", 2)).toBe("tmp/vision/hedron_abc/orient-2.jpg");
    expect(visionExtractObjectKey("hedron:abc")).toBe("tmp/vision/hedron_abc/extract.jpg");
    expect(safeUploadIdForKey("a/b")).toBe("a_b");
    expect(safeUploadIdForKey("hedron:uuid")).toBe("hedron_uuid");
  });

  it("throws when presign creds missing on hosted env", () => {
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
