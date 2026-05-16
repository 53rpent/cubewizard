/** Align with `max_retries` in `wrangler-eval-consumer.jsonc` queue consumers. */
export const EVAL_QUEUE_MAX_RETRIES_DEFAULT = 5;

export function parseEvalMaxRetries(raw: string | undefined): number {
  const n = parseInt(String(raw ?? String(EVAL_QUEUE_MAX_RETRIES_DEFAULT)).trim(), 10);
  if (!Number.isFinite(n) || n < 0) return EVAL_QUEUE_MAX_RETRIES_DEFAULT;
  return Math.min(20, n);
}

/** `attempts` starts at 1; when true, another `retry()` would exceed `max_retries` and send to DLQ. */
export function isEvalRetriesExhausted(attempts: number | undefined, maxRetries: number): boolean {
  const a = attempts ?? 1;
  return a >= maxRetries;
}

export function isEvalDlqQueue(queueName: string): boolean {
  return queueName.endsWith("-dlq");
}
