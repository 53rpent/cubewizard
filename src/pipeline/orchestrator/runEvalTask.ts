/**
 * Eval pipeline types and legacy export. Production queue flow uses `runOrientTask` + `runExtractTask`
 * in separate queue invocations (see `evalQueueEntry.ts`).
 */
export { PermanentEvalError } from "./evalErrors";

export interface R2BucketGetPut {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(
    key: string,
    value: Uint8Array | ReadableStream,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<void>;
}

export interface EvalExtractQueueBinding {
  send(body: unknown, options?: { contentType?: string }): Promise<void>;
}

export interface RunEvalTaskEnv {
  CWW_ENV?: string;
  OPENAI_API_KEY?: string;
  OPENAI_VISION_MODEL?: string;
  OPENAI_MAX_OUTPUT_TOKENS?: string;
  OPENAI_REASONING_EFFORT?: string;
  OPENAI_ORIENT_REASONING_EFFORT?: string;
  CW_EVAL_MAX_CUBECOBRA_CARDS?: string;
  CW_EVAL_USE_MULTI_PASS?: string;
  CW_EVAL_JPEG_QUALITY?: string;
  CW_EVAL_LOG_LEVEL?: string;
  CW_EVAL_VERBOSE_LOG?: string;
  CW_EVAL_MAX_CONSUMERS?: string;
  CW_EVAL_MAX_RETRIES?: string;
  CW_EVAL_MAX_IMAGE_SIDE?: string;
  CW_EVAL_MEMORY_LOG?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  CW_EVAL_VISION_R2_BUCKET?: string;
  cubewizard_db: import("./processingJobRepo").D1DatabaseLike;
  BUCKET: R2BucketGetPut;
  DECK_IMAGES_BLOB: R2BucketGetPut;
  /** Orient stage enqueues phase-2 work here. */
  EVAL_EXTRACT_QUEUE?: EvalExtractQueueBinding;
}

export { runExtractTask } from "./runExtractTask";
export { runOrientTask } from "./runOrientTask";
