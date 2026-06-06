import { PermanentEvalError } from "../orchestrator/evalErrors";
import {
  buildCloudflareAiRestV1BaseUrl,
  OPENAI_GATEWAY_BASE_URL_DEFAULT,
  type OpenAiBaseUrlEnv,
  parseOpenAiRequestTimeoutMs,
  resolveAiGatewayName,
  resolveCloudflareAccountId,
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
   * `workers-ai` uses the Cloudflare account REST API (`api.cloudflare.com/.../ai/v1`) instead.
   * Ignored when `EVAL_VISION_BASE_URL` is set.
   */
  EVAL_GATEWAY_PROVIDER?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  /** Gateway slug for Workers AI REST API (`cf-aig-gateway-id`). Defaults to name in wrangler `OPENAI_BASE_URL`. */
  AI_GATEWAY_NAME?: string;
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
  /** Required for Workers AI REST API (`cf-aig-gateway-id`). */
  aiGatewayId?: string;
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
 * Precedence: `EVAL_VISION_BASE_URL` → `EVAL_GATEWAY_PROVIDER` → `OPENAI_BASE_URL` → default openai gateway.
 */
export function resolveEvalVisionBaseUrl(
  env?: Pick<
    EvalVisionLlmEnv,
    "EVAL_VISION_BASE_URL" | "OPENAI_BASE_URL" | "EVAL_GATEWAY_PROVIDER" | "CLOUDFLARE_ACCOUNT_ID"
  >,
): string {
  const visionBase = String(env?.EVAL_VISION_BASE_URL ?? "").trim();
  if (visionBase) {
    return visionBase.replace(/\/+$/, "");
  }

  const provider = String(env?.EVAL_GATEWAY_PROVIDER ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  if (provider === "workers-ai") {
    return buildCloudflareAiRestV1BaseUrl(resolveCloudflareAccountId(env));
  }
  if (provider) {
    const gwRoot = OPENAI_GATEWAY_BASE_URL_DEFAULT.replace(/\/openai\/?$/, "");
    return `${gwRoot}/${provider}`;
  }

  const legacyBase = String(env?.OPENAI_BASE_URL ?? "").trim();
  if (legacyBase) {
    return legacyBase.replace(/\/+$/, "");
  }

  return OPENAI_GATEWAY_BASE_URL_DEFAULT;
}

function normalizeGatewayProvider(env?: Pick<EvalVisionLlmEnv, "EVAL_GATEWAY_PROVIDER">): string {
  return String(env?.EVAL_GATEWAY_PROVIDER ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
}

export function resolveEvalVisionLlm(env: EvalVisionLlmEnv): EvalVisionLlmConfig {
  const provider = normalizeGatewayProvider(env);
  return {
    model: resolveEvalVisionModel(env),
    apiKey: resolveEvalVisionApiKey(env),
    baseUrl: resolveEvalVisionBaseUrl(env),
    gatewayToken: String(env.OPENAI_GATEWAY_TOKEN ?? "").trim() || undefined,
    aiGatewayId: provider === "workers-ai" ? resolveAiGatewayName(env) : undefined,
    requestTimeoutMs: parseOpenAiRequestTimeoutMs(env),
  };
}
