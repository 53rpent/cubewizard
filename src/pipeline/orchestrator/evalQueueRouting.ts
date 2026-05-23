import { isExtractTaskBody } from "../contracts/extractTaskRequest.zod";

/** Orient-stage queues (site / Hedron producers). */
export const EVAL_ORIENT_QUEUE_SUFFIX = "-eval-";

/** Extract-stage queue segment (orient consumer producer). */
export const EVAL_EXTRACT_QUEUE_MARKER = "-eval-extract";

export function isEvalExtractQueue(queueName: string): boolean {
  return queueName.includes(EVAL_EXTRACT_QUEUE_MARKER);
}

/** Route queue message to extract handler when body is phase-2 or queue name is extract. */
export function shouldRunExtractPhase(queueName: string, body: unknown): boolean {
  if (isExtractTaskBody(body)) return true;
  if (isEvalExtractQueue(queueName) && body && typeof body === "object") {
    const key = (body as Record<string, unknown>).oriented_image_r2_key;
    return typeof key === "string" && key.length > 0;
  }
  return false;
}
