import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunEvalTaskEnv } from "../orchestrator/runEvalTask";
import {
  GOLDEN_EVAL_EXTRACT_QUEUE,
  bindGoldenExtractQueueInline,
} from "./runViaEvalConsumer";

const queueMock = vi.fn();

vi.mock("../entry/evalQueueEntry", () => ({
  default: {
    queue: (...args: unknown[]) => queueMock(...args),
  },
}));

describe("bindGoldenExtractQueueInline", () => {
  beforeEach(() => {
    queueMock.mockReset();
    queueMock.mockResolvedValue(undefined);
  });

  it("runs the extract queue consumer when orient enqueues extract work", async () => {
    let extractAcked = false;
    const baseEnv = {} as RunEvalTaskEnv;
    const env = bindGoldenExtractQueueInline(baseEnv, "TestCase", () => {
      extractAcked = true;
    });

    await env.EVAL_EXTRACT_QUEUE!.send!({ upload_id: "golden:TestCase" }, { contentType: "json" });

    expect(queueMock).toHaveBeenCalledOnce();
    const [batch, runEnv] = queueMock.mock.calls[0] as [
      { queue: string; messages: { id: string; ack(): void }[] },
      RunEvalTaskEnv,
    ];
    expect(batch.queue).toBe(GOLDEN_EVAL_EXTRACT_QUEUE);
    expect(batch.messages[0]!.id).toBe("golden-extract-TestCase");
    expect(runEnv).toBe(env);
    expect(extractAcked).toBe(false);

    batch.messages[0]!.ack();
    expect(extractAcked).toBe(true);
  });

  it("does not mutate the shared base env queue binding", async () => {
    const baseEnv = {
      EVAL_EXTRACT_QUEUE: { send: vi.fn() },
    } as unknown as RunEvalTaskEnv;

    const env = bindGoldenExtractQueueInline(baseEnv, "OtherCase", () => {});

    expect(env).not.toBe(baseEnv);
    expect(env.EVAL_EXTRACT_QUEUE).not.toBe(baseEnv.EVAL_EXTRACT_QUEUE);
  });
});
