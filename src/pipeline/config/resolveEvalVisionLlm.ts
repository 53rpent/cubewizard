import { PermanentEvalError } from "../orchestrator/evalErrors";
import {
  OPENAI_GATEWAY_BASE_URL_DEFAULT,
  type OpenAiBaseUrlEnv,
  parseOpenAiRequestTimeoutMs,
} from "./resolveOpenAiBaseUrl";

/** Default vision model when no env override (matches `wrangler-eval-consumer.jsonc`). */
export const DEFAULT_EVAL_VISION_MODEL = "gpt-5-mini-2025-08-07";

export type EvalVisionLlmEnv = OpenAiBaseUrlEnv & {
  EVAL_VISION_MODEL?: string;
  /** Provider API key forwarded by AI Gateway (`Authorization` bearer). */
  EVAL_VISION_API_KEY?: string;
  /** Full gateway or direct API base URL (no `/chat/completions` suffix). */
  EVAL_VISION_BASE_URL?: string;
  /**
   * AI Gateway provider segment when using the default gateway host, e.g. `openai`, `anthropic`, `google-ai-studio`.
   * Ignored when `EVAL_VISION_BASE_URL` or `OPENAI_BASE_URL` is set.
   */
  EVAL_GATEWAY_PROVIDER?: string;
  /** @deprecated Use `EVAL_VISION_MODEL`. */
  OPENAI_VISION_MODEL?: string;
  /** @deprecated Use `EVAL_VISION_API_KEY`. */
  OPENAI_API_KEY?: string;
};

export interface EvalVisionLlmConfig {
  model: string;
  apiKey: string;
  baseUrl: string;
  gatewayToken?: string;
  requestTimeoutMs: number;
}

export function resolveEvalVisionModel(
  env?: Pick<EvalVisionLlmEnv, "EVAL_VISION_MODEL" | "OPENAI_VISION_MODEL">,
): string {
  const model = String(env?.EVAL_VISION_MODEL ?? env?.OPENAI_VISION_MODEL ?? DEFAULT_EVAL_VISION_MODEL).trim();
  if (!model) {
    throw new PermanentEvalError("EVAL_VISION_MODEL_missing");
  }
  return model;
}

export function resolveEvalVisionApiKey(
  env?: Pick<EvalVisionLlmEnv, "EVAL_VISION_API_KEY" | "OPENAI_API_KEY">,
): string {
  const apiKey = String(env?.EVAL_VISION_API_KEY ?? env?.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new PermanentEvalError("EVAL_VISION_API_KEY_missing");
  }
  return apiKey;
}

/**
 * Base URL for Chat Completions (provider-specific AI Gateway path or direct API root).
 * Precedence: `EVAL_VISION_BASE_URL` → `OPENAI_BASE_URL` → default gateway with optional `EVAL_GATEWAY_PROVIDER`.
 */
export function resolveEvalVisionBaseUrl(
  env?: Pick<EvalVisionLlmEnv, "EVAL_VISION_BASE_URL" | "OPENAI_BASE_URL" | "EVAL_GATEWAY_PROVIDER">,
): string {
  const explicit = String(env?.EVAL_VISION_BASE_URL ?? env?.OPENAI_BASE_URL ?? "").trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  const provider = String(env?.EVAL_GATEWAY_PROVIDER ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  if (provider) {
    const gwRoot = OPENAI_GATEWAY_BASE_URL_DEFAULT.replace(/\/openai\/?$/, "");
    return `${gwRoot}/${provider}`;
  }

  return OPENAI_GATEWAY_BASE_URL_DEFAULT;
}

export function resolveEvalVisionLlm(env: EvalVisionLlmEnv): EvalVisionLlmConfig {
  return {
    model: resolveEvalVisionModel(env),
    apiKey: resolveEvalVisionApiKey(env),
    baseUrl: resolveEvalVisionBaseUrl(env),
    gatewayToken: String(env.OPENAI_GATEWAY_TOKEN ?? "").trim() || undefined,
    requestTimeoutMs: parseOpenAiRequestTimeoutMs(env),
  };
}
