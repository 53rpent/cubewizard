import { ModelOutputInvalidError } from "../openai/responsesApi";
import { configureScryfallGlobalThrottle } from "../scryfall/globalThrottle";
import { parseEvalQueueConcurrency } from "../orchestrator/evalQueueConcurrency";
import { PermanentEvalError, runEvalTask, type RunEvalTaskEnv } from "../orchestrator/runEvalTask";
import { runPool } from "../util/runPool";

type QueueMessage = {
  id: string;
  body: unknown;
  ack(): void;
  retry(opts: { delaySeconds: number }): void;
  attempts?: number;
};

async function processEvalQueueMessage(message: QueueMessage, env: RunEvalTaskEnv): Promise<void> {
  const raw = message.body as Record<string, unknown> | null;
  const uploadId = raw && typeof raw.upload_id === "string" ? raw.upload_id : undefined;
  const cubeId = raw && typeof raw.cube_id === "string" ? raw.cube_id : undefined;
  console.log("eval_consumer received", {
    message_id: message.id,
    upload_id: uploadId,
    cube_id: cubeId,
  });
  try {
    await runEvalTask(message.body, env);
    console.log("eval_consumer finished", {
      message_id: message.id,
      upload_id: uploadId,
      cube_id: cubeId,
    });
    message.ack();
  } catch (e) {
    if (e instanceof PermanentEvalError || e instanceof ModelOutputInvalidError) {
      console.error("eval_consumer permanent", {
        message_id: message.id,
        error: (e as Error).message,
      });
      message.ack();
      return;
    }
    const delay = Math.min(300, 30 * Math.max(1, message.attempts || 1));
    console.error("eval_consumer retry", {
      message_id: message.id,
      attempts: message.attempts,
      delay_seconds: delay,
      error: e instanceof Error ? e.message : String(e),
    });
    message.retry({ delaySeconds: delay });
  }
}

/**
 * Cloudflare Queue consumer entry (Wrangler bundles this file for deploy / `wrangler dev`).
 * Processes up to `CW_EVAL_QUEUE_CONCURRENCY` deck messages in parallel per batch.
 */
export default {
  async queue(
    batch: { messages: QueueMessage[] },
    env: RunEvalTaskEnv
  ): Promise<void> {
    const concurrency = parseEvalQueueConcurrency(env.CW_EVAL_QUEUE_CONCURRENCY);
    configureScryfallGlobalThrottle(concurrency);

    if (batch.messages.length > 1) {
      console.log("eval_consumer batch", {
        size: batch.messages.length,
        concurrency,
      });
    }

    await runPool(batch.messages, concurrency, (message) =>
      processEvalQueueMessage(message, env)
    );
  },
};
