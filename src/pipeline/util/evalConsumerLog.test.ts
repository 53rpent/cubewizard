import { afterEach, describe, expect, it, vi } from "vitest";
import { isEvalConsumerLogActive, logEvalConsumer, runWithEvalConsumerLog } from "./evalConsumerLog";

describe("evalConsumerLog", () => {
  afterEach(() => {
    expect(isEvalConsumerLogActive()).toBe(false);
  });

  it("logs kind without memory when CW_EVAL_MEMORY_LOG is off", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logEvalConsumer("queue_job_start", { upload_id: "u1" }, { CW_EVAL_MEMORY_LOG: "0" });
    const payload = JSON.parse(String(spy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(payload.kind).toBe("queue_job_start");
    expect(payload.upload_id).toBe("u1");
    expect(payload.memory_log_enabled).toBeUndefined();
    spy.mockRestore();
  });

  it("attaches heap fields when CW_EVAL_MEMORY_LOG is on", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const proc = {
      memoryUsage: () => ({
        heapUsed: 50 * 1024 * 1024,
        rss: 60 * 1024 * 1024,
        external: 1,
        arrayBuffers: 2,
      }),
      env: {},
    };
    vi.stubGlobal("process", proc);
    logEvalConsumer(
      "openai_request",
      { schema: "orientation_result" },
      {
        CW_EVAL_MEMORY_LOG: "1",
      },
    );
    const payload = JSON.parse(String(spy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(payload.kind).toBe("openai_request");
    expect(payload.memory_log_enabled).toBe(true);
    expect(payload.heap_used_mb).toBe(50);
    expect(payload.rss_mb).toBe(60);
    vi.unstubAllGlobals();
    spy.mockRestore();
  });

  it("runWithEvalConsumerLog activates context for nested logs", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runWithEvalConsumerLog({ CW_EVAL_MEMORY_LOG: "0" }, "u2", async () => {
      expect(isEvalConsumerLogActive()).toBe(true);
      logEvalConsumer("queue_send", { upload_id: "u2" });
    });
    const payload = JSON.parse(String(spy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(payload.kind).toBe("queue_send");
    expect(payload.upload_id).toBe("u2");
    spy.mockRestore();
  });
});
