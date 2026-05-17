import evalConsumer from "../entry/evalQueueEntry";
import { resolveOpenAiApiKey } from "../config/resolveOpenAiApiKey";
import type { EvalRunReport } from "../evalUsage/evalUsageReport";
import type { RunEvalTaskEnv } from "../orchestrator/runEvalTask";
import { buildGoldenEvalConsumerEnv } from "./loadEvalConsumerEnv";
import { readProcessingJobOutcome } from "./readJobResult";
import { stageGoldenCaseOnR2 } from "./stageGoldenCase";
import type { GoldenCaseDefinition } from "./types";

export interface GoldenConsumerRunResult {
  upload_id: string;
  job_status: string;
  job_error: string | null;
  eval_report: EvalRunReport | null;
}

export interface RunGoldenCaseViaConsumerOptions {
  repoRoot: string;
  goldenCase: GoldenCaseDefinition;
  env?: RunEvalTaskEnv;
  fetchImpl?: typeof fetch;
}

/**
 * Run one golden case through the eval queue consumer (`evalQueueEntry` → `runEvalTask`).
 * OpenAI calls happen inside the consumer; the harness only stages R2 + enqueues.
 */
export async function runGoldenCaseViaEvalConsumer(
  opts: RunGoldenCaseViaConsumerOptions
): Promise<GoldenConsumerRunResult> {
  const env = opts.env ?? buildGoldenEvalConsumerEnv({ repoRoot: opts.repoRoot });
  resolveOpenAiApiKey(env);

  const staged = await stageGoldenCaseOnR2(env.BUCKET, opts.goldenCase);

  let acked = false;
  const message = {
    id: `golden-msg-${opts.goldenCase.case_id}`,
    body: staged.task,
    attempts: 1,
    ack() {
      acked = true;
    },
    retry() {
      throw new Error("golden_harness_unexpected_retry");
    },
  };

  await evalConsumer.queue(
    { queue: "cubewizard-eval-local", messages: [message] },
    env
  );

  if (!acked) {
    throw new Error(`eval_consumer did not ack message for ${opts.goldenCase.case_id}`);
  }

  const outcome = await readProcessingJobOutcome(env.cubewizard_db, staged.upload_id);
  if (!outcome) {
    throw new Error(`processing_jobs row missing for ${staged.upload_id}`);
  }

  return {
    upload_id: staged.upload_id,
    job_status: outcome.status,
    job_error: outcome.error,
    eval_report: outcome.eval_report,
  };
}
