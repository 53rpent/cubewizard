import { describe, expect, it } from "vitest";
import { verifyTurnstile, verifyTurnstileFromRequest } from "./turnstile.js";

var localEnv = { CWW_ENV: "local" };
var prodEnv = { CWW_ENV: "production", TURNSTILE_SECRET: "test-secret" };

describe("verifyTurnstile", () => {
  it("skips verification when CWW_ENV is local", async () => {
    expect(await verifyTurnstile(null, "", localEnv)).toBe(true);
  });
});

describe("verifyTurnstileFromRequest", () => {
  it("skips verification when CWW_ENV is local and no token is present", async () => {
    var request = new Request("https://example.com/api/hedron-sync/cube", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(await verifyTurnstileFromRequest(request, localEnv, {})).toBe(true);
  });

  it("requires a token in non-local env", async () => {
    var request = new Request("https://example.com/api/hedron-sync/cube", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(await verifyTurnstileFromRequest(request, prodEnv, {})).toBe(false);
  });
});
