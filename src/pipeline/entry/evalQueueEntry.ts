import { resetEvalUsageReporterGlobal } from "../evalUsage/evalUsageReport";
import { ModelOutputInvalidError } from "../openai/chatCompletionsApi";

import { parseEvalMaxConsumers } from "../orchestrator/evalConsumerScale";
import {
  computeEvalQueueRetryDelaySeconds,
  isEvalDlqQueue,
  isEvalRetriesExhausted,
  isOpenAi429Error,
  parseEvalMaxRetries,
} from "../orchestrator/evalQueueRetries";
import { shouldRunExtractPhase } from "../orchestrator/evalQueueRouting";
import {
  buildDlqError,
  buildRetriesExhaustedError,
  failEvalJobFromQueue,
  uploadIdFromEvalTaskBody,
} from "../orchestrator/failEvalJobFromQueue";

import { PermanentEvalError, type RunEvalTaskEnv, runExtractTask, runOrientTask } from "../orchestrator/runEvalTask";
import { configureScryfallGlobalThrottle } from "../scryfall/globalThrottle";
import {
  logEvalConsumer,
  logEvalConsumerError,
  resetEvalConsumerLogGlobals,
  runWithEvalConsumerLog,
} from "../util/evalConsumerLog";
import { clearActiveEvalBufferEstimates } from "../util/evalMemoryProbe";
import { evalErrorFields, formatEvalError } from "../util/formatEvalError";
import { parseEvalTaskBody } from "../util/queueMessageBody";

/** Per-message cleanup so module globals never retain deck state across invocations. */
function resetEvalInvocationGlobals(): void {
  resetEvalConsumerLogGlobals();
  resetEvalUsageReporterGlobal();
  clearActiveEvalBufferEstimates();
}

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

  queueName: string,
): Promise<void> {
  const taskBody = parseEvalTaskBody(message.body);

  const uploadId = uploadIdFromEvalTaskBody(taskBody ?? message.body);

  const error = buildDlqError(queueName, message.attempts, message.id);

  logEvalConsumerError("dlq_message", {
    message_id: message.id,

    upload_id: uploadId,

    queue: queueName,

    attempts: message.attempts ?? null,

    error,
  });

  await failEvalJobFromQueue(env.cubewizard_db, uploadId, error);

  try {
    message.ack();
  } catch (ackErr) {
    logEvalConsumerError("dlq_ack_failed", {
      message_id: message.id,

      ...evalErrorFields(ackErr),
    });
  }
}

async function processEvalQueueMessage(
  message: QueueMessage,

  env: RunEvalTaskEnv,

  maxRetries: number,

  queueName: string,
): Promise<void> {
  const taskBody = parseEvalTaskBody(message.body);

  if (!taskBody) {
    throw new PermanentEvalError("invalid_task_request: queue body must be a JSON object");
  }

  const uploadId = uploadIdFromEvalTaskBody(taskBody);

  const cubeId = typeof taskBody.cube_id === "string" ? taskBody.cube_id : undefined;

  const phase = shouldRunExtractPhase(queueName, taskBody) ? "extract" : "orient";

  resetEvalInvocationGlobals();
  try {
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: queue handler branches on phase, retries, and ack policy
    await runWithEvalConsumerLog(env, uploadId ?? null, async () => {
      logEvalConsumer("queue_job_start", {
        message_id: message.id,

        upload_id: uploadId,

        cube_id: cubeId ?? null,

        attempts: message.attempts ?? null,

        phase,

        queue: queueName,
      });

      try {
        if (phase === "extract") {
          await runExtractTask(taskBody, env);
        } else {
          await runOrientTask(taskBody, env);
        }

        logEvalConsumer("queue_job_done", {
          message_id: message.id,

          upload_id: uploadId,

          cube_id: cubeId ?? null,

          phase,
        });

        message.ack();
      } catch (e) {
        const err = evalErrorFields(e);

        logEvalConsumerError("queue_job_failed", {
          message_id: message.id,

          upload_id: uploadId,

          cube_id: cubeId ?? null,

          attempts: message.attempts ?? null,

          max_retries: maxRetries,

          phase,

          ...err,
        });

        if (e instanceof PermanentEvalError || e instanceof ModelOutputInvalidError) {
          await failEvalJobFromQueue(env.cubewizard_db, uploadId, formatEvalError(e));

          try {
            message.ack();
          } catch (ackErr) {
            logEvalConsumerError("ack_failed", {
              message_id: message.id,

              ...evalErrorFields(ackErr),
            });
          }

          return;
        }

        if (isEvalRetriesExhausted(message.attempts, maxRetries)) {
          const failMsg = buildRetriesExhaustedError(message.attempts, maxRetries, err.message);

          await failEvalJobFromQueue(env.cubewizard_db, uploadId, failMsg);

          logEvalConsumerError("retries_exhausted", {
            message_id: message.id,

            upload_id: uploadId,

            error: failMsg,

            phase,
          });

          try {
            message.ack();
          } catch (ackErr) {
            logEvalConsumerError("ack_failed", {
              message_id: message.id,

              ...evalErrorFields(ackErr),
            });
          }

          return;
        }

        const delay = computeEvalQueueRetryDelaySeconds(message.attempts, e);

        try {
          message.retry({ delaySeconds: delay });

          logEvalConsumer("queue_retry_scheduled", {
            message_id: message.id,

            upload_id: uploadId,

            delay_seconds: delay,

            openai_429: isOpenAi429Error(e),

            error: err.message,

            phase,
          });
        } catch (retryErr) {
          logEvalConsumerError("retry_failed", {
            message_id: message.id,

            upload_id: uploadId,

            ...evalErrorFields(retryErr),

            original_error: err.message,
          });

          const failMsg = buildRetriesExhaustedError(
            message.attempts,

            maxRetries,

            `retry_failed: ${err.message}`,
          );

          await failEvalJobFromQueue(env.cubewizard_db, uploadId, failMsg);

          try {
            message.ack();
          } catch {
            throw e;
          }
        }
      }
    });
  } finally {
    resetEvalInvocationGlobals();
  }
}

/**

 * Cloudflare Queue consumer: orient queue → `runOrientTask`; extract queue → `runExtractTask`.

 * One deck per message (`max_batch_size: 1`).

 */

export default {
  async queue(
    batch: { queue: string; messages: QueueMessage[] },

    env: RunEvalTaskEnv,
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
          await processEvalQueueMessage(message, env, maxRetries, queueName);
        }
      }
    } catch (e) {
      const err = evalErrorFields(e);

      logEvalConsumerError(
        "batch_fatal",
        {
          error: err.message,

          likely_memory_limit: err.likely_memory_limit ?? false,
        },
        env,
      );

      throw e;
    }
  },
};
