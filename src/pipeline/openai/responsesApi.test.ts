import { describe, expect, it, vi } from "vitest";
import { callOpenAiVisionJsonSchema, parseEvalOpenAiLogLevel } from "./responsesApi";
import { OrientationResultSchema } from "./schemas";
import { orientationJsonSchema } from "./jsonSchemas";

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
    expect(
      parseEvalOpenAiLogLevel({ CW_EVAL_LOG_LEVEL: "low", CW_EVAL_VERBOSE_LOG: "1" })
    ).toBe("low");
  });
});

describe("callOpenAiVisionJsonSchema", () => {
  it("parses structured output text from Responses API shape", async () => {
    const payload = {
      output: [
        {
          content: [{ type: "output_text", text: '{"rotation_needed":0,"confidence":"high"}' }],
        },
      ],
    };
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
      OrientationResultSchema
    );
    expect(r.rotation_needed).toBe(0);
    expect(r.confidence).toBe("high");
  });

  it("sends HTTPS image_url in request body", async () => {
    const payload = {
      output: [
        {
          content: [{ type: "output_text", text: '{"rotation_needed":90,"confidence":"high"}' }],
        },
      ],
    };
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        input: { content: { image_url?: string }[] }[];
      };
      const img = body.input[0]?.content[1]?.image_url;
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
      OrientationResultSchema
    );
    expect(r.rotation_needed).toBe(90);
  });

  it("sends data URL when imageBase64 is set", async () => {
    const payload = {
      output: [
        {
          content: [{ type: "output_text", text: '{"rotation_needed":0,"confidence":"high"}' }],
        },
      ],
    };
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        input: { content: { image_url?: string }[] }[];
      };
      const img = body.input[0]?.content[1]?.image_url;
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
      OrientationResultSchema
    );
  });

  it("with openAiLogLevel low logs only model output text", async () => {
    const payload = {
      output: [
        {
          content: [{ type: "output_text", text: '{"rotation_needed":0,"confidence":"high"}' }],
        },
      ],
    };
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
      OrientationResultSchema
    );

    expect(log.mock.calls.some((c) => c[0] === "openai_model_output")).toBe(true);
    expect(log.mock.calls.some((c) => c[0] === "openai_vision_request")).toBe(false);
    log.mockRestore();
  });
});
