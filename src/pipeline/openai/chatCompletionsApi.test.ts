import { describe, expect, it, vi } from "vitest";
import { OPENAI_GATEWAY_BASE_URL_DEFAULT, OPENAI_REQUEST_TIMEOUT_MS_DEFAULT } from "../config/resolveOpenAiBaseUrl";
import { callOpenAiVisionJsonSchema, parseEvalOpenAiLogLevel } from "./chatCompletionsApi";
import { orientationJsonSchema } from "./jsonSchemas";
import { OrientationResultSchema } from "./schemas";

function chatCompletionPayload(content: string): Record<string, unknown> {
  return {
    choices: [{ message: { role: "assistant", content } }],
  };
}

describe("parseEvalOpenAiLogLevel", () => {
  it("maps CW_EVAL_LOG_LEVEL", () => {
    expect(parseEvalOpenAiLogLevel({ CW_EVAL_LOG_LEVEL: "low" })).toBe("low");
    expect(parseEvalOpenAiLogLevel({ CW_EVAL_LOG_LEVEL: "MEDIUM" })).toBe("medium");
    expect(parseEvalOpenAiLogLevel({ CW_EVAL_LOG_LEVEL: "off" })).toBe("off");
  });
  it("uses legacy CW_EVAL_VERBOSE_LOG when level unset", () => {
    expect(parseEvalOpenAiLogLevel({ CW_EVAL_VERBOSE_LOG: "1" })).toBe("high");
    expect(parseEvalOpenAiLogLevel({ CW_EVAL_VERBOSE_LOG: "true" })).toBe("high");
  });
  it("prefers CW_EVAL_LOG_LEVEL over legacy when valid", () => {
    expect(parseEvalOpenAiLogLevel({ CW_EVAL_LOG_LEVEL: "low", CW_EVAL_VERBOSE_LOG: "1" })).toBe("low");
  });
});

describe("callOpenAiVisionJsonSchema", () => {
  it("parses structured output from Chat Completions choices", async () => {
    const payload = chatCompletionPayload('{"rotation_needed":0,"confidence":"high"}');
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const r = await callOpenAiVisionJsonSchema(
      {
        apiKey: "sk-test",
        model: "gpt-test",
        maxOutputTokens: 100,
        userText: "hi",
        imageUrl: "https://cdn.example.com/tmp/vision/u1/orient-0.jpg",
        schemaName: "orientation_result",
        jsonSchema: orientationJsonSchema as unknown as Record<string, unknown>,
        fetchImpl: fetchImpl as typeof fetch,
      },
      OrientationResultSchema,
    );
    expect(r.rotation_needed).toBe(0);
    expect(r.confidence).toBe("high");
  });

  it("sends HTTPS image_url in request body", async () => {
    const payload = chatCompletionPayload('{"rotation_needed":90,"confidence":"high"}');
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: { role: string; content: { image_url?: { url?: string } }[] }[];
      };
      const userMsg = body.messages.find((m) => m.role === "user");
      const img = userMsg?.content[1]?.image_url?.url;
      expect(img).toBe("https://cdn.example.com/tmp/vision/u1/orient.jpg");
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const r = await callOpenAiVisionJsonSchema(
      {
        apiKey: "sk-test",
        model: "gpt-test",
        maxOutputTokens: 100,
        userText: "hi",
        imageUrl: "https://cdn.example.com/tmp/vision/u1/orient.jpg",
        schemaName: "orientation_result",
        jsonSchema: orientationJsonSchema as unknown as Record<string, unknown>,
        fetchImpl: fetchImpl as typeof fetch,
      },
      OrientationResultSchema,
    );
    expect(r.rotation_needed).toBe(90);
  });

  it("sends data URL when imageBase64 is set", async () => {
    const payload = chatCompletionPayload('{"rotation_needed":0,"confidence":"high"}');
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: { role: string; content: { image_url?: { url?: string } }[] }[];
      };
      const userMsg = body.messages.find((m) => m.role === "user");
      const img = userMsg?.content[1]?.image_url?.url;
      expect(img).toMatch(/^data:image\/jpeg;base64,/);
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await callOpenAiVisionJsonSchema(
      {
        apiKey: "sk-test",
        model: "gpt-test",
        maxOutputTokens: 100,
        userText: "hi",
        imageBase64: "YWJj",
        schemaName: "orientation_result",
        jsonSchema: orientationJsonSchema as unknown as Record<string, unknown>,
        fetchImpl: fetchImpl as typeof fetch,
      },
      OrientationResultSchema,
    );
  });

  it("with openAiLogLevel low logs only model output text", async () => {
    const payload = chatCompletionPayload('{"rotation_needed":0,"confidence":"high"}');
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await callOpenAiVisionJsonSchema(
      {
        apiKey: "sk-test",
        model: "gpt-test",
        maxOutputTokens: 100,
        userText: "hi",
        imageUrl: "https://cdn.example.com/tmp/vision/u1/orient-0.jpg",
        schemaName: "orientation_result",
        jsonSchema: orientationJsonSchema as unknown as Record<string, unknown>,
        fetchImpl: fetchImpl as typeof fetch,
        openAiLogLevel: "low",
      },
      OrientationResultSchema,
    );

    expect(log.mock.calls.some((c) => c[0] === "openai_model_output")).toBe(true);
    expect(log.mock.calls.some((c) => c[0] === "openai_vision_request")).toBe(false);
    log.mockRestore();
  });

  it("sends system message, user image, response_format, and prompt_cache_key", async () => {
    const payload = chatCompletionPayload('{"rotation_needed":0,"confidence":"high"}');
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        prompt_cache_key?: string;
        response_format?: { type: string; json_schema?: { name: string } };
        messages: { role: string; content: string | { type: string; text?: string }[] }[];
      };
      expect(body.prompt_cache_key).toBe("cube:test-cube");
      expect(body.response_format?.type).toBe("json_schema");
      expect(body.response_format?.json_schema?.name).toBe("orientation_result");
      const sys = body.messages.find((m) => m.role === "system");
      expect(sys?.content).toContain("Magic");
      const user = body.messages.find((m) => m.role === "user");
      const parts = user?.content as { type: string; text?: string }[];
      expect(parts[0]?.text).toBe("orient this deck");
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await callOpenAiVisionJsonSchema(
      {
        apiKey: "sk-test",
        model: "gpt-test",
        maxOutputTokens: 100,
        developerText: "Analyze Magic cards.",
        userText: "orient this deck",
        imageUrl: "https://cdn.example.com/tmp/vision/u1/orient.jpg",
        promptCacheKey: "cube:test-cube",
        schemaName: "orientation_result",
        jsonSchema: orientationJsonSchema as unknown as Record<string, unknown>,
        fetchImpl: fetchImpl as typeof fetch,
      },
      OrientationResultSchema,
    );
  });

  it("sends custom cf-aig-request-timeout when requestTimeoutMs is set", async () => {
    const payload = chatCompletionPayload('{"rotation_needed":0,"confidence":"high"}');
    const fetchImpl = vi.fn(async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers["cf-aig-request-timeout"]).toBe("120000");
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await callOpenAiVisionJsonSchema(
      {
        apiKey: "sk-test",
        model: "gpt-test",
        maxOutputTokens: 100,
        userText: "hi",
        imageUrl: "https://cdn.example.com/tmp/vision/u1/orient-0.jpg",
        schemaName: "orientation_result",
        jsonSchema: orientationJsonSchema as unknown as Record<string, unknown>,
        fetchImpl: fetchImpl as typeof fetch,
        requestTimeoutMs: 120_000,
      },
      OrientationResultSchema,
    );
  });

  it("omits reasoning_effort for models that do not support it", async () => {
    const payload = chatCompletionPayload('{"rotation_needed":0,"confidence":"high"}');
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { reasoning_effort?: string; model: string };
      expect(body.model).toBe("gemini-2.5-flash-lite");
      expect(body.reasoning_effort).toBeUndefined();
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await callOpenAiVisionJsonSchema(
      {
        apiKey: "sk-test",
        model: "gemini-2.5-flash-lite",
        maxOutputTokens: 100,
        userText: "hi",
        imageUrl: "https://cdn.example.com/tmp/vision/u1/orient-0.jpg",
        schemaName: "orientation_result",
        jsonSchema: orientationJsonSchema as unknown as Record<string, unknown>,
        reasoningEffort: "medium",
        fetchImpl: fetchImpl as typeof fetch,
      },
      OrientationResultSchema,
    );
  });

  it("includes reasoning_effort for gpt-5 models", async () => {
    const payload = chatCompletionPayload('{"rotation_needed":0,"confidence":"high"}');
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { reasoning_effort?: string };
      expect(body.reasoning_effort).toBe("medium");
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await callOpenAiVisionJsonSchema(
      {
        apiKey: "sk-test",
        model: "gpt-5-mini-2025-08-07",
        maxOutputTokens: 100,
        userText: "hi",
        imageUrl: "https://cdn.example.com/tmp/vision/u1/orient-0.jpg",
        schemaName: "orientation_result",
        jsonSchema: orientationJsonSchema as unknown as Record<string, unknown>,
        reasoningEffort: "medium",
        fetchImpl: fetchImpl as typeof fetch,
      },
      OrientationResultSchema,
    );
  });

  it("defaults to AI Gateway URL and sends cf-aig headers", async () => {
    const payload = chatCompletionPayload('{"rotation_needed":0,"confidence":"high"}');
    const fetchImpl = vi.fn(async (url, init) => {
      expect(String(url)).toBe(`${OPENAI_GATEWAY_BASE_URL_DEFAULT}/chat/completions`);
      const headers = init?.headers as Record<string, string>;
      expect(headers["cf-aig-max-attempts"]).toBe("5");
      expect(headers["cf-aig-request-timeout"]).toBe(String(OPENAI_REQUEST_TIMEOUT_MS_DEFAULT));
      expect(headers.Authorization).toBe("Bearer sk-test");
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await callOpenAiVisionJsonSchema(
      {
        apiKey: "sk-test",
        model: "gpt-test",
        maxOutputTokens: 100,
        userText: "hi",
        imageUrl: "https://cdn.example.com/tmp/vision/u1/orient-0.jpg",
        schemaName: "orientation_result",
        jsonSchema: orientationJsonSchema as unknown as Record<string, unknown>,
        fetchImpl: fetchImpl as typeof fetch,
      },
      OrientationResultSchema,
    );
  });
});
