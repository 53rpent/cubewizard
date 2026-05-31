import { describe, expect, it } from "vitest";
import {
  buildOpenAiRequestHeaders,
  isAiGatewayBaseUrl,
  OPENAI_DIRECT_BASE_URL,
  OPENAI_GATEWAY_BASE_URL_DEFAULT,
  resolveOpenAiBaseUrl,
  resolveOpenAiResponsesUrl,
} from "./resolveOpenAiBaseUrl";

describe("resolveOpenAiBaseUrl", () => {
  it("defaults to AI Gateway when OPENAI_BASE_URL is unset", () => {
    expect(resolveOpenAiBaseUrl({})).toBe(OPENAI_GATEWAY_BASE_URL_DEFAULT);
    expect(resolveOpenAiBaseUrl()).toBe(OPENAI_GATEWAY_BASE_URL_DEFAULT);
  });

  it("uses env override and strips trailing slash", () => {
    expect(resolveOpenAiBaseUrl({ OPENAI_BASE_URL: `${OPENAI_DIRECT_BASE_URL}/` })).toBe(OPENAI_DIRECT_BASE_URL);
  });

  it("builds responses URL", () => {
    expect(resolveOpenAiResponsesUrl({ OPENAI_BASE_URL: OPENAI_DIRECT_BASE_URL })).toBe(
      `${OPENAI_DIRECT_BASE_URL}/responses`,
    );
  });

  it("detects gateway hostname", () => {
    expect(isAiGatewayBaseUrl(OPENAI_GATEWAY_BASE_URL_DEFAULT)).toBe(true);
    expect(isAiGatewayBaseUrl(OPENAI_DIRECT_BASE_URL)).toBe(false);
    expect(isAiGatewayBaseUrl("not-a-url")).toBe(false);
  });

  it("adds cf-aig headers for gateway base only", () => {
    const direct = buildOpenAiRequestHeaders("sk-test", OPENAI_DIRECT_BASE_URL);
    expect(direct["cf-aig-max-attempts"]).toBeUndefined();
    expect(direct.Authorization).toBe("Bearer sk-test");

    const gw = buildOpenAiRequestHeaders("sk-test", OPENAI_GATEWAY_BASE_URL_DEFAULT);
    expect(gw["cf-aig-max-attempts"]).toBe("5");
    expect(gw["cf-aig-retry-delay"]).toBe("2000");
    expect(gw["cf-aig-backoff"]).toBe("exponential");
    expect(gw["cf-aig-request-timeout"]).toBe("30000");
  });

  it("adds cf-aig-authorization when gateway token provided", () => {
    const gw = buildOpenAiRequestHeaders("sk-test", OPENAI_GATEWAY_BASE_URL_DEFAULT, "gw-token");
    expect(gw["cf-aig-authorization"]).toBe("Bearer gw-token");
  });
});
