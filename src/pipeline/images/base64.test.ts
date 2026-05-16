import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "./base64";

describe("bytesToBase64", () => {
  it("round-trips small payloads", () => {
    const raw = new Uint8Array([72, 101, 108, 108, 111]);
    expect(atob(bytesToBase64(raw))).toBe("Hello");
  });
});
