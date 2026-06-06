import { describe, expect, it } from "vitest";
import { modelSupportsReasoningEffort } from "./openAiModelCapabilities";

describe("modelSupportsReasoningEffort", () => {
  it("allows gpt-5 family", () => {
    expect(modelSupportsReasoningEffort("gpt-5-mini-2025-08-07")).toBe(true);
    expect(modelSupportsReasoningEffort("openai/gpt-5-mini")).toBe(true);
  });

  it("allows o-series except o1-mini", () => {
    expect(modelSupportsReasoningEffort("o3-mini")).toBe(true);
    expect(modelSupportsReasoningEffort("o1")).toBe(true);
    expect(modelSupportsReasoningEffort("o1-mini")).toBe(false);
  });

  it("rejects non-reasoning and non-OpenAI models", () => {
    expect(modelSupportsReasoningEffort("gpt-4o-mini-2024-07-18")).toBe(false);
    expect(modelSupportsReasoningEffort("gemini-2.5-flash-lite")).toBe(false);
    expect(modelSupportsReasoningEffort("@cf/google/gemma-4-26b-a4b-it")).toBe(false);
    expect(modelSupportsReasoningEffort("google-ai-studio/gemini-2.0-flash")).toBe(false);
  });
});
