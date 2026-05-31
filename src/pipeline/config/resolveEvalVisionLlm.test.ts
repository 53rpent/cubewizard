import { describe, expect, it } from "vitest";
import { PermanentEvalError } from "../orchestrator/evalErrors";
import {
  DEFAULT_EVAL_VISION_MODEL,
  resolveEvalVisionApiKey,
  resolveEvalVisionBaseUrl,
  resolveEvalVisionLlm,
  resolveEvalVisionModel,
} from "./resolveEvalVisionLlm";
import { OPENAI_DIRECT_BASE_URL, OPENAI_GATEWAY_BASE_URL_DEFAULT } from "./resolveOpenAiBaseUrl";

describe("resolveEvalVisionModel", () => {
  it("prefers EVAL_VISION_MODEL over OPENAI_VISION_MODEL", () => {
    expect(resolveEvalVisionModel({ EVAL_VISION_MODEL: "gpt-4o", OPENAI_VISION_MODEL: "gpt-5-mini-2025-08-07" })).toBe(
      "gpt-4o",
    );
  });

  it("falls back to default", () => {
    expect(resolveEvalVisionModel({})).toBe(DEFAULT_EVAL_VISION_MODEL);
  });
});

describe("resolveEvalVisionApiKey", () => {
  it("prefers EVAL_VISION_API_KEY over OPENAI_API_KEY", () => {
    expect(resolveEvalVisionApiKey({ EVAL_VISION_API_KEY: "sk-eval", OPENAI_API_KEY: "sk-openai" })).toBe("sk-eval");
  });

  it("throws when missing", () => {
    expect(() => resolveEvalVisionApiKey({})).toThrow(PermanentEvalError);
  });
});

describe("resolveEvalVisionBaseUrl", () => {
  it("uses EVAL_VISION_BASE_URL first", () => {
    expect(
      resolveEvalVisionBaseUrl({
        EVAL_VISION_BASE_URL: `${OPENAI_DIRECT_BASE_URL}/`,
        OPENAI_BASE_URL: "https://example.com/ignored",
      }),
    ).toBe(OPENAI_DIRECT_BASE_URL);
  });

  it("swaps gateway provider segment", () => {
    expect(resolveEvalVisionBaseUrl({ EVAL_GATEWAY_PROVIDER: "anthropic" })).toBe(
      OPENAI_GATEWAY_BASE_URL_DEFAULT.replace(/\/openai\/?$/, "/anthropic"),
    );
  });

  it("defaults to openai gateway path", () => {
    expect(resolveEvalVisionBaseUrl({})).toBe(OPENAI_GATEWAY_BASE_URL_DEFAULT);
  });
});

describe("resolveEvalVisionLlm", () => {
  it("returns full config", () => {
    const cfg = resolveEvalVisionLlm({
      EVAL_VISION_MODEL: "claude-sonnet-4-20250514",
      EVAL_VISION_API_KEY: "sk-ant-test",
      EVAL_GATEWAY_PROVIDER: "anthropic",
      OPENAI_REQUEST_TIMEOUT_MS: "120000",
    });
    expect(cfg.model).toBe("claude-sonnet-4-20250514");
    expect(cfg.apiKey).toBe("sk-ant-test");
    expect(cfg.baseUrl).toContain("/anthropic");
    expect(cfg.requestTimeoutMs).toBe(120_000);
  });
});
