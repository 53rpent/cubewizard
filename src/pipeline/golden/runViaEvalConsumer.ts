import evalConsumer from "../entry/evalQueueEntry";
import { resolveOpenAiApiKey } from "../config/resolveOpenAiApiKey";
import type { EvalRunReport } from "../evalUsage/evalUsageReport";
import type { RunEvalTaskEnv } from "../orchestrator/runEvalTask";
import { buildGoldenEvalConsumerEnv } from "./loadEvalConsumerEnv";
import { readProcessingJobOutcome } from "./readJobResult";
import { stageGoldenCaseOnR2 } from "./stageGoldenCase";
import type { GoldenCaseDefinition } from "./types";

export const GOLDEN_EVAL_ORIENT_QUEUE = "cubewizard-eval-local";
export const GOLDEN_EVAL_EXTRACT_QUEUE = "cubewizard-eval-extract-local";

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
 * Run one golden case: orient queue message → extract queue message (two consumer invocations).
 */
export async function runGoldenCaseViaEvalConsumer(
  opts: RunGoldenCaseViaConsumerOptions
): Promise<GoldenConsumerRunResult> {
  let orientAcked = false;
  let extractAcked = false;

  const env =
    opts.env ??
    buildGoldenEvalConsumerEnv({
      repoRoot: opts.repoRoot,
      onExtractEnqueued: async (body, runEnv) => {
        await evalConsumer.queue(
          {
            queue: GOLDEN_EVAL_EXTRACT_QUEUE,
            messages: [
              {
                id: `golden-extract-${opts.goldenCase.case_id}`,
                body,
                attempts: 1,
                ack() {
                  extractAcked = true;
                },
                retry() {
                  throw new Error("golden_harness_unexpected_extract_retry");
                },
              },
            ],
          },
          runEnv
        );
      },
    });

  resolveOpenAiApiKey(env);

  const staged = await stageGoldenCaseOnR2(env.BUCKET, opts.goldenCase);

  await evalConsumer.queue(
    {
      queue: GOLDEN_EVAL_ORIENT_QUEUE,
      messages: [
        {
          id: `golden-orient-${opts.goldenCase.case_id}`,
          body: staged.task,
          attempts: 1,
          ack() {
            orientAcked = true;
          },
          retry() {
            throw new Error("golden_harness_unexpected_orient_retry");
          },
        },
      ],
    },
    env
  );

  if (!orientAcked) {
    throw new Error(`eval orient consumer did not ack for ${opts.goldenCase.case_id}`);
  }
  if (!extractAcked) {
    throw new Error(`eval extract consumer did not ack for ${opts.goldenCase.case_id}`);
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
