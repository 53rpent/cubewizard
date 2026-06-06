import { describe, expect, it } from "vitest";
import {
  buildCloudflareAiRestV1BaseUrl,
  buildOpenAiRequestHeaders,
  isAiGatewayBaseUrl,
  OPENAI_DIRECT_BASE_URL,
  OPENAI_GATEWAY_BASE_URL_DEFAULT,
  OPENAI_REQUEST_TIMEOUT_MS_DEFAULT,
  parseOpenAiRequestTimeoutMs,
  resolveOpenAiBaseUrl,
  resolveOpenAiChatCompletionsUrl,
} from "./resolveOpenAiBaseUrl";

describe("resolveOpenAiBaseUrl", () => {
  it("defaults to AI Gateway when OPENAI_BASE_URL is unset", () => {
    expect(resolveOpenAiBaseUrl({})).toBe(OPENAI_GATEWAY_BASE_URL_DEFAULT);
    expect(resolveOpenAiBaseUrl()).toBe(OPENAI_GATEWAY_BASE_URL_DEFAULT);
  });

  it("uses env override and strips trailing slash", () => {
    expect(resolveOpenAiBaseUrl({ OPENAI_BASE_URL: `${OPENAI_DIRECT_BASE_URL}/` })).toBe(OPENAI_DIRECT_BASE_URL);
  });

  it("builds chat completions URL", () => {
    expect(resolveOpenAiChatCompletionsUrl({ OPENAI_BASE_URL: OPENAI_DIRECT_BASE_URL })).toBe(
      `${OPENAI_DIRECT_BASE_URL}/chat/completions`,
    );
  });

  it("detects gateway hostname and Cloudflare account REST API", () => {
    expect(isAiGatewayBaseUrl(OPENAI_GATEWAY_BASE_URL_DEFAULT)).toBe(true);
    expect(isAiGatewayBaseUrl(buildCloudflareAiRestV1BaseUrl("abc123"))).toBe(true);
    expect(isAiGatewayBaseUrl(OPENAI_DIRECT_BASE_URL)).toBe(false);
    expect(isAiGatewayBaseUrl("not-a-url")).toBe(false);
  });

  it("parses OPENAI_REQUEST_TIMEOUT_MS with default 300000", () => {
    expect(parseOpenAiRequestTimeoutMs({})).toBe(OPENAI_REQUEST_TIMEOUT_MS_DEFAULT);
    expect(parseOpenAiRequestTimeoutMs({ OPENAI_REQUEST_TIMEOUT_MS: "120000" })).toBe(120_000);
    expect(parseOpenAiRequestTimeoutMs({ OPENAI_REQUEST_TIMEOUT_MS: "0" })).toBe(OPENAI_REQUEST_TIMEOUT_MS_DEFAULT);
  });

  it("adds cf-aig headers for gateway base only", () => {
    const direct = buildOpenAiRequestHeaders("sk-test", OPENAI_DIRECT_BASE_URL);
    expect(direct["cf-aig-max-attempts"]).toBeUndefined();
    expect(direct.Authorization).toBe("Bearer sk-test");

    const gw = buildOpenAiRequestHeaders("sk-test", OPENAI_GATEWAY_BASE_URL_DEFAULT);
    expect(gw["cf-aig-max-attempts"]).toBe("5");
    expect(gw["cf-aig-retry-delay"]).toBe("2000");
    expect(gw["cf-aig-backoff"]).toBe("exponential");
    expect(gw["cf-aig-request-timeout"]).toBe(String(OPENAI_REQUEST_TIMEOUT_MS_DEFAULT));
  });

  it("adds cf-aig-authorization when gateway token provided", () => {
    const gw = buildOpenAiRequestHeaders("sk-test", OPENAI_GATEWAY_BASE_URL_DEFAULT, {
      gatewayToken: "gw-token",
    });
    expect(gw["cf-aig-authorization"]).toBe("Bearer gw-token");
  });

  it("adds cf-aig-gateway-id for Workers AI REST API", () => {
    const rest = buildCloudflareAiRestV1BaseUrl("abc123");
    const headers = buildOpenAiRequestHeaders("cfut_test", rest, { aiGatewayId: "cubewizard" });
    expect(headers["cf-aig-gateway-id"]).toBe("cubewizard");
    expect(headers["cf-aig-request-timeout"]).toBe(String(OPENAI_REQUEST_TIMEOUT_MS_DEFAULT));
  });
});
