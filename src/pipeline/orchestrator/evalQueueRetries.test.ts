import { describe, expect, it, vi } from "vitest";
import { OpenAiApiError } from "../openai/chatCompletionsApi";
import {
  computeEvalQueueRetryDelaySeconds,
  isEvalDlqQueue,
  isEvalRetriesExhausted,
  isOpenAi429Error,
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
    expect(buildDlqError("cubewizard-eval-stg-dlq", 5, "msg-1", "timeout")).toContain("dead_letter_queue");
  });

  it("uses longer base delay for OpenAI 429", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const err429 = new OpenAiApiError("OpenAI chat completions HTTP 429", 429, "");
    expect(computeEvalQueueRetryDelaySeconds(1, err429)).toBe(60);
    expect(computeEvalQueueRetryDelaySeconds(1, new Error("d1 timeout"))).toBe(30);
    vi.restoreAllMocks();
  });

  it("adds jitter between base and base + 50%", () => {
    const err = new Error("transient");
    const base = 30;
    for (let i = 0; i < 30; i++) {
      const delay = computeEvalQueueRetryDelaySeconds(1, err);
      expect(delay).toBeGreaterThanOrEqual(base);
      expect(delay).toBeLessThanOrEqual(base + Math.floor(base * 0.5));
    }
  });

  it("detects OpenAI 429 errors", () => {
    expect(isOpenAi429Error(new OpenAiApiError("x", 429, ""))).toBe(true);
    expect(isOpenAi429Error(new OpenAiApiError("x", 500, ""))).toBe(false);
  });
});
