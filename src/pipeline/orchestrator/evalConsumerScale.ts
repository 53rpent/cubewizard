/**
 * Expected parallel queue consumer instances (`max_concurrency` in wrangler-eval-consumer.jsonc).
 * Used only to space Scryfall HTTP (~10 req/s account-wide across instances).
 */
export const EVAL_CONSUMER_INSTANCES_MAX = 10;

export function parseEvalMaxConsumers(raw: string | undefined): number {
  const n = parseInt(String(raw ?? "2").trim(), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(EVAL_CONSUMER_INSTANCES_MAX, n);
}
