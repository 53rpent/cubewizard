/** Default AI Gateway base (local, stg, prod). Keep in sync with `wrangler-eval-consumer.jsonc`. */
export const OPENAI_GATEWAY_BASE_URL_DEFAULT =
  "https://gateway.ai.cloudflare.com/v1/82dc60a1fbcc9e8767c55a198d0dd22c/cubewizard/openai";

/** Direct OpenAI — opt-out via `OPENAI_BASE_URL` in `.dev.vars`. */
export const OPENAI_DIRECT_BASE_URL = "https://api.openai.com/v1";

/** Default `cf-aig-request-timeout` (ms) when using Cloudflare AI Gateway. */
export const OPENAI_REQUEST_TIMEOUT_MS_DEFAULT = 300_000;

export interface OpenAiBaseUrlEnv {
  OPENAI_BASE_URL?: string;
  /** When Authenticated Gateway is enabled in the dashboard. */
  OPENAI_GATEWAY_TOKEN?: string;
  /** Per-request upstream timeout for AI Gateway (`cf-aig-request-timeout`). */
  OPENAI_REQUEST_TIMEOUT_MS?: string;
}

export function parseOpenAiRequestTimeoutMs(env?: Pick<OpenAiBaseUrlEnv, "OPENAI_REQUEST_TIMEOUT_MS">): number {
  const raw = parseInt(String(env?.OPENAI_REQUEST_TIMEOUT_MS ?? ""), 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return OPENAI_REQUEST_TIMEOUT_MS_DEFAULT;
}

export function isAiGatewayBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === "gateway.ai.cloudflare.com";
  } catch {
    return false;
  }
}

export function resolveOpenAiBaseUrl(env?: OpenAiBaseUrlEnv): string {
  const raw = String(env?.OPENAI_BASE_URL ?? "").trim();
  const base = raw || OPENAI_GATEWAY_BASE_URL_DEFAULT;
  return base.replace(/\/+$/, "");
}

export function resolveOpenAiChatCompletionsUrl(env?: OpenAiBaseUrlEnv): string {
  return `${resolveOpenAiBaseUrl(env)}/chat/completions`;
}

export function buildOpenAiRequestHeaders(
  apiKey: string,
  baseUrl: string,
  opts?: { gatewayToken?: string; requestTimeoutMs?: number },
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (!isAiGatewayBaseUrl(baseUrl)) return headers;

  const requestTimeoutMs = opts?.requestTimeoutMs ?? OPENAI_REQUEST_TIMEOUT_MS_DEFAULT;
  headers["cf-aig-max-attempts"] = "5";
  headers["cf-aig-retry-delay"] = "2000";
  headers["cf-aig-backoff"] = "exponential";
  headers["cf-aig-request-timeout"] = String(requestTimeoutMs);

  const token = String(opts?.gatewayToken ?? "").trim();
  if (token) {
    headers["cf-aig-authorization"] = `Bearer ${token}`;
  }

  return headers;
}
