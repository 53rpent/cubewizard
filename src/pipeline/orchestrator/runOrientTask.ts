import { TaskRequestSchema } from "../contracts/taskRequest.zod";
import type { ExtractTaskRequest } from "../contracts/extractTaskRequest.zod";
import { fetchCubeCobraMainboardNames } from "../cubecobra/fetchCubeList";
import { encodeJpeg } from "../images/encode";
import { orientDeckImageRgba } from "../orientation/orientDeckImage";
import { computeImageId } from "../d1/imageId";
import { resolveOpenAiApiKey } from "../config/resolveOpenAiApiKey";
import { isLocalEvalEnv } from "../evalEnv/isLocalEvalEnv";
import {
  assertVisionPublishConfigured,
  createVisionImagePublisher,
} from "../images/visionPublish";
import { PermanentEvalError } from "./evalErrors";
import { markJobRunning } from "./processingJobRepo";
import { uploadOrientedJpeg } from "./uploadOriented";
import type { RunEvalTaskEnv } from "./runEvalTask";
import { logEvalConsumer } from "../util/evalConsumerLog";
import {
  bytesToMb,
  estimateEvalRgbaPeakMb,
  mergeActiveEvalBufferEstimates,
  rgbaFrameBytes,
} from "../util/evalMemoryProbe";
import {
  ensureQueuedProcessingJob,
  readImageFromUrl,
  readStagingPackage,
  resolveDeckMetadata,
  resolveEvalPipelineConfig,
} from "./evalTaskShared";

async function enqueueExtractTask(env: RunEvalTaskEnv, body: ExtractTaskRequest): Promise<void> {
  const q = env.EVAL_EXTRACT_QUEUE;
  if (!q || typeof q.send !== "function") {
    throw new PermanentEvalError("missing_eval_extract_queue_binding");
  }
  await q.send(body, { contentType: "json" });
  logEvalConsumer("queue_send", {
    upload_id: body.upload_id,
    target: "extract",
    oriented_image_r2_key: body.oriented_image_r2_key,
    image_id: body.image_id,
  });
}

/**
 * Phase 1: load staging image → orient → upload oriented JPEG → enqueue extract queue message.
 */
export async function runOrientTask(
  rawBody: unknown,
  env: RunEvalTaskEnv,
  fetchImpl?: typeof fetch
): Promise<void> {
  const parsed = TaskRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new PermanentEvalError(`invalid_task_request: ${parsed.error.message}`);
  }
  const task = parsed.data;
  const cubeId = (task.cube_id || "").trim();
  if (!cubeId) {
    throw new PermanentEvalError("cube_id_required");
  }

  const apiKey = resolveOpenAiApiKey(env);
  const model = String(env.OPENAI_VISION_MODEL || "gpt-5-mini-2025-08-07").trim();
  const cfg = resolveEvalPipelineConfig(env);
  const localVision = isLocalEvalEnv(env);
  if (!localVision) assertVisionPublishConfigured(env);
  const vision = localVision
    ? undefined
    : createVisionImagePublisher({
        uploadId: task.upload_id,
        blob: env.DECK_IMAGES_BLOB,
        env,
        fetchImpl,
      });

  await ensureQueuedProcessingJob(env.cubewizard_db, task);

  let imageBytes: Uint8Array | undefined;
  let metadata: import("./evalTaskShared").StagingMetadata;

  if (task.image_url) {
    imageBytes = await readImageFromUrl(task, fetchImpl);
    metadata = {
      cube_id: cubeId,
      pilot_name: task.pilot_name,
      match_wins: task.match_wins ?? 0,
      match_losses: task.match_losses ?? 0,
      match_draws: task.match_draws ?? 0,
      win_rate:
        (task.match_wins ?? 0) + (task.match_losses ?? 0) > 0
          ? (task.match_wins ?? 0) / ((task.match_wins ?? 0) + (task.match_losses ?? 0))
          : 0,
      record_logged: task.submitted_at || new Date().toISOString(),
    };
  } else {
    const pack = await readStagingPackage(task, env.BUCKET);
    imageBytes = pack.imageBytes;
    metadata = pack.metadata;
  }

  await markJobRunning(env.cubewizard_db, task.upload_id);

  const deckMeta = resolveDeckMetadata(task, metadata, cubeId);
  const cubeList = await fetchCubeCobraMainboardNames(cubeId, {
    fetchImpl,
    maxCards: cfg.maxCubeCards,
  });

  if (!imageBytes?.byteLength) {
    throw new PermanentEvalError("staging_image_missing");
  }

  mergeActiveEvalBufferEstimates({
    est_staging_jpeg_mb: bytesToMb(imageBytes.byteLength),
  });

  const { frame: orientedRgba } = await orientDeckImageRgba(imageBytes, undefined, {
    apiKey,
    model,
    reasoningEffort: cfg.orientReasoning,
    promptCacheKey: `cube:${cubeId}`,
    jpegQuality: cfg.jpegQ,
    maxImageSide: cfg.maxImageSide,
    visionEnv: env,
    vision,
    fetchImpl,
    openAiLogLevel: cfg.openAiLogLevel,
    onStagingBytesDecoded: () => {
      imageBytes = undefined;
    },
    orientLightExtract: {
      apiKey,
      model,
      cubeCardList: cubeList,
      expectedDeckSize: deckMeta.expectedDeckSize,
      maxImageSide: cfg.maxImageSide,
      jpegQuality: cfg.jpegQ,
      cubeId,
      visionEnv: env,
      vision,
      fetchImpl,
      openAiLogLevel: cfg.openAiLogLevel,
    },
  });

  mergeActiveEvalBufferEstimates({
    est_rgba_mb: bytesToMb(rgbaFrameBytes(orientedRgba)),
    est_rgba_peak_mb: estimateEvalRgbaPeakMb(orientedRgba),
    oriented_w: orientedRgba.width,
    oriented_h: orientedRgba.height,
  });

  const imageId = await computeImageId(cubeId, deckMeta.pilot, deckMeta.processingTs);
  const orientedBytes = encodeJpeg(orientedRgba, cfg.jpegQ);
  const uploaded = await uploadOrientedJpeg({
    blob: env.DECK_IMAGES_BLOB,
    cubeId,
    imageId,
    jpegBytes: orientedBytes,
  });

  const extractBody: ExtractTaskRequest = {
    upload_id: task.upload_id,
    schema_version: 2,
    cube_id: cubeId,
    image_id: imageId,
    oriented_image_r2_key: uploaded.orientedKey,
    processing_timestamp: deckMeta.processingTs,
    pilot_name: deckMeta.pilot,
    record_logged: deckMeta.recordLogged,
    image_source: task.image_url || metadata.image_key || "",
    staging_image_r2_key: metadata.image_key,
    match_wins: deckMeta.wins,
    match_losses: deckMeta.losses,
    match_draws: deckMeta.draws,
    win_rate: deckMeta.winRate,
    expected_deck_size: deckMeta.expectedDeckSize,
  };

  await enqueueExtractTask(env, extractBody);
}
