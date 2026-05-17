import { join } from "node:path";
import type { EvalRunReport } from "../evalUsage/evalUsageReport";
import { aggregateCaseMetrics, computeCaseMetrics } from "./metrics";
import { buildGoldenEvalConsumerEnv, loadWranglerEvalConsumerVars } from "./loadEvalConsumerEnv";
import { loadDevVarsIntoEnv } from "./loadDevVars";
import { loadGoldenCases } from "./loadCases";
import { resolveOpenAiKeyFromEnv } from "./loadDevVars";
import { computeUsageCostUsd, resolveOpenAiModelPricing, type OpenAiPricingRates } from "./openAiPricing";
import { runGoldenCaseViaEvalConsumer } from "./runViaEvalConsumer";
import type { GoldenCaseRunResult, GoldenSuiteConfig, GoldenSuiteRunResult } from "./types";

export function defaultGoldenSuiteConfig(env: NodeJS.ProcessEnv = process.env): GoldenSuiteConfig {
  return {
    model: String(env.OPENAI_VISION_MODEL || "gpt-5-mini-2025-08-07").trim(),
    max_output_tokens: Math.min(
      32000,
      Math.max(1000, parseInt(String(env.OPENAI_MAX_OUTPUT_TOKENS || "20000"), 10) || 20000)
    ),
    reasoning_effort: (String(env.OPENAI_REASONING_EFFORT || "medium").trim() ||
      "medium") as GoldenSuiteConfig["reasoning_effort"],
    use_multi_pass: !/^0|false|no$/i.test(String(env.CW_EVAL_USE_MULTI_PASS || "true")),
    max_cubecobra_cards: Math.min(
      2000,
      parseInt(String(env.CW_EVAL_MAX_CUBECOBRA_CARDS || "1000"), 10) || 1000
    ),
    jpeg_quality: Math.min(
      100,
      Math.max(60, parseInt(String(env.CW_EVAL_JPEG_QUALITY || "95"), 10) || 95)
    ),
    max_image_side: Math.min(
      4096,
      Math.max(512, parseInt(String(env.CW_EVAL_MAX_IMAGE_SIDE || "2048"), 10) || 2048)
    ),
    orient_max_side: Math.min(
      2048,
      Math.max(512, parseInt(String(env.CW_EVAL_ORIENT_MAX_SIDE || "1280"), 10) || 1280)
    ),
  };
}

const ZERO_COST = { input_usd: 0, output_usd: 0, total_usd: 0 };

function caseResultFromEvalReport(
  goldenCase: import("./types").GoldenCaseDefinition,
  report: EvalRunReport | null,
  jobStatus: string,
  jobError: string | null,
  pricing: OpenAiPricingRates
): GoldenCaseRunResult {
  const predicted = report?.extracted_card_names ?? [];
  const metrics = computeCaseMetrics(
    predicted,
    goldenCase.expected.expected_card_names,
    goldenCase.expected.expected_count
  );

  const openai = report?.openai;
  const usage = openai?.totals ?? { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  const cost_usd =
    usage.input_tokens || usage.output_tokens ?
      computeUsageCostUsd(usage, pricing)
    : ZERO_COST;
  const ok = jobStatus === "done" && report != null;
  return {
    case_id: goldenCase.case_id,
    description: goldenCase.expected.description,
    tags: goldenCase.expected.tags,
    cube_id: goldenCase.expected.cube_id,
    predicted_card_names: predicted,
    metrics,
    openai_calls: openai?.calls.length ?? 0,
    orientation_calls: openai?.orientation_calls ?? 0,
    extraction_calls: openai?.extraction_calls ?? 0,
    usage: {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens,
    },
    cost_usd,
    duration_ms: report?.duration_ms ?? 0,
    job_status: jobStatus,
    error: ok ? undefined : (jobError ?? `job_status_${jobStatus}`),
  };
}

export interface RunGoldenSuiteOptions {
  repoRoot: string;
  label?: string;
  config?: GoldenSuiteConfig;
  caseIds?: string[];
}

/** Run all golden cases via the eval consumer (no direct OpenAI calls from the harness). */
export async function runGoldenSuite(opts: RunGoldenSuiteOptions): Promise<GoldenSuiteRunResult> {
  loadDevVarsIntoEnv(opts.repoRoot);
  const wranglerVars = loadWranglerEvalConsumerVars(opts.repoRoot);
  for (const [k, v] of Object.entries(wranglerVars)) {
    if (process.env[k] === undefined || process.env[k] === "") {
      process.env[k] = v;
    }
  }

  const config = opts.config ?? defaultGoldenSuiteConfig();
  const apiKey = resolveOpenAiKeyFromEnv();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set (required for eval consumer runs)");
  }

  console.log(`Loading OpenAI Standard pricing for ${config.model} from CSV…`);
  const pricing = resolveOpenAiModelPricing(config.model, opts.repoRoot);
  console.log(
    `Pricing (${pricing.source}, as of ${pricing.fetched_at}): ` +
      `$${pricing.usd_per_1m_input}/1M in, $${pricing.usd_per_1m_output}/1M out` +
      (pricing.verified_model_id ? ` [row: ${pricing.verified_model_id}]` : "")
  );

  const allCases = loadGoldenCases(opts.repoRoot);
  const cases =
    opts.caseIds?.length ?
      allCases.filter((c) => opts.caseIds!.includes(c.case_id))
    : allCases;

  if (!cases.length) {
    throw new Error(
      `no golden cases found under ${join(opts.repoRoot, "fixtures/eval-golden/cases")} ` +
        `(need expected.json + image per folder; copy cases/_template)`
    );
  }

  const env = buildGoldenEvalConsumerEnv({ repoRoot: opts.repoRoot });
  const caseResults: GoldenCaseRunResult[] = [];
  const metricsRows: {
    metrics: ReturnType<typeof computeCaseMetrics>;
    openai_calls: number;
    duration_ms: number;
    cost_usd: number;
  }[] = [];

  let totalOpenAiCalls = 0;
  let totalDuration = 0;
  let totalCostUsd = 0;
  const tokenTotals = { input: 0, output: 0, total: 0 };

  for (const c of cases) {
    try {
      const run = await runGoldenCaseViaEvalConsumer({
        repoRoot: opts.repoRoot,
        goldenCase: c,
        env,
      });

      if (run.job_status !== "done") {
        const row = caseResultFromEvalReport(
          c,
          run.eval_report,
          run.job_status,
          run.job_error,
          pricing
        );
        caseResults.push(row);
        metricsRows.push({
          metrics: row.metrics,
          openai_calls: row.openai_calls,
          duration_ms: row.duration_ms,
          cost_usd: row.cost_usd.total_usd,
        });
        totalCostUsd += row.cost_usd.total_usd;
        continue;
      }

      if (!run.eval_report) {
        const row = caseResultFromEvalReport(
          c,
          null,
          run.job_status,
          "missing_eval_report_in_result_json",
          pricing
        );
        caseResults.push(row);
        metricsRows.push({
          metrics: row.metrics,
          openai_calls: 0,
          duration_ms: 0,
          cost_usd: 0,
        });
        continue;
      }

      const row = caseResultFromEvalReport(c, run.eval_report, run.job_status, null, pricing);
      caseResults.push(row);
      metricsRows.push({
        metrics: row.metrics,
        openai_calls: row.openai_calls,
        duration_ms: row.duration_ms,
        cost_usd: row.cost_usd.total_usd,
      });
      totalOpenAiCalls += row.openai_calls;
      totalDuration += row.duration_ms;
      totalCostUsd += row.cost_usd.total_usd;
      tokenTotals.input += row.usage.input_tokens;
      tokenTotals.output += row.usage.output_tokens;
      tokenTotals.total += row.usage.total_tokens;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const metrics = computeCaseMetrics([], c.expected.expected_card_names, c.expected.expected_count);
      caseResults.push({
        case_id: c.case_id,
        description: c.expected.description,
        tags: c.expected.tags,
        cube_id: c.expected.cube_id,
        predicted_card_names: [],
        metrics,
        openai_calls: 0,
        orientation_calls: 0,
        extraction_calls: 0,
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        cost_usd: ZERO_COST,
        duration_ms: 0,
        job_status: "error",
        error: msg,
      });
      metricsRows.push({ metrics, openai_calls: 0, duration_ms: 0, cost_usd: 0 });
    }
  }

  const aggregate = aggregateCaseMetrics(
    metricsRows,
    tokenTotals,
    totalOpenAiCalls,
    totalDuration,
    totalCostUsd
  );

  const now = new Date();
  return {
    version: 1,
    run_id: now.toISOString().replace(/[:.]/g, "-"),
    recorded_at: now.toISOString(),
    label: opts.label ?? "golden-eval",
    model: config.model,
    config,
    pricing,
    runner: "eval_consumer",
    aggregate,
    cases: caseResults,
  };
}
