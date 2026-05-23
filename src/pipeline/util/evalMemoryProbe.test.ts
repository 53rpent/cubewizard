import { describe, expect, it, vi } from "vitest";
import {
  buildEvalMemoryPayload,
  estimateEvalRgbaPeakMb,
  parseEvalMemoryLog,
  rgbaFrameBytes,
} from "./evalMemoryProbe";

describe("parseEvalMemoryLog", () => {
  it("is off unless explicitly enabled", () => {
    expect(parseEvalMemoryLog(undefined)).toBe(false);
    expect(parseEvalMemoryLog("")).toBe(false);
    expect(parseEvalMemoryLog("0")).toBe(false);
    expect(parseEvalMemoryLog("true")).toBe(true);
    expect(parseEvalMemoryLog("1")).toBe(true);
    expect(parseEvalMemoryLog("yes")).toBe(true);
  });
});

describe("rgbaFrameBytes", () => {
  it("uses width * height * 4", () => {
    expect(rgbaFrameBytes({ width: 100, height: 200 })).toBe(80_000);
    expect(estimateEvalRgbaPeakMb({ width: 3072, height: 3072 })).toBeGreaterThan(70);
  });
});

describe("buildEvalMemoryPayload", () => {
  it("includes phase and optional node memory", () => {
    const proc = { memoryUsage: () => ({ heapUsed: 40 * 1024 * 1024, rss: 50 * 1024 * 1024, external: 0, arrayBuffers: 8 * 1024 * 1024 }) };
    vi.stubGlobal("process", proc);
    const p = buildEvalMemoryPayload("test", { image_bytes_mb: 1.5 });
    expect(p.event).toBe("eval_memory");
    expect(p.phase).toBe("test");
    expect(p.image_bytes_mb).toBe(1.5);
    expect(p.heap_used_mb).toBe(40);
    vi.unstubAllGlobals();
  });
});
