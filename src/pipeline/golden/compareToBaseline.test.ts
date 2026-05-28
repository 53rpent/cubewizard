import { describe, expect, it } from "vitest";
import { assertWithinBaselineTolerance, compareGoldenToBaseline, formatBaselineComparison } from "./compareToBaseline";
import type { GoldenSuiteRunResult } from "./types";

function stubRun(microF1: number, cases: { id: string; f1: number }[]): GoldenSuiteRunResult {
  return {
    version: 1,
    run_id: "test",
    recorded_at: "2026-01-01T00:00:00.000Z",
    label: "test",
    model: "gpt-5-mini",
    config: {
      model: "gpt-5-mini",
      max_output_tokens: 20000,
      reasoning_effort: "medium",
      use_multi_pass: true,
      max_cubecobra_cards: 1000,
      jpeg_quality: 100,
      max_image_side: 0,
      orient_max_side: 0,
    },
    pricing: {
      model: "gpt-5-mini",
      verified_model_id: "gpt-5-mini",
      usd_per_1m_input: 0.25,
      usd_per_1m_cached_input: 0.025,
      usd_per_1m_output: 2,
      source: "pricing_csv",
      fetched_at: "2026-01-01",
    },
    runner: "eval_consumer",
    aggregate: {
      case_count: cases.length,
      micro_precision: microF1,
      micro_recall: microF1,
      micro_f1: microF1,
      macro_precision: microF1,
      macro_recall: microF1,
      macro_f1: microF1,
      mean_count_error: 0,
      exact_match_cases: 0,
      total_openai_calls: 4,
      total_input_tokens: 1000,
      total_output_tokens: 500,
      total_tokens: 1500,
      total_duration_ms: 1000,
      mean_openai_calls_per_case: 4,
      mean_duration_ms_per_case: 1000,
      total_cost_usd: 0.01,
      mean_cost_usd_per_case: 0.01,
    },
    cases: cases.map((c) => ({
      case_id: c.id,
      predicted_card_names: [],
      metrics: {
        predicted_count: 0,
        expected_count: 0,
        count_error: 0,
        exact_set_match: false,
        true_positives: 0,
        false_positives: 0,
        false_negatives: 0,
        precision: c.f1,
        recall: c.f1,
        f1: c.f1,
        false_positive_names: [],
        false_negative_names: [],
        matches: [],
      },
      openai_calls: 4,
      orientation_calls: 1,
      extraction_calls: 3,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      cost_usd: { input_usd: 0, output_usd: 0, total_usd: 0 },
      duration_ms: 0,
      job_status: "done",
    })),
  };
}

describe("compareGoldenToBaseline", () => {
  it("reports no baseline when missing", () => {
    const current = stubRun(0.9, [{ id: "a", f1: 0.9 }]);
    const report = compareGoldenToBaseline(current, null);
    expect(report.has_baseline).toBe(false);
    expect(formatBaselineComparison(report)).toContain("No scores/baseline.json");
  });

  it("computes aggregate and per-case deltas", () => {
    const baseline = stubRun(0.92, [
      { id: "good", f1: 1 },
      { id: "bad", f1: 0.8 },
    ]);
    const current = stubRun(0.9, [
      { id: "good", f1: 0.95 },
      { id: "bad", f1: 0.7 },
    ]);
    const report = compareGoldenToBaseline(current, baseline);
    expect(report.aggregate.micro_f1?.delta).toBeCloseTo(-0.02, 5);
    const bad = report.cases.find((c) => c.case_id === "bad");
    expect(bad?.f1_delta).toBeCloseTo(-0.1, 5);
  });

  it("assertWithinBaselineTolerance flags large F1 drop", () => {
    const baseline = stubRun(0.95, [{ id: "x", f1: 0.95 }]);
    const current = stubRun(0.9, [{ id: "x", f1: 0.9 }]);
    const report = compareGoldenToBaseline(current, baseline);
    const errors = assertWithinBaselineTolerance(report, { maxF1Drop: 0.02 });
    expect(errors.some((e) => e.includes("micro-F1"))).toBe(true);
  });
});
