import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunEvalTaskEnv } from "../orchestrator/runEvalTask";
import { loadDevVarsIntoEnv } from "./loadDevVars";
import { createGoldenSqliteD1 } from "./sqliteD1";
import { createMockR2Bucket } from "./mockR2";

/** Best-effort parse of string values from `wrangler-eval-consumer.jsonc` `vars`. */
export function loadWranglerEvalConsumerVars(repoRoot: string): Record<string, string> {
  const path = join(repoRoot, "wrangler-eval-consumer.jsonc");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  const varRe = /"([A-Z][A-Z0-9_]*)"\s*:\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = varRe.exec(text)) !== null) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

export interface GoldenEvalConsumerEnvOptions {
  repoRoot: string;
  fetchImpl?: typeof fetch;
}

/**
 * Build `RunEvalTaskEnv` for the golden harness: local vision, in-memory D1/R2,
 * config aligned with `wrangler-eval-consumer.jsonc` + `.dev.vars`.
 */
export function buildGoldenEvalConsumerEnv(opts: GoldenEvalConsumerEnvOptions): RunEvalTaskEnv {
  loadDevVarsIntoEnv(opts.repoRoot);
  const wranglerVars = loadWranglerEvalConsumerVars(opts.repoRoot);
  for (const [k, v] of Object.entries(wranglerVars)) {
    if (process.env[k] === undefined || process.env[k] === "") {
      process.env[k] = v;
    }
  }

  const env: RunEvalTaskEnv = {
    CWW_ENV: "local",
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_VISION_MODEL: process.env.OPENAI_VISION_MODEL,
    OPENAI_MAX_OUTPUT_TOKENS: process.env.OPENAI_MAX_OUTPUT_TOKENS,
    OPENAI_REASONING_EFFORT: process.env.OPENAI_REASONING_EFFORT,
    CW_EVAL_MAX_CUBECOBRA_CARDS: process.env.CW_EVAL_MAX_CUBECOBRA_CARDS,
    CW_EVAL_USE_MULTI_PASS: process.env.CW_EVAL_USE_MULTI_PASS,
    CW_EVAL_JPEG_QUALITY: process.env.CW_EVAL_JPEG_QUALITY,
    CW_EVAL_MAX_IMAGE_SIDE: process.env.CW_EVAL_MAX_IMAGE_SIDE,
    CW_EVAL_ORIENT_MAX_SIDE: process.env.CW_EVAL_ORIENT_MAX_SIDE,
    CW_EVAL_LOG_LEVEL: process.env.CW_EVAL_LOG_LEVEL ?? "off",
    cubewizard_db: createGoldenSqliteD1(opts.repoRoot),
    BUCKET: createMockR2Bucket(),
    DECK_IMAGES_BLOB: createMockR2Bucket(),
  };

  return env;
}
