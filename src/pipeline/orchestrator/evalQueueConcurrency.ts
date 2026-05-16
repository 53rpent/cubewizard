/** Max parallel deck evals per queue batch (`CW_EVAL_QUEUE_CONCURRENCY`, default 5). */
export const EVAL_QUEUE_CONCURRENCY_MAX = 5;

export function parseEvalQueueConcurrency(raw: string | undefined): number {
  const n = parseInt(String(raw ?? "5").trim(), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(EVAL_QUEUE_CONCURRENCY_MAX, n);
}
