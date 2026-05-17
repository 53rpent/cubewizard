import { nameSimilarity, normalizeCardName, normalizeCardNameSet } from "./normalizeCardName";

export const GOLDEN_FUZZY_MATCH_THRESHOLD = 0.92;

export interface GoldenMatchDetail {
  predicted: string;
  expected: string | null;
  similarity: number;
}

export interface GoldenCaseMetrics {
  /** Unique predicted names (raw strings from model). */
  predicted_count: number;
  expected_count: number;
  /** |unique predicted| − expected_count */
  count_error: number;
  /** Exact normalized set equality. */
  exact_set_match: boolean;
  true_positives: number;
  false_positives: number;
  false_negatives: number;
  precision: number;
  recall: number;
  f1: number;
  false_positive_names: string[];
  false_negative_names: string[];
  /** Fuzzy-aligned pairs with similarity ≥ threshold. */
  matches: GoldenMatchDetail[];
}

function safeDiv(n: number, d: number): number {
  return d > 0 ? n / d : d === 0 && n === 0 ? 1 : 0;
}

/**
 * Match predicted names to expected using greedy best fuzzy similarity.
 * TP = matched pairs; unmatched predicted = FP; unmatched expected = FN.
 */
export function computeCaseMetrics(
  predictedRaw: string[],
  expectedRaw: string[],
  expectedCount?: number,
  fuzzyThreshold = GOLDEN_FUZZY_MATCH_THRESHOLD
): GoldenCaseMetrics {
  const predicted = [...new Set(predictedRaw.map((s) => s.trim()).filter(Boolean))];
  const expected = [...new Set(expectedRaw.map((s) => s.trim()).filter(Boolean))];
  const targetCount = expectedCount ?? expected.length;

  const predNorm = predicted.map((p) => ({ raw: p, key: normalizeCardName(p) }));
  const expNorm = expected.map((e) => ({ raw: e, key: normalizeCardName(e) }));

  const usedPred = new Set<number>();
  const usedExp = new Set<number>();
  const matches: GoldenMatchDetail[] = [];

  const pairs: { pi: number; ei: number; sim: number }[] = [];
  for (let pi = 0; pi < predNorm.length; pi++) {
    for (let ei = 0; ei < expNorm.length; ei++) {
      const sim = nameSimilarity(predNorm[pi]!.raw, expNorm[ei]!.raw);
      if (sim >= fuzzyThreshold) pairs.push({ pi, ei, sim });
    }
  }
  pairs.sort((a, b) => b.sim - a.sim);
  for (const { pi, ei, sim } of pairs) {
    if (usedPred.has(pi) || usedExp.has(ei)) continue;
    usedPred.add(pi);
    usedExp.add(ei);
    matches.push({
      predicted: predNorm[pi]!.raw,
      expected: expNorm[ei]!.raw,
      similarity: sim,
    });
  }

  const tp = matches.length;
  const fp = predNorm.length - tp;
  const fn = expNorm.length - tp;

  const false_positive_names = predNorm.filter((_, i) => !usedPred.has(i)).map((p) => p.raw);
  const false_negative_names = expNorm.filter((_, i) => !usedExp.has(i)).map((e) => e.raw);

  const precision = safeDiv(tp, tp + fp);
  const recall = safeDiv(tp, tp + fn);
  const f1 = safeDiv(2 * precision * recall, precision + recall);

  const exact_set_match =
    normalizeCardNameSet(predicted).size === normalizeCardNameSet(expected).size &&
    [...normalizeCardNameSet(predicted)].every((k) => normalizeCardNameSet(expected).has(k));

  return {
    predicted_count: predicted.length,
    expected_count: targetCount,
    count_error: predicted.length - targetCount,
    exact_set_match,
    true_positives: tp,
    false_positives: fp,
    false_negatives: fn,
    precision,
    recall,
    f1,
    false_positive_names,
    false_negative_names,
    matches,
  };
}

export interface GoldenAggregateMetrics {
  case_count: number;
  micro_precision: number;
  micro_recall: number;
  micro_f1: number;
  macro_precision: number;
  macro_recall: number;
  macro_f1: number;
  mean_count_error: number;
  exact_match_cases: number;
  total_openai_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_duration_ms: number;
  mean_openai_calls_per_case: number;
  mean_duration_ms_per_case: number;
  total_cost_usd: number;
  mean_cost_usd_per_case: number;
}

export function aggregateCaseMetrics(
  cases: {
    metrics: GoldenCaseMetrics;
    openai_calls: number;
    duration_ms: number;
    cost_usd: number;
  }[],
  tokenTotals: { input: number; output: number; total: number },
  totalOpenAiCalls: number,
  totalDurationMs: number,
  totalCostUsd: number
): GoldenAggregateMetrics {
  const n = cases.length;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let macroP = 0;
  let macroR = 0;
  let macroF1 = 0;
  let countErr = 0;
  let exact = 0;

  for (const c of cases) {
    tp += c.metrics.true_positives;
    fp += c.metrics.false_positives;
    fn += c.metrics.false_negatives;
    macroP += c.metrics.precision;
    macroR += c.metrics.recall;
    macroF1 += c.metrics.f1;
    countErr += Math.abs(c.metrics.count_error);
    if (c.metrics.exact_set_match) exact += 1;
  }

  const microP = safeDiv(tp, tp + fp);
  const microR = safeDiv(tp, tp + fn);
  const microF1 = safeDiv(2 * microP * microR, microP + microR);

  return {
    case_count: n,
    micro_precision: microP,
    micro_recall: microR,
    micro_f1: microF1,
    macro_precision: n ? macroP / n : 1,
    macro_recall: n ? macroR / n : 1,
    macro_f1: n ? macroF1 / n : 1,
    mean_count_error: n ? countErr / n : 0,
    exact_match_cases: exact,
    total_openai_calls: totalOpenAiCalls,
    total_input_tokens: tokenTotals.input,
    total_output_tokens: tokenTotals.output,
    total_tokens: tokenTotals.total,
    total_duration_ms: totalDurationMs,
    mean_openai_calls_per_case: n ? totalOpenAiCalls / n : 0,
    mean_duration_ms_per_case: n ? totalDurationMs / n : 0,
    total_cost_usd: totalCostUsd,
    mean_cost_usd_per_case: n ? totalCostUsd / n : 0,
  };
}
