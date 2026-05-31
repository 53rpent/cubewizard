import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunEvalTaskEnv } from "../orchestrator/runEvalTask";
import { loadDevVarsIntoEnv } from "./loadDevVars";
import { createMockR2Bucket } from "./mockR2";
import { createGoldenSqliteD1 } from "./sqliteD1";

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
  for (;;) {
    const m = varRe.exec(text);
    if (m === null) break;
    const key = m[1];
    const val = m[2];
    if (key !== undefined && val !== undefined) out[key] = val;
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
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_GATEWAY_TOKEN: process.env.OPENAI_GATEWAY_TOKEN,
    OPENAI_VISION_MODEL: process.env.OPENAI_VISION_MODEL,
    OPENAI_MAX_OUTPUT_TOKENS: process.env.OPENAI_MAX_OUTPUT_TOKENS,
    OPENAI_REASONING_EFFORT: process.env.OPENAI_REASONING_EFFORT,
    CW_EVAL_MAX_CUBECOBRA_CARDS: process.env.CW_EVAL_MAX_CUBECOBRA_CARDS,
    CW_EVAL_USE_MULTI_PASS: process.env.CW_EVAL_USE_MULTI_PASS,
    CW_EVAL_JPEG_QUALITY: process.env.CW_EVAL_JPEG_QUALITY,
    CW_EVAL_MAX_IMAGE_SIDE: process.env.CW_EVAL_MAX_IMAGE_SIDE,
    CW_EVAL_ORIENT_MAX_SIDE: process.env.CW_EVAL_ORIENT_MAX_SIDE as string | undefined,
    CW_EVAL_LOG_LEVEL: process.env.CW_EVAL_LOG_LEVEL ?? "off",
    CW_EVAL_MEMORY_LOG: process.env.CW_EVAL_MEMORY_LOG,
    cubewizard_db: createGoldenSqliteD1(opts.repoRoot),
    BUCKET: createMockR2Bucket(),
    DECK_IMAGES_BLOB: createMockR2Bucket(),
  };

  // Production uses a Cloudflare Queue binding; the golden harness patches this per case
  // in bindGoldenExtractQueueInline (see runViaEvalConsumer.ts).
  env.EVAL_EXTRACT_QUEUE = {
    send: async () => {},
  };

  return env;
}
