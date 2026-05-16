import { afterEach, describe, expect, it } from "vitest";
import {
  configureScryfallGlobalThrottle,
  getScryfallMinIntervalMs,
  resetScryfallGlobalThrottleForTests,
  scryfallGlobalThrottle,
} from "./globalThrottle";

describe("scryfallGlobalThrottle", () => {
  afterEach(() => {
    resetScryfallGlobalThrottleForTests();
  });

  it("scales interval with parallel deck count", () => {
    configureScryfallGlobalThrottle(5);
    expect(getScryfallMinIntervalMs()).toBe(500);
  });

  it("serializes calls with minimum spacing", async () => {
    configureScryfallGlobalThrottle(1);
    const t0 = Date.now();
    await scryfallGlobalThrottle();
    await scryfallGlobalThrottle();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(90);
  });
});
