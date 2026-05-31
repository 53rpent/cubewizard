import { resolveOpenAiApiKey } from "../config/resolveOpenAiApiKey";
import evalConsumer from "../entry/evalQueueEntry";
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

type QueueMessage = {
  id: string;
  body: unknown;
  attempts: number;
  ack(): void;
  retry(): void;
};

/**
 * Mirror production: when orient enqueues extract work, invoke the extract queue consumer inline.
 * Patches `EVAL_EXTRACT_QUEUE` on the shared harness env for one case run.
 */
export function bindGoldenExtractQueueInline(
  env: RunEvalTaskEnv,
  caseId: string,
  onExtractAcked: () => void,
): RunEvalTaskEnv {
  const bound: RunEvalTaskEnv = { ...env };
  bound.EVAL_EXTRACT_QUEUE = {
    send: async (body) => {
      const message: QueueMessage = {
        id: `golden-extract-${caseId}`,
        body,
        attempts: 1,
        ack() {
          onExtractAcked();
        },
        retry() {
          throw new Error("golden_harness_unexpected_extract_retry");
        },
      };
      await evalConsumer.queue({ queue: GOLDEN_EVAL_EXTRACT_QUEUE, messages: [message] }, bound);
    },
  };
  return bound;
}

/**
 * Run one golden case: orient queue message → extract queue message (two consumer invocations).
 */
export async function runGoldenCaseViaEvalConsumer(
  opts: RunGoldenCaseViaConsumerOptions,
): Promise<GoldenConsumerRunResult> {
  let orientAcked = false;
  let extractAcked = false;

  const baseEnv = opts.env ?? buildGoldenEvalConsumerEnv({ repoRoot: opts.repoRoot });
  const env = bindGoldenExtractQueueInline(baseEnv, opts.goldenCase.case_id, () => {
    extractAcked = true;
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
    env,
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
