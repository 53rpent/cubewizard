import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enrichEvalMemoryLogEnv,
  isEvalMemoryLoggingEnabled,
  isStubNodeMemoryUsage,
  parseEvalMemoryLog,
  readNodeMemoryUsageMb,
} from "./evalMemoryProbe";

describe("evalMemoryProbe memory log flag", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parseEvalMemoryLog accepts 1/true/yes", () => {
    expect(parseEvalMemoryLog("1")).toBe(true);
    expect(parseEvalMemoryLog("true")).toBe(true);
    expect(parseEvalMemoryLog("0")).toBe(false);
  });

  it("isEvalMemoryLoggingEnabled reads process.env when env binding is missing", () => {
    vi.stubGlobal("process", { env: { CW_EVAL_MEMORY_LOG: "1" } });
    expect(isEvalMemoryLoggingEnabled({})).toBe(true);
  });

  it("enrichEvalMemoryLogEnv copies flag from process.env", () => {
    vi.stubGlobal("process", { env: { CW_EVAL_MEMORY_LOG: "yes" } });
    const enriched = enrichEvalMemoryLogEnv({ CWW_ENV: "local" });
    expect(enriched.CW_EVAL_MEMORY_LOG).toBe("yes");
  });

  it("readNodeMemoryUsageMb returns null for all-zero stub", () => {
    vi.stubGlobal("process", {
      memoryUsage: () => ({
        heapUsed: 0,
        rss: 0,
        external: 0,
        arrayBuffers: 0,
      }),
    });
    expect(isStubNodeMemoryUsage({ heapUsed: 0, rss: 0, external: 0, arrayBuffers: 0 })).toBe(true);
    expect(readNodeMemoryUsageMb()).toBeNull();
  });

  it("readNodeMemoryUsageMb returns rounded MB for real usage", () => {
    vi.stubGlobal("process", {
      memoryUsage: () => ({
        heapUsed: 40 * 1024 * 1024,
        rss: 50 * 1024 * 1024,
        external: 1,
        arrayBuffers: 2,
      }),
    });
    expect(readNodeMemoryUsageMb()?.heap_used_mb).toBe(40);
  });
});
