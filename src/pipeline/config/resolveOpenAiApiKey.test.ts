import { describe, expect, it } from "vitest";
import { PermanentEvalError } from "../orchestrator/evalErrors";
import { resolveOpenAiApiKey } from "./resolveOpenAiApiKey";

describe("resolveOpenAiApiKey", () => {
  it("returns trimmed key from env", () => {
    expect(resolveOpenAiApiKey({ OPENAI_API_KEY: "  sk-test  " })).toBe("sk-test");
  });

  it("uses EVAL_VISION_API_KEY when set", () => {
    expect(resolveOpenAiApiKey({ EVAL_VISION_API_KEY: "sk-eval", OPENAI_API_KEY: "sk-openai" })).toBe("sk-eval");
  });

  it("throws permanent error when missing", () => {
    expect(() => resolveOpenAiApiKey({})).toThrow(PermanentEvalError);
    expect(() => resolveOpenAiApiKey({ OPENAI_API_KEY: "  " })).toThrow(/EVAL_VISION_API_KEY_missing/);
  });
});
