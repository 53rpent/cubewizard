/**
 * Regression tests against fixtures/eval-golden/scores/baseline.json.
 * Live OpenAI calls — skipped unless OPENAI_API_KEY is set and GOLDEN_EVAL_RUN=1.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadDevVarsIntoEnv, resolveOpenAiKeyFromEnv } from "./loadDevVars";
import { loadGoldenCases } from "./loadCases";
import { runGoldenSuite } from "./runSuite";
import { formatAggregateSummary, loadBaseline } from "./scoresStore";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

loadDevVarsIntoEnv(repoRoot);

const apiKey = resolveOpenAiKeyFromEnv();
const cases = loadGoldenCases(repoRoot);
const runLive = Boolean(apiKey) && /^1|true|yes$/i.test(String(process.env.GOLDEN_EVAL_RUN ?? "").trim());

const DEFAULT_MIN_MICRO_F1 = 0.85;
const DEFAULT_MAX_REGRESSION = 0.02;

function minMicroF1(): number {
  const raw = process.env.GOLDEN_MIN_MICRO_F1;
  if (raw != null && raw !== "") {
    const n = parseFloat(raw);
    if (Number.isFinite(n)) return n;
  }
  const baseline = loadBaseline(repoRoot);
  if (baseline) {
    return Math.max(0, baseline.aggregate.micro_f1 - maxRegressionDelta());
  }
  return DEFAULT_MIN_MICRO_F1;
}

function maxRegressionDelta(): number {
  const raw = process.env.GOLDEN_MAX_REGRESSION;
  if (raw == null || raw === "") return DEFAULT_MAX_REGRESSION;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : DEFAULT_MAX_REGRESSION;
}

describe.skipIf(!runLive || !cases.length)("golden eval regression (eval consumer, live OpenAI)", () => {
  let result: Awaited<ReturnType<typeof runGoldenSuite>>;
  const baseline = loadBaseline(repoRoot);

  beforeAll(async () => {
    result = await runGoldenSuite({
      repoRoot,
      label: "regression-test",
    });
    console.log(formatAggregateSummary(result));
    if (baseline) {
      console.log(
        `Baseline micro-F1: ${(baseline.aggregate.micro_f1 * 100).toFixed(1)}% @ ${baseline.recorded_at}`
      );
    }
  }, 600_000);

  it("meets micro-F1 floor vs baseline or GOLDEN_MIN_MICRO_F1", () => {
    const floor = minMicroF1();
    expect(result.aggregate.micro_f1).toBeGreaterThanOrEqual(floor);

    if (baseline) {
      const delta = baseline.aggregate.micro_f1 - result.aggregate.micro_f1;
      expect(delta).toBeLessThanOrEqual(maxRegressionDelta());
    }
  });

  it("meets per-case F1 floors", () => {
    const floor = minMicroF1();
    for (const c of result.cases) {
      expect(c.error, `${c.case_id} failed: ${c.error}`).toBeUndefined();
      const caseFloor =
        baseline?.cases.find((b) => b.case_id === c.case_id)?.metrics.f1 ?? floor;
      const allowed = baseline ? Math.max(0, caseFloor - maxRegressionDelta()) : floor;
      expect(c.metrics.f1).toBeGreaterThanOrEqual(allowed);
    }
  });

  it.skipIf(!baseline?.aggregate.total_tokens)(
    "does not increase aggregate token usage vs baseline beyond GOLDEN_MAX_TOKEN_RATIO",
    () => {
      const maxRatio = parseFloat(String(process.env.GOLDEN_MAX_TOKEN_RATIO || "1.25"));
      const ratio =
        baseline!.aggregate.total_tokens > 0 ?
          result.aggregate.total_tokens / baseline!.aggregate.total_tokens
        : 1;
      expect(ratio).toBeLessThanOrEqual(maxRatio);
    }
  );

  it.skipIf(!baseline?.aggregate.total_cost_usd)(
    "does not increase aggregate cost vs baseline beyond GOLDEN_MAX_COST_RATIO",
    () => {
      const maxRatio = parseFloat(String(process.env.GOLDEN_MAX_COST_RATIO || "1.25"));
      const ratio =
        baseline!.aggregate.total_cost_usd > 0 ?
          result.aggregate.total_cost_usd / baseline!.aggregate.total_cost_usd
        : 1;
      expect(ratio).toBeLessThanOrEqual(maxRatio);
    }
  );
});

describe("golden eval regression (offline)", () => {
  it("loads baseline.example.json shape when present", () => {
    const baseline = loadBaseline(repoRoot);
    if (!baseline) {
      console.warn("No scores/baseline.json — run npm run golden:baseline after first golden set");
      return;
    }
    expect(baseline.version).toBe(1);
    expect(baseline.aggregate).toBeDefined();
    expect(Array.isArray(baseline.cases)).toBe(true);
  });
});
