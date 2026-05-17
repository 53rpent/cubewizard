import { describe, expect, it } from "vitest";
import { aggregateCaseMetrics, computeCaseMetrics } from "./metrics";

describe("computeCaseMetrics", () => {
  it("scores perfect extraction", () => {
    const m = computeCaseMetrics(
      ["Lightning Bolt", "Counterspell"],
      ["Lightning Bolt", "Counterspell"]
    );
    expect(m.f1).toBe(1);
    expect(m.exact_set_match).toBe(true);
    expect(m.false_positives).toBe(0);
    expect(m.false_negatives).toBe(0);
  });

  it("treats near-miss spellings as TP when fuzzy threshold met", () => {
    const m = computeCaseMetrics(
      ["Jace, the Mind Sculptor"],
      ["Jace, The Mind Sculptor"]
    );
    expect(m.true_positives).toBe(1);
    expect(m.false_positives).toBe(0);
    expect(m.false_negatives).toBe(0);
  });

  it("flags false positives and negatives", () => {
    const m = computeCaseMetrics(
      ["Lightning Bolt", "Shock", "Island"],
      ["Lightning Bolt", "Counterspell"]
    );
    expect(m.false_positives).toBeGreaterThanOrEqual(1);
    expect(m.false_negatives).toBeGreaterThanOrEqual(1);
    expect(m.precision).toBeLessThan(1);
    expect(m.recall).toBeLessThan(1);
  });
});

describe("aggregateCaseMetrics", () => {
  it("micro-averages TP/FP/FN across cases", () => {
    const a = computeCaseMetrics(["A"], ["A"]);
    const b = computeCaseMetrics(["X"], ["Y"]);
    const agg = aggregateCaseMetrics(
      [
        { metrics: a, openai_calls: 2, duration_ms: 100, cost_usd: 0.5 },
        { metrics: b, openai_calls: 3, duration_ms: 200, cost_usd: 1.5 },
      ],
      { input: 10, output: 20, total: 30 },
      5,
      300,
      2
    );
    expect(agg.case_count).toBe(2);
    expect(agg.micro_precision).toBe(0.5);
    expect(agg.total_openai_calls).toBe(5);
    expect(agg.mean_duration_ms_per_case).toBe(150);
    expect(agg.total_cost_usd).toBe(2);
    expect(agg.mean_cost_usd_per_case).toBe(1);
  });
});
