/**
 * TS re-export for eval consumer (implementation in `src/queueMessageBody.js`).
 */
// @ts-expect-error JS module consumed by TS pipeline
import { parseQueueJsonBody } from "../../queueMessageBody.js";

export { parseQueueJsonBody };

export function parseEvalTaskBody(raw: unknown): Record<string, unknown> | null {
  const parsed = parseQueueJsonBody(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}
