/** Default AI Gateway base (local, stg, prod). Keep in sync with `wrangler-eval-consumer.jsonc`. */
export const OPENAI_GATEWAY_BASE_URL_DEFAULT =
  "https://gateway.ai.cloudflare.com/v1/82dc60a1fbcc9e8767c55a198d0dd22c/cubewizard/openai";

/** Keep in sync with `wrangler-eval-consumer.jsonc`. */
export const CLOUDFLARE_ACCOUNT_ID_DEFAULT = "82dc60a1fbcc9e8767c55a198d0dd22c";

/** Gateway slug in `gateway.ai.cloudflare.com/v1/{account}/{name}/…`. */
export const AI_GATEWAY_NAME_DEFAULT = "cubewizard";

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

export function isCloudflareManagedAiBaseUrl(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl);
    if (u.hostname === "gateway.ai.cloudflare.com") return true;
    return u.hostname === "api.cloudflare.com" && /\/accounts\/[^/]+\/ai\/v1\/?$/.test(u.pathname);
  } catch {
    return false;
  }
}

export function isAiGatewayBaseUrl(baseUrl: string): boolean {
  return isCloudflareManagedAiBaseUrl(baseUrl);
}

export function resolveCloudflareAccountId(env?: { CLOUDFLARE_ACCOUNT_ID?: string }): string {
  const id = String(env?.CLOUDFLARE_ACCOUNT_ID ?? CLOUDFLARE_ACCOUNT_ID_DEFAULT).trim();
  return id || CLOUDFLARE_ACCOUNT_ID_DEFAULT;
}

export function parseAiGatewayNameFromGatewayUrl(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    if (parts[0] !== "v1" || parts.length < 3) return null;
    return parts[2] ?? null;
  } catch {
    return null;
  }
}

export function resolveAiGatewayName(env?: { AI_GATEWAY_NAME?: string; OPENAI_BASE_URL?: string }): string {
  const explicit = String(env?.AI_GATEWAY_NAME ?? "").trim();
  if (explicit) return explicit;
  return parseAiGatewayNameFromGatewayUrl(String(env?.OPENAI_BASE_URL ?? OPENAI_GATEWAY_BASE_URL_DEFAULT)) ?? AI_GATEWAY_NAME_DEFAULT;
}

/** Cloudflare account REST API — Workers AI via AI Gateway (`cf-aig-gateway-id` required). */
export function buildCloudflareAiRestV1BaseUrl(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
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
  opts?: { gatewayToken?: string; requestTimeoutMs?: number; aiGatewayId?: string },
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (!isCloudflareManagedAiBaseUrl(baseUrl)) return headers;

  const requestTimeoutMs = opts?.requestTimeoutMs ?? OPENAI_REQUEST_TIMEOUT_MS_DEFAULT;
  headers["cf-aig-max-attempts"] = "5";
  headers["cf-aig-retry-delay"] = "2000";
  headers["cf-aig-backoff"] = "exponential";
  headers["cf-aig-request-timeout"] = String(requestTimeoutMs);

  const gatewayId = String(opts?.aiGatewayId ?? "").trim();
  if (gatewayId) {
    headers["cf-aig-gateway-id"] = gatewayId;
  }

  const token = String(opts?.gatewayToken ?? "").trim();
  if (token) {
    headers["cf-aig-authorization"] = `Bearer ${token}`;
  }

  return headers;
}
