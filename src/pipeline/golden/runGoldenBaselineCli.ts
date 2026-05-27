import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { compareGoldenToBaseline, formatBaselineComparison } from "./compareToBaseline";
import { GoldenEvalCliError } from "./goldenCliError";
import { formatAggregateSummary, loadBaseline, loadLatest, promoteLatestToBaseline } from "./scoresStore";

export interface RunGoldenBaselineCliOptions {
  repoRoot: string;
  /** Skip interactive prompt (e.g. CI). */
  yes?: boolean;
}

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${message} [y/N] `);
    return /^y|yes$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/**
 * Promote scores/latest.json to scores/baseline.json after confirmation.
 */
export async function runGoldenBaselineCli(opts: RunGoldenBaselineCliOptions): Promise<void> {
  const latest = loadLatest(opts.repoRoot);
  if (!latest) {
    throw new GoldenEvalCliError("No scores/latest.json found. Run npm run golden:eval first.");
  }

  const baseline = loadBaseline(opts.repoRoot);
  const comparison = compareGoldenToBaseline(latest, baseline);

  console.log(formatAggregateSummary(latest));
  console.log(formatBaselineComparison(comparison));

  if (baseline) {
    console.log("\nThis will overwrite fixtures/eval-golden/scores/baseline.json with the latest run.");
  } else {
    console.log("\nThis will create fixtures/eval-golden/scores/baseline.json from latest.json.");
  }

  const proceed = opts.yes ?? (await confirm("Promote latest.json to baseline.json?"));
  if (!proceed) {
    console.log("Cancelled — baseline unchanged.");
    return;
  }

  const baselinePath = promoteLatestToBaseline(opts.repoRoot);
  console.log(`Baseline updated: ${baselinePath}`);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const yes = process.argv.includes("--yes");
  runGoldenBaselineCli({ repoRoot, yes }).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
