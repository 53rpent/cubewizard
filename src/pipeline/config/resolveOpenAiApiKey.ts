import { PermanentEvalError } from "../orchestrator/evalErrors";

/** Env shape for OpenAI: hosted value comes from `wrangler secret put OPENAI_API_KEY`. */
export type OpenAiKeyEnv = {
  OPENAI_API_KEY?: string;
};

/**
 * OpenAI API key for the eval consumer.
 * - **Local:** `.dev.vars` (see `secrets.required` in `wrangler-eval-consumer.jsonc`).
 * - **Staging / production:** Cloudflare Worker secret `OPENAI_API_KEY` (not `vars`).
 */
export function resolveOpenAiApiKey(env: OpenAiKeyEnv): string {
  const apiKey = String(env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new PermanentEvalError("OPENAI_API_KEY_missing");
  }
  return apiKey;
}
