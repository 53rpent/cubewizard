import type { ZodType } from "zod";
import { buildOpenAiRequestHeaders, resolveOpenAiBaseUrl } from "../config/resolveOpenAiBaseUrl";
import { extractOpenAiUsageFromResponse, getActiveEvalUsageReporter } from "../evalUsage/evalUsageReport";
import { getActiveEvalConsumerUploadId, isEvalConsumerLogActive, logEvalConsumer } from "../util/evalConsumerLog";
import type { CardExtractionResult, OrientationConfirmResult, OrientationResult } from "./schemas";

/** Eval consumer OpenAI console logging (see `CW_EVAL_LOG_LEVEL` / legacy `CW_EVAL_VERBOSE_LOG`). */
export type EvalOpenAiLogLevel = "off" | "low" | "medium" | "high";

/**
 * Parses `CW_EVAL_LOG_LEVEL` (`off` | `low` | `medium` | `high`).
 * Legacy: `CW_EVAL_VERBOSE_LOG=1|true|yes` maps to `high` when `CW_EVAL_LOG_LEVEL` is unset/invalid.
 */
export function parseEvalOpenAiLogLevel(env: {
  CW_EVAL_LOG_LEVEL?: string;
  CW_EVAL_VERBOSE_LOG?: string;
}): EvalOpenAiLogLevel {
  const raw = String(env.CW_EVAL_LOG_LEVEL ?? "")
    .trim()
    .toLowerCase();
  if (raw === "off" || raw === "low" || raw === "medium" || raw === "high") return raw;
  if (/^1|true|yes$/i.test(String(env.CW_EVAL_VERBOSE_LOG ?? "").trim())) return "high";
  return "off";
}

export class ModelOutputInvalidError extends Error {
  readonly code = "model_output_invalid" as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "ModelOutputInvalidError";
    if (options?.cause !== undefined) (this as Error & { cause?: unknown }).cause = options.cause;
  }
}

export class OpenAiApiError extends Error {
  readonly bodySnippet: string;

  constructor(
    message: string,
    readonly status: number,
    bodySnippet: string,
  ) {
    super(message);
    this.name = "OpenAiApiError";
    this.bodySnippet = bodySnippet;
  }
}

function messageContentAsJsonText(message: Record<string, unknown>): string | null {
  const parsed = message.parsed;
  if (parsed !== undefined && parsed !== null) {
    if (typeof parsed === "string" && parsed.trim()) return parsed;
    try {
      return JSON.stringify(parsed);
    } catch {
      return null;
    }
  }
  const content = message.content;
  if (typeof content === "string" && content.trim()) return content;
  return null;
}

/** Extract JSON text from a Chat Completions (OpenAI-compatible) response body. */
function extractStructuredText(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const choices = (data as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!first || typeof first !== "object") return null;
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== "object") return null;
  return messageContentAsJsonText(message as Record<string, unknown>);
}

/** Hosted: HTTPS URL the provider fetches (R2 presigned or public CDN). Local: inline base64. */
export type VisionImageInput = { imageUrl: string } | { imageBase64: string };

export type VisionJsonCallOptions = {
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  reasoningEffort?: "low" | "medium" | "high";
  /** Static rules / cube list prefix (cached when ≥1024 tokens). */
  developerText?: string;
  userText: string;
  /** OpenAI `prompt_cache_key` — reuse prefix across passes/uploads for same cube. */
  promptCacheKey?: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  /** OpenAI `strict` JSON schema mode (requires exhaustive `required`); default false for optional fields. */
  strictJsonSchema?: boolean;
  /** Provider base URL (no `/chat/completions` suffix). Defaults to AI Gateway. */
  baseUrl?: string;
  /** `cf-aig-authorization` when Authenticated Gateway is enabled. */
  gatewayToken?: string;
  /** AI Gateway upstream timeout (`cf-aig-request-timeout`, ms). Ignored for direct OpenAI base URLs. */
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  /**
   * `off`: no extra logs. `low`: one line per call with model structured output only (`openai_model_output` + schema name + JSON text).
   * `medium`: human-readable phase lines; multi-pass labels live in `extractCardNamesFromRgba`.
   * `high`: request metadata, raw JSON (truncated), structured text, parsed object — same as legacy `CW_EVAL_VERBOSE_LOG=1`.
   */
  openAiLogLevel?: EvalOpenAiLogLevel;
} & VisionImageInput;

function resolveInputImageUrl(opts: VisionJsonCallOptions): string {
  if ("imageUrl" in opts) {
    const url = opts.imageUrl.trim();
    if (url) return url;
  }
  if ("imageBase64" in opts) {
    const b64 = opts.imageBase64.trim();
    if (b64) {
      return b64.startsWith("data:") ? b64 : `data:image/jpeg;base64,${b64}`;
    }
  }
  throw new ModelOutputInvalidError("vision call requires imageUrl or imageBase64");
}

function buildVisionMessages(opts: VisionJsonCallOptions): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];
  const developer = opts.developerText?.trim();
  if (developer) {
    messages.push({ role: "system", content: developer });
  }
  messages.push({
    role: "user",
    content: [
      { type: "text", text: opts.userText },
      { type: "image_url", image_url: { url: resolveInputImageUrl(opts) } },
    ],
  });
  return messages;
}

/**
 * OpenAI-compatible **Chat Completions** with `response_format` JSON schema, then Zod-parse output.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: vision request, logging, HTTP handling, and schema validation in one call site
export async function callOpenAiVisionJsonSchema<T>(opts: VisionJsonCallOptions, zodSchema: ZodType<T>): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);

  const body: Record<string, unknown> = {
    model: opts.model,
    max_completion_tokens: opts.maxOutputTokens,
    messages: buildVisionMessages(opts),
    response_format: {
      type: "json_schema",
      json_schema: {
        name: opts.schemaName,
        strict: opts.strictJsonSchema ?? false,
        schema: opts.jsonSchema,
      },
    },
  };

  if (opts.reasoningEffort) {
    body.reasoning_effort = opts.reasoningEffort;
  }
  if (opts.promptCacheKey?.trim()) {
    body.prompt_cache_key = opts.promptCacheKey.trim();
  }

  const level = opts.openAiLogLevel ?? "off";
  const evalVerbose = level === "high";
  const mediumLog = level === "medium";

  if (evalVerbose) {
    console.log("openai_vision_request", {
      schema: opts.schemaName,
      model: opts.model,
      max_completion_tokens: opts.maxOutputTokens,
      reasoning_effort: opts.reasoningEffort ?? null,
      prompt_cache_key: opts.promptCacheKey ?? null,
      developer_text_len: opts.developerText?.length ?? 0,
      image_url: "imageUrl" in opts ? ((opts.imageUrl as string | undefined) ?? null) : null,
      image_base64_len: "imageBase64" in opts ? opts.imageBase64.length : null,
      user_text_len: opts.userText.length,
    });
  }

  if (isEvalConsumerLogActive()) {
    const uploadId = getActiveEvalConsumerUploadId() ?? getActiveEvalUsageReporter()?.uploadId ?? null;
    logEvalConsumer("openai_request", {
      schema: opts.schemaName,
      model: opts.model,
      max_completion_tokens: opts.maxOutputTokens,
      reasoning_effort: opts.reasoningEffort ?? null,
      prompt_cache_key: opts.promptCacheKey ?? null,
      upload_id: uploadId,
      image_url: "imageUrl" in opts ? (opts.imageUrl.trim() ? "(url)" : null) : null,
      image_base64_len: "imageBase64" in opts ? (opts.imageBase64.length ?? null) : null,
      user_text_len: opts.userText.length,
    });
  }

  const baseUrl = resolveOpenAiBaseUrl(opts.baseUrl !== undefined ? { OPENAI_BASE_URL: opts.baseUrl } : undefined);
  const chatUrl = `${baseUrl}/chat/completions`;
  const headers = buildOpenAiRequestHeaders(opts.apiKey, baseUrl, {
    gatewayToken: opts.gatewayToken,
    requestTimeoutMs: opts.requestTimeoutMs,
  });

  const res = await fetchImpl(chatUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const rawText = await res.text();
  if (evalVerbose) {
    const cap = 24_000;
    console.log(
      "openai_vision_response_raw",
      rawText.length > cap ? `${rawText.slice(0, cap)}\n…truncated (${rawText.length} chars total)` : rawText,
    );
  }
  if (!res.ok) {
    throw new OpenAiApiError(`OpenAI chat completions HTTP ${res.status}`, res.status, rawText.slice(0, 800));
  }

  let json: unknown;
  try {
    json = JSON.parse(rawText) as unknown;
  } catch (e) {
    throw new ModelOutputInvalidError("OpenAI response body is not JSON", { cause: e });
  }

  getActiveEvalUsageReporter()?.recordOpenAiResponse(opts.schemaName, res.status, json);

  if (isEvalConsumerLogActive()) {
    const usage = extractOpenAiUsageFromResponse(json);
    const uploadId = getActiveEvalConsumerUploadId() ?? getActiveEvalUsageReporter()?.uploadId ?? null;
    logEvalConsumer("openai_response", {
      schema: opts.schemaName,
      status: res.status,
      upload_id: uploadId,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens,
      cached_input_tokens: usage.cached_input_tokens,
    });
  }

  const text = extractStructuredText(json);
  if (level === "low" && text) {
    console.log("openai_model_output", opts.schemaName, text);
  }
  if (evalVerbose && text) {
    const cap = 12_000;
    console.log(
      "openai_vision_structured_text",
      text.length > cap ? `${text.slice(0, cap)}\n…truncated (${text.length} chars)` : text,
    );
  }
  if (!text) {
    throw new ModelOutputInvalidError("OpenAI response missing structured text output", {
      cause: json,
    });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text) as unknown;
  } catch (e) {
    throw new ModelOutputInvalidError("Structured output is not valid JSON", { cause: e });
  }

  const parsed = zodSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new ModelOutputInvalidError(parsed.error.message, { cause: parsed.error });
  }
  if (mediumLog) {
    if (opts.schemaName === "orientation_result") {
      const r = parsed.data as OrientationResult;
      console.log(`Orientation detection: ${r.rotation_needed}° rotation needed (${r.confidence} confidence)`);
      if (r.reasoning) console.log(`Reasoning: ${r.reasoning}`);
    } else if (opts.schemaName === "orientation_confirm") {
      const r = parsed.data as OrientationConfirmResult;
      console.log(`Orientation confirm: ${r.correctly_oriented ? "yes" : "no"}`);
    } else if (opts.schemaName === "card_extraction") {
      const r = parsed.data as CardExtractionResult;
      console.log(`Extraction confidence: ${r.confidence_level}`);
      console.log(`Cards detected in image: ${r.card_names.length}`);
      if (r.notes) console.log(`Notes: ${r.notes}`);
    }
  }
  if (evalVerbose) {
    console.log("openai_vision_parsed", parsed.data);
  }
  return parsed.data;
}
