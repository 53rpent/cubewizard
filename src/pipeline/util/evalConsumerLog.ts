import {
  parseEvalMemoryLog,
  readNodeMemoryUsageMb,
  type EvalMemoryProbeEnv,
} from "./evalMemoryProbe";

export type EvalConsumerLogEnv = EvalMemoryProbeEnv;

export type EvalConsumerLogDetails = Record<
  string,
  string | number | boolean | null | undefined
>;

let activeLogEnv: EvalConsumerLogEnv | null = null;
let activeUploadId: string | null = null;

/** Scope eval-consumer structured logs (OpenAI hooks, queue handlers) to one invocation. */
export async function runWithEvalConsumerLog<T>(
  env: EvalConsumerLogEnv,
  uploadId: string | null,
  fn: () => Promise<T>
): Promise<T> {
  const prevEnv = activeLogEnv;
  const prevUpload = activeUploadId;
  activeLogEnv = env;
  activeUploadId = uploadId;
  try {
    return await fn();
  } finally {
    activeLogEnv = prevEnv;
    activeUploadId = prevUpload;
  }
}

export function getActiveEvalConsumerUploadId(): string | null {
  return activeUploadId;
}

export function isEvalConsumerLogActive(): boolean {
  return activeLogEnv !== null;
}

function attachMemorySnapshot(
  env: EvalConsumerLogEnv | null | undefined,
  payload: Record<string, unknown>
): void {
  const e = env ?? activeLogEnv;
  if (!e || !parseEvalMemoryLog(e.CW_EVAL_MEMORY_LOG)) return;
  const mem = readNodeMemoryUsageMb();
  if (mem) Object.assign(payload, mem);
}

/** Structured eval consumer log (`wrangler tail` → filter `eval_consumer`). */
export function logEvalConsumer(
  kind: string,
  details?: EvalConsumerLogDetails,
  env?: EvalConsumerLogEnv
): void {
  const payload: Record<string, unknown> = { kind, ...details };
  attachMemorySnapshot(env, payload);
  console.log("eval_consumer", payload);
}

/** Same as {@link logEvalConsumer} but at error severity. */
export function logEvalConsumerError(
  kind: string,
  details?: EvalConsumerLogDetails,
  env?: EvalConsumerLogEnv
): void {
  const payload: Record<string, unknown> = { kind, ...details };
  attachMemorySnapshot(env, payload);
  console.error("eval_consumer", payload);
}
