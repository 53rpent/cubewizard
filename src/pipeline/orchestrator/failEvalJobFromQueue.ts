import { safeMarkJobFailed } from "./safeMarkJobFailed";
import type { D1DatabaseLike } from "./processingJobRepo";

export function uploadIdFromEvalTaskBody(body: unknown): string | undefined {
  const raw = body as Record<string, unknown> | null;
  const id = raw?.upload_id;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

export function buildRetriesExhaustedError(
  attempts: number | undefined,
  maxRetries: number,
  cause: string
): string {
  const a = attempts ?? 1;
  return `retries_exhausted (${a}/${maxRetries}): ${cause}`.slice(0, 4000);
}

export function buildDlqError(
  queueName: string,
  attempts: number | undefined,
  messageId: string,
  lastError?: string
): string {
  const a = attempts ?? 1;
  const base = `dead_letter_queue (${queueName}): eval message ${messageId} failed after ${a} delivery attempt(s)`;
  if (lastError?.trim()) {
    return `${base}; last_error: ${lastError.trim()}`.slice(0, 4000);
  }
  return `${base}; see eval consumer logs (eval_consumer_error)`.slice(0, 4000);
}

export async function failEvalJobFromQueue(
  db: D1DatabaseLike,
  uploadId: string | undefined,
  error: string
): Promise<boolean> {
  if (!uploadId) {
    console.error("eval_fail_job_no_upload_id", { error: error.slice(0, 500) });
    return false;
  }
  await safeMarkJobFailed(db, uploadId, error);
  return true;
}
