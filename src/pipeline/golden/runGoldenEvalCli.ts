import { resolveOpenAiApiKey } from "../config/resolveOpenAiApiKey";
import {
  assertWithinBaselineTolerance,
  compareGoldenToBaseline,
  formatBaselineComparison,
} from "./compareToBaseline";
import { loadDevVarsIntoEnv, resolveOpenAiKeyFromEnv } from "./loadDevVars";
import { loadGoldenCases } from "./loadCases";
import { runGoldenSuite } from "./runSuite";
import { GoldenEvalCliError } from "./goldenCliError";
import {
  formatAggregateSummary,
  loadBaseline,
  persistGoldenRun,
} from "./scoresStore";

export { GoldenEvalCliError } from "./goldenCliError";

export interface RunGoldenEvalCliOptions {
  repoRoot: string;
  label?: string;
}

/**
 * Run the golden suite via the eval consumer, write scores, and compare to baseline.
 * Used by `npm run golden:eval`.
 */
export async function runGoldenEvalCli(opts: RunGoldenEvalCliOptions): Promise<void> {
  loadDevVarsIntoEnv(opts.repoRoot);

  const apiKey = resolveOpenAiKeyFromEnv();
  if (!apiKey) {
    throw new GoldenEvalCliError(
      "OPENAI_API_KEY is not set. Copy .dev.vars.example to .dev.vars and add your key."
    );
  }

  const cases = loadGoldenCases(opts.repoRoot);
  if (!cases.length) {
    throw new GoldenEvalCliError(
      "No golden cases found under fixtures/eval-golden/cases/ " +
        "(each folder needs expected.json + an image file; see cases/_template/)."
    );
  }

  const label = opts.label ?? String(process.env.GOLDEN_EVAL_LABEL || "golden-eval");

  resolveOpenAiApiKey({ OPENAI_API_KEY: apiKey });

  console.log(`Golden eval: ${cases.length} case(s) via eval consumer…`);
  const result = await runGoldenSuite({ repoRoot: opts.repoRoot, label });

  const paths = persistGoldenRun({
    repoRoot: opts.repoRoot,
    result,
  });

  console.log(formatAggregateSummary(result));
  console.log("Scores written:", paths);

  const baseline = loadBaseline(opts.repoRoot);
  const comparison = compareGoldenToBaseline(result, baseline);
  console.log(formatBaselineComparison(comparison));

  const toleranceErrors = assertWithinBaselineTolerance(comparison);
  if (toleranceErrors.length) {
    console.warn("\nBaseline tolerance warnings:");
    for (const e of toleranceErrors) console.warn(`  - ${e}`);
    if (/^1|true|yes$/i.test(String(process.env.GOLDEN_FAIL_ON_REGRESSION ?? "").trim())) {
      throw new GoldenEvalCliError(
        `Run exceeded baseline tolerance (${toleranceErrors.length} issue(s)). ` +
          "Set GOLDEN_FAIL_ON_REGRESSION=0 to only warn."
      );
    }
  }

  let failed = 0;
  for (const c of result.cases) {
    if (c.error) {
      failed += 1;
      console.error(`  [FAIL] ${c.case_id}: ${c.error}`);
    } else {
      console.log(
        `  [OK] ${c.case_id}: F1 ${(c.metrics.f1 * 100).toFixed(1)}% | ` +
          `${c.predicted_card_names.length} predicted | ${c.openai_calls} API calls | ` +
          `${c.usage.total_tokens} tokens | $${c.cost_usd.total_usd.toFixed(4)}`
      );
    }
  }

  if (failed > 0) {
    throw new GoldenEvalCliError(`${failed}/${result.cases.length} case(s) failed`);
  }
}
