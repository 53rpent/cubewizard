import { describe, expect, it, vi } from "vitest";
import { buildThumbWebpBytesFromImageBytes, type WebpEncodeFn } from "./thumbWebp";

/** 1×1 RGBA PNG (red pixel), base64. */
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("buildThumbWebpBytesFromImageBytes", () => {
  it("decodes, resizes to thumb bounds, then calls the WebP encoder", async () => {
    const bytes = Uint8Array.from(Buffer.from(TINY_PNG_B64, "base64"));
    const encodeImpl = vi.fn(async (data: Parameters<WebpEncodeFn>[0]) => {
      expect(data.width).toBe(1);
      expect(data.height).toBe(1);
      expect(data.data.length).toBe(4);
      const buf = new ArrayBuffer(12);
      const u = new Uint8Array(buf);
      u.set([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
      return buf;
    }) as WebpEncodeFn;

    const out = await buildThumbWebpBytesFromImageBytes(bytes, "png", encodeImpl);
    expect(encodeImpl).toHaveBeenCalledTimes(1);
    expect(String.fromCharCode(out[0]!, out[1]!, out[2]!, out[3]!)).toBe("RIFF");
  });
});
