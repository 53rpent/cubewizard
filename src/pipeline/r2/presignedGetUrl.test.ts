import { describe, expect, it } from "vitest";
import {
  hasR2PresignCredentials,
  parseCloudflareAccountId,
  publicUrlForR2Key,
} from "./presignedGetUrl";

describe("presignedGetUrl", () => {
  it("parses account id", () => {
    expect(parseCloudflareAccountId("abc123456789")).toBe("abc123456789");
    expect(parseCloudflareAccountId("")).toBeNull();
  });

  it("detects presign credentials", () => {
    expect(
      hasR2PresignCredentials({
        CLOUDFLARE_ACCOUNT_ID: "abc123456789",
        R2_ACCESS_KEY_ID: "key",
        R2_SECRET_ACCESS_KEY: "secret",
      })
    ).toBe(true);
    expect(
      hasR2PresignCredentials({
        CLOUDFLARE_ACCOUNT_ID: "abc123456789",
      })
    ).toBe(false);
  });

  it("builds public CDN URLs", () => {
    expect(publicUrlForR2Key("https://cdn.example.com", "tmp/vision/u1/extract.jpg")).toBe(
      "https://cdn.example.com/tmp/vision/u1/extract.jpg"
    );
  });
});
