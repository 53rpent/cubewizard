import { describe, expect, it } from "vitest";
import {
  isEvalDlqQueue,
  isEvalRetriesExhausted,
  parseEvalMaxRetries,
} from "./evalQueueRetries";
import { buildDlqError, buildRetriesExhaustedError } from "./failEvalJobFromQueue";

describe("evalQueueRetries", () => {
  it("parses max retries", () => {
    expect(parseEvalMaxRetries(undefined)).toBe(5);
    expect(parseEvalMaxRetries("3")).toBe(3);
  });

  it("detects exhausted retries", () => {
    expect(isEvalRetriesExhausted(1, 5)).toBe(false);
    expect(isEvalRetriesExhausted(5, 5)).toBe(true);
    expect(isEvalRetriesExhausted(6, 5)).toBe(true);
  });

  it("detects dlq queue names", () => {
    expect(isEvalDlqQueue("cubewizard-eval-stg-dlq")).toBe(true);
    expect(isEvalDlqQueue("cubewizard-eval-stg")).toBe(false);
  });

  it("builds descriptive errors", () => {
    expect(buildRetriesExhaustedError(5, 5, "OpenAI HTTP 429")).toContain("retries_exhausted");
    expect(buildDlqError("cubewizard-eval-stg-dlq", 5, "msg-1", "timeout")).toContain(
      "dead_letter_queue"
    );
  });
});
