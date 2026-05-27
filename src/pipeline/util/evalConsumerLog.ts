import {
  type EvalMemoryProbeEnv,
  enrichEvalMemoryLogEnv,
  isEvalMemoryLoggingEnabled,
  readActiveEvalBufferEstimates,
  readNodeMemoryUsageMb,
} from "./evalMemoryProbe";

export type EvalConsumerLogEnv = EvalMemoryProbeEnv;

export type EvalConsumerLogDetails = Record<string, string | number | boolean | null | undefined>;

let activeLogEnv: EvalConsumerLogEnv | null = null;
let activeUploadId: string | null = null;

/** Scope eval-consumer structured logs (OpenAI hooks, queue handlers) to one invocation. */
export async function runWithEvalConsumerLog<T>(
  env: EvalConsumerLogEnv,
  uploadId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  const prevEnv = activeLogEnv;
  const prevUpload = activeUploadId;
  activeLogEnv = enrichEvalMemoryLogEnv(env);
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

/** Clear module globals after each queue message (e.g. OOM without `finally`). */
export function resetEvalConsumerLogGlobals(): void {
  activeLogEnv = null;
  activeUploadId = null;
}

function attachMemorySnapshot(env: EvalConsumerLogEnv | null | undefined, payload: Record<string, unknown>): void {
  const e = env ? enrichEvalMemoryLogEnv(env) : activeLogEnv;
  if (!isEvalMemoryLoggingEnabled(e)) return;
  payload.memory_log_enabled = true;
  const est = readActiveEvalBufferEstimates();
  if (est) Object.assign(payload, est);
  const mem = readNodeMemoryUsageMb();
  if (mem) {
    Object.assign(payload, mem);
    return;
  }
  // Stub `process.memoryUsage` (all zeros) or missing — rely on `est_*` fields above.
  payload.heap_probe_unavailable = true;
}

function emitEvalConsumerLog(level: "log" | "error", payload: Record<string, unknown>): void {
  const line = JSON.stringify({ log: "eval_consumer", ...payload });
  if (level === "error") console.error(line);
  else console.log(line);
}

/** Structured eval consumer log (`wrangler tail` → filter `eval_consumer`). */
export function logEvalConsumer(kind: string, details?: EvalConsumerLogDetails, env?: EvalConsumerLogEnv): void {
  const payload: Record<string, unknown> = { kind, ...details };
  attachMemorySnapshot(env, payload);
  emitEvalConsumerLog("log", payload);
}

/** Same as {@link logEvalConsumer} but at error severity. */
export function logEvalConsumerError(kind: string, details?: EvalConsumerLogDetails, env?: EvalConsumerLogEnv): void {
  const payload: Record<string, unknown> = { kind, ...details };
  attachMemorySnapshot(env, payload);
  emitEvalConsumerLog("error", payload);
}
