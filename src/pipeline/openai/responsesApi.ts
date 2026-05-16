import type { ZodType } from "zod";
import type { CardExtractionResult, OrientationResult } from "./schemas";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

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
  const raw = String(env.CW_EVAL_LOG_LEVEL ?? "").trim().toLowerCase();
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
  constructor(
    message: string,
    readonly status: number,
    readonly bodySnippet: string
  ) {
    super(message);
    this.name = "OpenAiApiError";
  }
}

function extractStructuredText(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const root = data as Record<string, unknown>;

  const parsed = root.output_parsed ?? root.output_text;
  if (typeof parsed === "string" && parsed.trim()) return parsed;

  const out = root.output;
  if (!Array.isArray(out)) return null;
  for (const block of out) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    const content = b.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const p = part as Record<string, unknown>;
      const text = p.text;
      if (typeof text === "string" && text.trim()) return text;
    }
  }
  return null;
}

/** Hosted: HTTPS URL OpenAI fetches (R2 presigned or public CDN). Local: inline base64. */
export type VisionImageInput = { imageUrl: string } | { imageBase64: string };

export type VisionJsonCallOptions = {
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  reasoningEffort?: "low" | "medium" | "high";
  userText: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  /** OpenAI `strict` JSON schema mode (requires exhaustive `required`); default false for optional fields. */
  strictJsonSchema?: boolean;
  fetchImpl?: typeof fetch;
  /**
   * `off`: no extra logs. `low`: one line per call with model structured output only (`openai_model_output` + schema name + JSON text).
   * `medium`: human-readable lines matching legacy GCP/Python (`image_processor.py`); multi-pass phase labels live in `extractCardNamesFromRgba`.
   * `high`: request metadata, raw JSON (truncated), structured text, parsed object — same as legacy `CW_EVAL_VERBOSE_LOG=1`.
   */
  openAiLogLevel?: EvalOpenAiLogLevel;
} & VisionImageInput;

function resolveInputImageUrl(opts: VisionJsonCallOptions): string {
  const url = opts.imageUrl?.trim();
  if (url) return url;
  const b64 = opts.imageBase64?.trim();
  if (b64) {
    return b64.startsWith("data:") ? b64 : `data:image/jpeg;base64,${b64}`;
  }
  throw new ModelOutputInvalidError("vision call requires imageUrl or imageBase64");
}

/**
 * OpenAI **Responses** API with `text.format.type = json_schema`, then Zod-parse output.
 */
export async function callOpenAiVisionJsonSchema<T>(
  opts: VisionJsonCallOptions,
  zodSchema: ZodType<T>
): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);

  const body: Record<string, unknown> = {
    model: opts.model,
    max_output_tokens: opts.maxOutputTokens,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: opts.userText },
          {
            type: "input_image",
            image_url: resolveInputImageUrl(opts),
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: opts.schemaName,
        strict: opts.strictJsonSchema ?? false,
        schema: opts.jsonSchema,
      },
    },
  };

  if (opts.reasoningEffort) {
    body.reasoning = { effort: opts.reasoningEffort };
  }

  const level = opts.openAiLogLevel ?? "off";
  const evalVerbose = level === "high";
  const gcpStyle = level === "medium";

  if (evalVerbose) {
    console.log("openai_vision_request", {
      schema: opts.schemaName,
      model: opts.model,
      max_output_tokens: opts.maxOutputTokens,
      reasoning_effort: opts.reasoningEffort ?? null,
      image_url: opts.imageUrl ?? null,
      image_base64_len: opts.imageBase64?.length ?? null,
      user_text_len: opts.userText.length,
    });
  }

  const res = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const rawText = await res.text();
  if (evalVerbose) {
    const cap = 24_000;
    console.log(
      "openai_vision_response_raw",
      rawText.length > cap ? `${rawText.slice(0, cap)}\n…truncated (${rawText.length} chars total)` : rawText
    );
  }
  if (!res.ok) {
    throw new OpenAiApiError(
      `OpenAI responses HTTP ${res.status}`,
      res.status,
      rawText.slice(0, 800)
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(rawText) as unknown;
  } catch (e) {
    throw new ModelOutputInvalidError("OpenAI response body is not JSON", { cause: e });
  }

  const text = extractStructuredText(json);
  if (level === "low" && text) {
    console.log("openai_model_output", opts.schemaName, text);
  }
  if (evalVerbose && text) {
    const cap = 12_000;
    console.log(
      "openai_vision_structured_text",
      text.length > cap ? `${text.slice(0, cap)}\n…truncated (${text.length} chars)` : text
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
  if (gcpStyle) {
    if (opts.schemaName === "orientation_result") {
      const r = parsed.data as OrientationResult;
      console.log(
        `Orientation detection: ${r.rotation_needed}° rotation needed (${r.confidence} confidence)`
      );
      if (r.reasoning) console.log(`Reasoning: ${r.reasoning}`);
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
