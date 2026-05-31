/** Default AI Gateway base (local, stg, prod). Keep in sync with `wrangler-eval-consumer.jsonc`. */
export const OPENAI_GATEWAY_BASE_URL_DEFAULT =
  "https://gateway.ai.cloudflare.com/v1/82dc60a1fbcc9e8767c55a198d0dd22c/cubewizard/openai";

/** Direct OpenAI — opt-out via `OPENAI_BASE_URL` in `.dev.vars`. */
export const OPENAI_DIRECT_BASE_URL = "https://api.openai.com/v1";

export interface OpenAiBaseUrlEnv {
  OPENAI_BASE_URL?: string;
  /** When Authenticated Gateway is enabled in the dashboard. */
  OPENAI_GATEWAY_TOKEN?: string;
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

export function resolveOpenAiResponsesUrl(env?: OpenAiBaseUrlEnv): string {
  return `${resolveOpenAiBaseUrl(env)}/responses`;
}

export function buildOpenAiRequestHeaders(
  apiKey: string,
  baseUrl: string,
  gatewayToken?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (!isAiGatewayBaseUrl(baseUrl)) return headers;

  headers["cf-aig-max-attempts"] = "5";
  headers["cf-aig-retry-delay"] = "2000";
  headers["cf-aig-backoff"] = "exponential";
  headers["cf-aig-request-timeout"] = "30000";

  const token = String(gatewayToken ?? "").trim();
  if (token) {
    headers["cf-aig-authorization"] = `Bearer ${token}`;
  }

  return headers;
}
