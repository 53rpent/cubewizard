import type { ExtractTaskRequest } from "../contracts/extractTaskRequest.zod";
import { TaskRequestSchema } from "../contracts/taskRequest.zod";
import { fetchCubeCobraMainboardNames } from "../cubecobra/fetchCubeList";
import { computeImageId } from "../d1/imageId";
import { isLocalEvalEnv } from "../evalEnv/isLocalEvalEnv";
import { encodeJpeg } from "../images/encode";
import { assertVisionPublishConfigured, createVisionImagePublisher } from "../images/visionPublish";
import { orientDeckImageRgba } from "../orientation/orientDeckImage";
import { logEvalConsumer } from "../util/evalConsumerLog";
import {
  bytesToMb,
  estimateEvalRgbaPeakMb,
  mergeActiveEvalBufferEstimates,
  rgbaFrameBytes,
} from "../util/evalMemoryProbe";
import { PermanentEvalError } from "./evalErrors";
import {
  ensureQueuedProcessingJob,
  readImageFromUrl,
  readStagingPackage,
  resolveDeckMetadata,
  resolveEvalPipelineConfig,
} from "./evalTaskShared";
import { markJobRunning } from "./processingJobRepo";
import type { RunEvalTaskEnv } from "./runEvalTask";
import { uploadOrientedJpeg } from "./uploadOriented";

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
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: orient phase validates input, normalizes image, and enqueues extract work
export async function runOrientTask(rawBody: unknown, env: RunEvalTaskEnv, fetchImpl?: typeof fetch): Promise<void> {
  const parsed = TaskRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new PermanentEvalError(`invalid_task_request: ${parsed.error.message}`);
  }
  const task = parsed.data;
  const cubeId = (task.cube_id || "").trim();
  if (!cubeId) {
    throw new PermanentEvalError("cube_id_required");
  }

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
      owner_user_id: task.owner_user_id,
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
    apiKey: cfg.visionApiKey,
    model: cfg.visionModel,
    reasoningEffort: cfg.orientReasoning,
    promptCacheKey: `cube:${cubeId}`,
    jpegQuality: cfg.jpegQ,
    maxImageSide: cfg.maxImageSide,
    visionEnv: env,
    vision,
    fetchImpl,
    openAiLogLevel: cfg.openAiLogLevel,
    baseUrl: cfg.visionBaseUrl,
    gatewayToken: cfg.openAiGatewayToken,
    aiGatewayId: cfg.aiGatewayId,
    requestTimeoutMs: cfg.openAiRequestTimeoutMs,
    onStagingBytesDecoded: () => {
      imageBytes = undefined;
    },
    orientLightExtract: {
      apiKey: cfg.visionApiKey,
      model: cfg.visionModel,
      cubeCardList: cubeList,
      expectedDeckSize: deckMeta.expectedDeckSize,
      maxImageSide: cfg.maxImageSide,
      jpegQuality: cfg.jpegQ,
      cubeId,
      visionEnv: env,
      vision,
      fetchImpl,
      openAiLogLevel: cfg.openAiLogLevel,
      baseUrl: cfg.visionBaseUrl,
      gatewayToken: cfg.openAiGatewayToken,
      aiGatewayId: cfg.aiGatewayId,
      requestTimeoutMs: cfg.openAiRequestTimeoutMs,
    },
  });

  mergeActiveEvalBufferEstimates({
    est_rgba_mb: bytesToMb(rgbaFrameBytes(orientedRgba)),
    est_rgba_peak_mb: estimateEvalRgbaPeakMb(orientedRgba),
    oriented_w: orientedRgba.width,
    oriented_h: orientedRgba.height,
  });

  const imageSource =
    typeof metadata.image_source === "string"
      ? metadata.image_source
      : typeof task.image_source === "string"
        ? task.image_source
        : undefined;
  const imageId = await computeImageId(cubeId, deckMeta.pilot, deckMeta.processingTs, { imageSource });
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
    image_source: imageSource ?? "",
    staging_image_r2_key: metadata.image_key,
    match_wins: deckMeta.wins,
    match_losses: deckMeta.losses,
    match_draws: deckMeta.draws,
    win_rate: deckMeta.winRate,
    expected_deck_size: deckMeta.expectedDeckSize,
  };
  if (
    typeof metadata.owner_user_id === "number" &&
    Number.isFinite(metadata.owner_user_id) &&
    metadata.owner_user_id > 0
  ) {
    extractBody.owner_user_id = Math.floor(metadata.owner_user_id);
  } else if (typeof task.owner_user_id === "number" && Number.isFinite(task.owner_user_id) && task.owner_user_id > 0) {
    extractBody.owner_user_id = Math.floor(task.owner_user_id);
  }
  if (typeof task.replace_deck_id === "number" && Number.isFinite(task.replace_deck_id) && task.replace_deck_id > 0) {
    extractBody.replace_deck_id = Math.floor(task.replace_deck_id);
  }

  await enqueueExtractTask(env, extractBody);
}
