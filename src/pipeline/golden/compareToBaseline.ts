import type { GoldenSuiteRunResult } from "./types";

export interface GoldenMetricDelta {
  current: number;
  baseline: number;
  delta: number;
}

export interface GoldenCaseComparison {
  case_id: string;
  current_f1: number;
  baseline_f1: number | null;
  f1_delta: number | null;
  status: "new" | "missing_in_current" | "compared";
}

export interface GoldenBaselineComparison {
  has_baseline: boolean;
  current: GoldenSuiteRunResult;
  baseline: GoldenSuiteRunResult | null;
  aggregate: {
    micro_f1: GoldenMetricDelta | null;
    micro_recall: GoldenMetricDelta | null;
    micro_precision: GoldenMetricDelta | null;
    total_cost_usd: GoldenMetricDelta | null;
    total_tokens: GoldenMetricDelta | null;
    mean_count_error: GoldenMetricDelta | null;
    exact_match_cases: GoldenMetricDelta | null;
  };
  cases: GoldenCaseComparison[];
}

function delta(current: number, baseline: number): GoldenMetricDelta {
  return { current, baseline, delta: current - baseline };
}

export function compareGoldenToBaseline(
  current: GoldenSuiteRunResult,
  baseline: GoldenSuiteRunResult | null,
): GoldenBaselineComparison {
  if (!baseline) {
    return {
      has_baseline: false,
      current,
      baseline: null,
      aggregate: {
        micro_f1: null,
        micro_recall: null,
        micro_precision: null,
        total_cost_usd: null,
        total_tokens: null,
        mean_count_error: null,
        exact_match_cases: null,
      },
      cases: current.cases.map((c) => ({
        case_id: c.case_id,
        current_f1: c.metrics.f1,
        baseline_f1: null,
        f1_delta: null,
        status: "new" as const,
      })),
    };
  }

  const baselineById = new Map(baseline.cases.map((c) => [c.case_id, c]));
  const currentIds = new Set(current.cases.map((c) => c.case_id));

  const cases: GoldenCaseComparison[] = current.cases.map((c) => {
    const b = baselineById.get(c.case_id);
    if (!b) {
      return {
        case_id: c.case_id,
        current_f1: c.metrics.f1,
        baseline_f1: null,
        f1_delta: null,
        status: "new",
      };
    }
    return {
      case_id: c.case_id,
      current_f1: c.metrics.f1,
      baseline_f1: b.metrics.f1,
      f1_delta: c.metrics.f1 - b.metrics.f1,
      status: "compared",
    };
  });

  for (const b of baseline.cases) {
    if (!currentIds.has(b.case_id)) {
      cases.push({
        case_id: b.case_id,
        current_f1: 0,
        baseline_f1: b.metrics.f1,
        f1_delta: null,
        status: "missing_in_current",
      });
    }
  }

  const ca = current.aggregate;
  const ba = baseline.aggregate;

  return {
    has_baseline: true,
    current,
    baseline,
    aggregate: {
      micro_f1: delta(ca.micro_f1, ba.micro_f1),
      micro_recall: delta(ca.micro_recall, ba.micro_recall),
      micro_precision: delta(ca.micro_precision, ba.micro_precision),
      total_cost_usd: delta(ca.total_cost_usd, ba.total_cost_usd),
      total_tokens: delta(ca.total_tokens, ba.total_tokens),
      mean_count_error: delta(ca.mean_count_error, ba.mean_count_error),
      exact_match_cases: delta(ca.exact_match_cases, ba.exact_match_cases),
    },
    cases,
  };
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtDelta(n: number | null | undefined, asPct = false): string {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  if (asPct) return `${sign}${(n * 100).toFixed(1)}pp`;
  return `${sign}${n.toFixed(4)}`;
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toFixed(4)}`;
}

/** Human-readable comparison report for console output. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: formats aggregate, per-case, and regression sections for CLI output
export function formatBaselineComparison(report: GoldenBaselineComparison): string {
  const lines: string[] = ["", "── Comparison vs baseline ──"];

  if (!report.has_baseline || !report.baseline) {
    lines.push("No scores/baseline.json — run npm run golden:baseline after you trust a run.");
    return lines.join("\n");
  }

  const b = report.baseline;
  lines.push(
    `Baseline: ${b.label} @ ${b.recorded_at} (micro F1 ${fmtPct(b.aggregate.micro_f1)})`,
    `Current:  ${report.current.label} @ ${report.current.recorded_at} (micro F1 ${fmtPct(report.current.aggregate.micro_f1)})`,
    "",
  );

  const agg = report.aggregate;
  if (agg.micro_f1) {
    lines.push(
      `Micro F1:        ${fmtPct(agg.micro_f1.current)} (${fmtDelta(agg.micro_f1.delta, true)} vs baseline)`,
      `Micro recall:    ${fmtPct(agg.micro_recall?.current)} (${fmtDelta(agg.micro_recall?.delta, true)})`,
      `Micro precision: ${fmtPct(agg.micro_precision?.current)} (${fmtDelta(agg.micro_precision?.delta, true)})`,
      `Exact-set cases: ${agg.exact_match_cases?.current}/${report.current.aggregate.case_count} (${fmtDelta(agg.exact_match_cases?.delta)} vs ${agg.exact_match_cases?.baseline})`,
      `Mean |count err|: ${(agg.mean_count_error?.current ?? 0).toFixed(2)} (${fmtDelta(agg.mean_count_error?.delta)})`,
      `Tokens:          ${agg.total_tokens?.current} (${fmtDelta(agg.total_tokens?.delta, false)} )`,
      `Est. cost:       ${fmtUsd(agg.total_cost_usd?.current)} (${fmtDelta(agg.total_cost_usd?.delta)} USD)`,
    );
  }

  const compared = report.cases.filter((c) => c.status === "compared");
  if (compared.length) {
    lines.push("", "Per-case F1 (current vs baseline):");
    for (const c of compared.sort((a, b) => (a.f1_delta ?? 0) - (b.f1_delta ?? 0))) {
      const base = c.baseline_f1 != null ? fmtPct(c.baseline_f1) : "—";
      const d =
        c.f1_delta != null
          ? c.f1_delta >= 0
            ? ` ${fmtDelta(c.f1_delta, true)}`
            : ` ${fmtDelta(c.f1_delta, true)}`
          : "";
      lines.push(`  ${c.case_id}: ${fmtPct(c.current_f1)} (was ${base})${d}`);
    }
  }

  const regressions = compared.filter((c) => (c.f1_delta ?? 0) < -0.001);
  if (regressions.length) {
    lines.push("", "Largest regressions:");
    for (const c of regressions.sort((a, b) => (a.f1_delta ?? 0) - (b.f1_delta ?? 0)).slice(0, 5)) {
      lines.push(`  ${c.case_id}: ${fmtDelta(c.f1_delta ?? 0, true)}`);
    }
  }

  return lines.join("\n");
}

/** Optional strict check (former regression thresholds). */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: validates aggregate and per-case golden regression thresholds
export function assertWithinBaselineTolerance(
  report: GoldenBaselineComparison,
  opts?: { maxF1Drop?: number; maxCostRatio?: number; maxTokenRatio?: number },
): string[] {
  if (!report.has_baseline || !report.baseline) return [];

  const errors: string[] = [];
  const maxF1Drop = opts?.maxF1Drop ?? parseEnvFloat("GOLDEN_MAX_REGRESSION", 0.02);
  const maxCostRatio = opts?.maxCostRatio ?? parseEnvFloat("GOLDEN_MAX_COST_RATIO", 1.25);
  const maxTokenRatio = opts?.maxTokenRatio ?? parseEnvFloat("GOLDEN_MAX_TOKEN_RATIO", 1.25);

  const f1 = report.aggregate.micro_f1;
  if (f1 && f1.delta < -maxF1Drop) {
    errors.push(`micro-F1 dropped ${(-f1.delta * 100).toFixed(1)}pp (max allowed ${(maxF1Drop * 100).toFixed(1)}pp)`);
  }

  const cost = report.aggregate.total_cost_usd;
  if (cost && report.baseline?.aggregate.total_cost_usd > 0) {
    const ratio = cost.current / report.baseline?.aggregate.total_cost_usd;
    if (ratio > maxCostRatio) {
      errors.push(`cost ratio ${ratio.toFixed(2)} exceeds ${maxCostRatio}`);
    }
  }

  const tokens = report.aggregate.total_tokens;
  if (tokens && report.baseline?.aggregate.total_tokens > 0) {
    const ratio = tokens.current / report.baseline?.aggregate.total_tokens;
    if (ratio > maxTokenRatio) {
      errors.push(`token ratio ${ratio.toFixed(2)} exceeds ${maxTokenRatio}`);
    }
  }

  for (const c of report.cases) {
    if (c.status !== "compared" || c.f1_delta == null) continue;
    if (c.f1_delta < -maxF1Drop) {
      errors.push(`${c.case_id} F1 dropped ${(-c.f1_delta * 100).toFixed(1)}pp`);
    }
  }

  return errors;
}

function parseEnvFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}
