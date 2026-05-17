import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GoldenScoresFile, GoldenSuiteRunResult } from "./types";

export const GOLDEN_SCORES_DIR = "fixtures/eval-golden/scores";

export function goldenScoresPaths(repoRoot: string) {
  const dir = join(repoRoot, GOLDEN_SCORES_DIR);
  return {
    dir,
    runs: join(dir, "runs.json"),
    latest: join(dir, "latest.json"),
    baseline: join(dir, "baseline.json"),
    historyDir: join(dir, "history"),
  };
}

function readScoresFile(path: string): GoldenScoresFile {
  if (!existsSync(path)) {
    return { version: 1, runs: [] };
  }
  const text = readFileSync(path, "utf8").trim();
  if (!text) {
    return { version: 1, runs: [] };
  }
  let raw: GoldenScoresFile;
  try {
    raw = JSON.parse(text) as GoldenScoresFile;
  } catch {
    return { version: 1, runs: [] };
  }
  if (!raw || raw.version !== 1 || !Array.isArray(raw.runs)) {
    return { version: 1, runs: [] };
  }
  return raw;
}

export function loadBaseline(repoRoot: string): GoldenSuiteRunResult | null {
  const { baseline } = goldenScoresPaths(repoRoot);
  if (!existsSync(baseline)) return null;
  return JSON.parse(readFileSync(baseline, "utf8")) as GoldenSuiteRunResult;
}

export interface PersistGoldenRunOptions {
  repoRoot: string;
  result: GoldenSuiteRunResult;
  writeBaseline?: boolean;
}

/** Append run to runs.json, write latest.json, snapshot under history/. */
export function persistGoldenRun(opts: PersistGoldenRunOptions): {
  runsPath: string;
  latestPath: string;
  historyPath: string;
  baselinePath?: string;
} {
  const paths = goldenScoresPaths(opts.repoRoot);
  mkdirSync(paths.dir, { recursive: true });
  mkdirSync(paths.historyDir, { recursive: true });

  const scores = readScoresFile(paths.runs);
  scores.runs.push(opts.result);
  writeFileSync(paths.runs, JSON.stringify(scores, null, 2), "utf8");
  writeFileSync(paths.latest, JSON.stringify(opts.result, null, 2), "utf8");

  const historyPath = join(paths.historyDir, `${opts.result.run_id}.json`);
  writeFileSync(historyPath, JSON.stringify(opts.result, null, 2), "utf8");

  let baselinePath: string | undefined;
  if (opts.writeBaseline) {
    writeFileSync(paths.baseline, JSON.stringify(opts.result, null, 2), "utf8");
    baselinePath = paths.baseline;
  }

  return {
    runsPath: paths.runs,
    latestPath: paths.latest,
    historyPath,
    baselinePath,
  };
}

export function formatAggregateSummary(result: GoldenSuiteRunResult): string {
  const a = result.aggregate;
  const lines = [
    `Golden eval: ${result.label} @ ${result.recorded_at}`,
    `Model: ${result.model} | Cases: ${a.case_count}`,
    `Micro F1: ${(a.micro_f1 * 100).toFixed(1)}% (P ${(a.micro_precision * 100).toFixed(1)}% / R ${(a.micro_recall * 100).toFixed(1)}%)`,
    `Macro F1: ${(a.macro_f1 * 100).toFixed(1)}% | Exact-set cases: ${a.exact_match_cases}/${a.case_count}`,
    `Mean |count error|: ${a.mean_count_error.toFixed(2)}`,
    `OpenAI calls: ${a.total_openai_calls} (${a.mean_openai_calls_per_case.toFixed(1)}/case)`,
    `Tokens: in ${a.total_input_tokens} / out ${a.total_output_tokens} / total ${a.total_tokens}`,
    `Est. cost: $${a.total_cost_usd.toFixed(4)} ($${a.mean_cost_usd_per_case.toFixed(4)}/case) @ $${result.pricing.usd_per_1m_input}/$${result.pricing.usd_per_1m_output} per 1M in/out`,
    `Duration: ${(a.total_duration_ms / 1000).toFixed(1)}s (${(a.mean_duration_ms_per_case / 1000).toFixed(1)}s/case)`,
  ];
  return lines.join("\n");
}
