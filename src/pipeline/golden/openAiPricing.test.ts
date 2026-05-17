import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeUsageCostUsd,
  loadOpenAiPricingCsv,
  matchPricingRates,
  resolveOpenAiModelPricing,
} from "./openAiPricing";

const REPO_ROOT = join(__dirname, "../../..");

describe("openAiPricing", () => {
  it("loads bundled CSV and resolves gpt-5-mini rates", () => {
    const rates = resolveOpenAiModelPricing("gpt-5-mini-2025-08-07", REPO_ROOT);
    expect(rates.source).toBe("pricing_csv");
    expect(rates.usd_per_1m_input).toBe(0.25);
    expect(rates.usd_per_1m_cached_input).toBe(0.025);
    expect(rates.usd_per_1m_output).toBe(2);
  });

  it("matches dated model ids via prefix when only base name is in table", () => {
    const table = loadOpenAiPricingCsv(
      "model_id,usd_per_1m_input,usd_per_1m_cached_input,usd_per_1m_output,tier,pricing_as_of\n" +
        "gpt-5-mini,0.25,0.025,2,standard,2026-05-17\n"
    );
    const m = matchPricingRates("gpt-5-mini-2099-01-01", table);
    expect(m?.usd_per_1m_output).toBe(2);
  });

  it("computes USD from token counts", () => {
    const cost = computeUsageCostUsd(
      { input_tokens: 1_000_000, output_tokens: 500_000 },
      {
        model: "gpt-5-mini",
        verified_model_id: "gpt-5-mini",
        usd_per_1m_input: 0.25,
        usd_per_1m_cached_input: 0.025,
        usd_per_1m_output: 2,
        source: "pricing_csv",
        fetched_at: "2026-05-17",
      }
    );
    expect(cost.input_usd).toBeCloseTo(0.25);
    expect(cost.output_usd).toBeCloseTo(1);
    expect(cost.total_usd).toBeCloseTo(1.25);
  });

  it("has committed pricing CSV at expected path", () => {
    const rates = resolveOpenAiModelPricing("gpt-4o", REPO_ROOT);
    expect(rates.pricing_csv_path).toMatch(/eval-golden[\\/]data[\\/]openai-standard-pricing\.csv$/);
    expect(rates.pricing_csv_path).toContain("fixtures");
    expect(rates.usd_per_1m_input).toBe(2.5);
  });
});
