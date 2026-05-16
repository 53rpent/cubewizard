import { isLocalEvalEnv } from "../evalEnv/isLocalEvalEnv";
import type { R2PutBucket } from "../orchestrator/uploadOriented";
import {
  createR2PresignedGetUrl,
  hasR2PresignCredentials,
  R2_PRESIGN_EXPIRES_SECONDS_DEFAULT,
  R2_VISION_BUCKET_DEFAULT,
  type R2PresignEnv,
} from "../r2/presignedGetUrl";
import { PermanentEvalError } from "../orchestrator/evalErrors";

export interface VisionPublishEnv extends R2PresignEnv {
  CWW_ENV?: string;
}

/** R2 object-key segment: no `/` or `:` (breaks SigV4 presigned GET paths for OpenAI). */
export function safeUploadIdForKey(uploadId: string): string {
  return String(uploadId || "unknown")
    .replace(/[:/]/g, "_")
    .replace(/[^a-zA-Z0-9_\-]/g, "_")
    .slice(0, 200);
}

export function visionOrientObjectKey(uploadId: string, step: number): string {
  return `tmp/vision/${safeUploadIdForKey(uploadId)}/orient-${step}.jpg`;
}

export function visionExtractObjectKey(uploadId: string): string {
  return `tmp/vision/${safeUploadIdForKey(uploadId)}/extract.jpg`;
}

export interface VisionImagePublisher {
  /** Publish orientation preview JPEG; new object key per step (cache-safe). */
  publishOrientStep(step: number, jpegBytes: Uint8Array): Promise<string>;
  /** Publish full-quality extraction JPEG; reuse returned URL for all extraction passes. */
  publishExtract(jpegBytes: Uint8Array): Promise<string>;
}

export function assertVisionPublishConfigured(env: VisionPublishEnv): void {
  if (isLocalEvalEnv(env)) return;
  if (hasR2PresignCredentials(env)) return;
  throw new PermanentEvalError(
    "vision_url_config_missing: set R2 presign secrets " +
      "(CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)"
  );
}

export function createVisionImagePublisher(opts: {
  uploadId: string;
  blob: R2PutBucket;
  env: VisionPublishEnv;
  presignExpiresSeconds?: number;
  fetchImpl?: typeof fetch;
}): VisionImagePublisher {
  const expires = opts.presignExpiresSeconds ?? R2_PRESIGN_EXPIRES_SECONDS_DEFAULT;
  const bucket = String(opts.env.CW_EVAL_VISION_R2_BUCKET ?? R2_VISION_BUCKET_DEFAULT).trim();

  async function putAndPresignUrl(
    objectKey: string,
    jpegBytes: Uint8Array,
    fetchImpl?: typeof fetch
  ): Promise<string> {
    await opts.blob.put(objectKey, jpegBytes, {
      httpMetadata: { contentType: "image/jpeg" },
    });
    try {
      return await createR2PresignedGetUrl(
        { ...opts.env, CW_EVAL_VISION_R2_BUCKET: bucket },
        objectKey,
        expires,
        fetchImpl
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new PermanentEvalError(`vision_presign_failed: ${msg}`);
    }
  }

  return {
    publishOrientStep(step, jpegBytes) {
      return putAndPresignUrl(
        visionOrientObjectKey(opts.uploadId, step),
        jpegBytes,
        opts.fetchImpl
      );
    },
    publishExtract(jpegBytes) {
      return putAndPresignUrl(visionExtractObjectKey(opts.uploadId), jpegBytes, opts.fetchImpl);
    },
  };
}
