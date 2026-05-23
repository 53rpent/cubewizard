import type { RgbaFrame } from "../images/types";

const MIB = 1024 * 1024;

export interface EvalMemoryProbeEnv {
  CW_EVAL_MEMORY_LOG?: string;
}

/** True when `CW_EVAL_MEMORY_LOG=1|true|yes` (case-insensitive). */
export function parseEvalMemoryLog(raw: string | undefined): boolean {
  return /^1|true|yes$/i.test(String(raw ?? "").trim());
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

/** Best-effort; available with `nodejs_compat`, may be absent or approximate on Workers. */
export function readNodeMemoryUsageMb(): NodeMemoryUsageMb | null {
  const proc = (
    globalThis as {
      process?: { memoryUsage?: () => Record<string, number> };
    }
  ).process;
  if (!proc?.memoryUsage) return null;
  try {
    const m = proc.memoryUsage();
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
