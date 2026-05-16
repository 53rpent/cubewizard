import { describe, expect, it } from "vitest";
import { parseEvalMaxConsumers } from "./evalConsumerScale";

describe("parseEvalMaxConsumers", () => {
  it("defaults to 2 and caps at max", () => {
    expect(parseEvalMaxConsumers(undefined)).toBe(2);
    expect(parseEvalMaxConsumers("10")).toBe(10);
    expect(parseEvalMaxConsumers("99")).toBe(10);
    expect(parseEvalMaxConsumers("3")).toBe(3);
    expect(parseEvalMaxConsumers("0")).toBe(1);
  });
});
