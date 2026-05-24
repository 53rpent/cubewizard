import type { RgbaFrame } from "../images/types";

const MIB = 1024 * 1024;

export interface EvalMemoryProbeEnv {
  CW_EVAL_MEMORY_LOG?: string;
}

/** True when `CW_EVAL_MEMORY_LOG=1|true|yes` (case-insensitive). */
export function parseEvalMemoryLog(raw: string | undefined): boolean {
  return /^1|true|yes$/i.test(String(raw ?? "").trim());
}

function readProcessEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process;
  const v = proc?.env?.[name];
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

/**
 * Whether memory snapshots attach to `eval_consumer` logs.
 * Checks queue `env` and `process.env` (`.dev.vars` may only reach the latter in multi-`wrangler dev`).
 */
export function isEvalMemoryLoggingEnabled(env?: EvalMemoryProbeEnv | null): boolean {
  if (parseEvalMemoryLog(env?.CW_EVAL_MEMORY_LOG)) return true;
  return parseEvalMemoryLog(readProcessEnv("CW_EVAL_MEMORY_LOG"));
}

/** Ensure `CW_EVAL_MEMORY_LOG` is on `env` when set via `process.env` only. */
export function enrichEvalMemoryLogEnv<T extends EvalMemoryProbeEnv>(env: T): T {
  if (parseEvalMemoryLog(env.CW_EVAL_MEMORY_LOG)) return env;
  const fromProcess = readProcessEnv("CW_EVAL_MEMORY_LOG");
  if (!fromProcess) return env;
  return { ...env, CW_EVAL_MEMORY_LOG: fromProcess };
}

export function rgbaFrameBytes(frame: Pick<RgbaFrame, "width" | "height">): number {
  const w = Math.max(0, Math.floor(frame.width));
  const h = Math.max(0, Math.floor(frame.height));
  return w * h * 4;
}

function roundMb(bytes: number): number {
  return Math.round((bytes / MIB) * 100) / 100;
}

export function bytesToMb(bytes: number): number {
  return roundMb(bytes);
}

export interface NodeMemoryUsageMb {
  heap_used_mb: number;
  rss_mb: number;
  external_mb: number;
  array_buffers_mb: number;
}

/** True when `memoryUsage()` exists but returns all zeros (unenv stub without `enable_nodejs_process_v2`). */
export function isStubNodeMemoryUsage(m: Record<string, number>): boolean {
  const heap = Number(m.heapUsed ?? 0);
  const rss = Number(m.rss ?? 0);
  const external = Number(m.external ?? 0);
  const ab = Number(m.arrayBuffers ?? 0);
  return heap === 0 && rss === 0 && external === 0 && ab === 0;
}

/** Best-effort; needs `nodejs_compat` + `enable_nodejs_process_v2` for non-zero heap on Workers. */
export function readNodeMemoryUsageMb(): NodeMemoryUsageMb | null {
  const proc = (
    globalThis as {
      process?: { memoryUsage?: () => Record<string, number> };
    }
  ).process;
  if (!proc?.memoryUsage) return null;
  try {
    const m = proc.memoryUsage();
    if (isStubNodeMemoryUsage(m)) return null;
    return {
      heap_used_mb: roundMb(Number(m.heapUsed ?? 0)),
      rss_mb: roundMb(Number(m.rss ?? 0)),
      external_mb: roundMb(Number(m.external ?? 0)),
      array_buffers_mb: roundMb(Number(m.arrayBuffers ?? 0)),
    };
  } catch {
    return null;
  }
}

/** Deterministic RGBA / JPEG buffer estimates for the active queue invocation. */
export interface EvalBufferEstimates {
  est_staging_jpeg_mb?: number;
  est_oriented_jpeg_mb?: number;
  est_rgba_mb?: number;
  est_rgba_peak_mb?: number;
  oriented_w?: number;
  oriented_h?: number;
}

let activeBufferEstimates: EvalBufferEstimates | null = null;

export function mergeActiveEvalBufferEstimates(patch: EvalBufferEstimates): void {
  activeBufferEstimates = { ...activeBufferEstimates, ...patch };
}

export function readActiveEvalBufferEstimates(): EvalBufferEstimates | null {
  return activeBufferEstimates;
}

export function clearActiveEvalBufferEstimates(): void {
  activeBufferEstimates = null;
}

export type EvalMemoryContext = Record<string, string | number | boolean | null | undefined>;

/**
 * Structured memory line for Workers Logs / `wrangler tail`.
 * `est_*` fields are deterministic buffer estimates; `heap_used_mb` etc. come from Node when available.
 */
export function buildEvalMemoryPayload(
  phase: string,
  ctx: EvalMemoryContext = {}
): Record<string, string | number | boolean | null> {
  const node = readNodeMemoryUsageMb();
  return {
    event: "eval_memory",
    phase,
    ...ctx,
    ...(node ?? {}),
  };
}

export function logEvalMemory(env: EvalMemoryProbeEnv, phase: string, ctx?: EvalMemoryContext): void {
  if (!parseEvalMemoryLog(env.CW_EVAL_MEMORY_LOG)) return;
  console.log("eval_memory", buildEvalMemoryPayload(phase, ctx));
}

/** Heuristic peak RGBA for one deck eval (oriented frame + one rotation scratch). */
export function estimateEvalRgbaPeakMb(
  frame: Pick<RgbaFrame, "width" | "height">,
  rotationScratch = true
): number {
  const one = rgbaFrameBytes(frame);
  const peak = rotationScratch ? one * 2 : one;
  return roundMb(peak);
}
