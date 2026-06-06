import type { EvalVisionLlmEnv } from "./resolveEvalVisionLlm";
import { resolveEvalVisionApiKey } from "./resolveEvalVisionLlm";

/** @deprecated Use {@link EvalVisionLlmEnv}. */
export type OpenAiKeyEnv = Pick<EvalVisionLlmEnv, "EVAL_VISION_API_KEY" | "OPENAI_API_KEY">;

/**
 * Vision LLM API key for the eval consumer (`EVAL_VISION_API_KEY`, else `OPENAI_API_KEY`).
 * - **Local:** `.dev.vars`
 * - **Hosted:** `wrangler secret put` for the key you use
 */
export function resolveOpenAiApiKey(env: OpenAiKeyEnv): string {
  return resolveEvalVisionApiKey(env);
}
