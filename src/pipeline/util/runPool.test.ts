import { describe, expect, it } from "vitest";
import { runPool } from "./runPool";

describe("runPool", () => {
  it("runs at most N tasks concurrently", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const order: number[] = [];

    await runPool([0, 1, 2, 3, 4, 5], 2, async (n) => {
      order.push(n);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
    });

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(order.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
