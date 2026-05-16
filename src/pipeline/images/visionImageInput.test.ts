import { describe, expect, it, vi } from "vitest";
import { visionInputFromJpegBytes } from "./visionImageInput";
import type { VisionImagePublisher } from "./visionPublish";

describe("visionInputFromJpegBytes", () => {
  it("returns base64 when CWW_ENV is local", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const input = await visionInputFromJpegBytes({
      env: { CWW_ENV: "local" },
      jpegBytes: jpeg,
      purpose: "extract",
    });
    expect("imageBase64" in input).toBe(true);
    expect(input.imageBase64).toBeTruthy();
    expect("imageUrl" in input).toBe(false);
  });

  it("publishes URL when not local", async () => {
    const publisher: VisionImagePublisher = {
      urlMode: "public",
      publishOrientStep: vi.fn(async () => "https://cdn.example.com/orient-0.jpg"),
      publishExtract: vi.fn(async () => "https://cdn.example.com/extract.jpg"),
    };
    const input = await visionInputFromJpegBytes({
      env: { CWW_ENV: "staging" },
      publisher,
      jpegBytes: new Uint8Array([1, 2, 3]),
      purpose: "orient",
      step: 0,
    });
    expect(input).toEqual({ imageUrl: "https://cdn.example.com/orient-0.jpg" });
    expect(publisher.publishOrientStep).toHaveBeenCalledOnce();
  });
});
