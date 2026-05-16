import { ModelOutputInvalidError } from "../openai/responsesApi";
import { configureScryfallGlobalThrottle } from "../scryfall/globalThrottle";
import { parseEvalMaxConsumers } from "../orchestrator/evalConsumerScale";
import {
  buildDlqError,
  buildRetriesExhaustedError,
  failEvalJobFromQueue,
  uploadIdFromEvalTaskBody,
} from "../orchestrator/failEvalJobFromQueue";
import {
  isEvalDlqQueue,
  isEvalRetriesExhausted,
  parseEvalMaxRetries,
} from "../orchestrator/evalQueueRetries";
import { PermanentEvalError, runEvalTask, type RunEvalTaskEnv } from "../orchestrator/runEvalTask";
import { evalErrorFields, formatEvalError } from "../util/formatEvalError";
import { parseEvalTaskBody } from "../util/queueMessageBody";

type QueueMessage = {
  id: string;
  body: unknown;
  ack(): void;
  retry(opts: { delaySeconds: number }): void;
  attempts?: number;
};

async function processEvalDlqMessage(
  message: QueueMessage,
  env: RunEvalTaskEnv,
  queueName: string
): Promise<void> {
  const taskBody = parseEvalTaskBody(message.body);
  const uploadId = uploadIdFromEvalTaskBody(taskBody ?? message.body);
  const error = buildDlqError(queueName, message.attempts, message.id);
  console.error("eval_consumer_dlq", {
    message_id: message.id,
    upload_id: uploadId,
    queue: queueName,
    attempts: message.attempts,
    error,
  });
  await failEvalJobFromQueue(env.cubewizard_db, uploadId, error);
  try {
    message.ack();
  } catch (ackErr) {
    console.error("eval_consumer_dlq_ack_failed", {
      message_id: message.id,
      ...evalErrorFields(ackErr),
    });
  }
}

async function processEvalQueueMessage(
  message: QueueMessage,
  env: RunEvalTaskEnv,
  maxRetries: number
): Promise<void> {
  const taskBody = parseEvalTaskBody(message.body);
  if (!taskBody) {
    throw new PermanentEvalError("invalid_task_request: queue body must be a JSON object");
  }
  const uploadId = uploadIdFromEvalTaskBody(taskBody);
  const cubeId = typeof taskBody.cube_id === "string" ? taskBody.cube_id : undefined;
  console.log("eval_consumer received", {
    message_id: message.id,
    upload_id: uploadId,
    cube_id: cubeId,
    attempts: message.attempts,
  });
  try {
    await runEvalTask(taskBody, env);
    console.log("eval_consumer finished", {
      message_id: message.id,
      upload_id: uploadId,
      cube_id: cubeId,
    });
    message.ack();
  } catch (e) {
    const err = evalErrorFields(e);
    console.error("eval_consumer_error", {
      message_id: message.id,
      upload_id: uploadId,
      cube_id: cubeId,
      attempts: message.attempts,
      max_retries: maxRetries,
      ...err,
    });

    if (e instanceof PermanentEvalError || e instanceof ModelOutputInvalidError) {
      await failEvalJobFromQueue(env.cubewizard_db, uploadId, formatEvalError(e));
      try {
        message.ack();
      } catch (ackErr) {
        console.error("eval_consumer_ack_failed", {
          message_id: message.id,
          ...evalErrorFields(ackErr),
        });
      }
      return;
    }

    if (isEvalRetriesExhausted(message.attempts, maxRetries)) {
      const failMsg = buildRetriesExhaustedError(message.attempts, maxRetries, err.message);
      await failEvalJobFromQueue(env.cubewizard_db, uploadId, failMsg);
      console.error("eval_consumer_retries_exhausted", {
        message_id: message.id,
        upload_id: uploadId,
        error: failMsg,
      });
      try {
        message.ack();
      } catch (ackErr) {
        console.error("eval_consumer_ack_failed", {
          message_id: message.id,
          ...evalErrorFields(ackErr),
        });
      }
      return;
    }

    const delay = Math.min(300, 30 * Math.max(1, message.attempts || 1));
    try {
      message.retry({ delaySeconds: delay });
      console.log("eval_consumer_retry_scheduled", {
        message_id: message.id,
        upload_id: uploadId,
        delay_seconds: delay,
        error: err.message,
      });
    } catch (retryErr) {
      console.error("eval_consumer_retry_failed", {
        message_id: message.id,
        upload_id: uploadId,
        ...evalErrorFields(retryErr),
        original_error: err.message,
      });
      const failMsg = buildRetriesExhaustedError(
        message.attempts,
        maxRetries,
        `retry_failed: ${err.message}`
      );
      await failEvalJobFromQueue(env.cubewizard_db, uploadId, failMsg);
      try {
        message.ack();
      } catch {
        throw e;
      }
    }
  }
}

/**
 * Cloudflare Queue consumer: one deck per invocation on the main queue; DLQ consumer marks
 * `processing_jobs` failed when messages land on `*-dlq` after retries are exhausted.
 */
export default {
  async queue(
    batch: { queue: string; messages: QueueMessage[] },
    env: RunEvalTaskEnv
  ): Promise<void> {
    try {
      const queueName = batch.queue ?? "";
      const fromDlq = isEvalDlqQueue(queueName);

      if (!fromDlq) {
        const maxConsumers = parseEvalMaxConsumers(env.CW_EVAL_MAX_CONSUMERS);
        configureScryfallGlobalThrottle(maxConsumers);
      }

      const maxRetries = parseEvalMaxRetries(env.CW_EVAL_MAX_RETRIES);

      if (batch.messages.length > 1 && !fromDlq) {
        console.warn("eval_consumer unexpected_batch_size", {
          size: batch.messages.length,
          hint: "set max_batch_size to 1 in wrangler-eval-consumer.jsonc",
        });
      }

      for (const message of batch.messages) {
        if (fromDlq) {
          await processEvalDlqMessage(message, env, queueName);
        } else {
          await processEvalQueueMessage(message, env, maxRetries);
        }
      }
    } catch (e) {
      console.error("eval_consumer_batch_fatal", evalErrorFields(e));
      throw e;
    }
  },
};
