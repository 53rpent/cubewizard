import { describe, expect, it } from "vitest";
import { parseEvalQueueConcurrency } from "./evalQueueConcurrency";

describe("parseEvalQueueConcurrency", () => {
  it("defaults to 5 and caps at 5", () => {
    expect(parseEvalQueueConcurrency(undefined)).toBe(5);
    expect(parseEvalQueueConcurrency("10")).toBe(5);
    expect(parseEvalQueueConcurrency("3")).toBe(3);
    expect(parseEvalQueueConcurrency("0")).toBe(1);
  });
});
