import { isLocalEvalEnv } from "../env/isLocalEvalEnv";
import type { R2PutBucket } from "../orchestrator/uploadOriented";
import {
  createR2PresignedGetUrl,
  hasR2PresignCredentials,
  publicUrlForR2Key,
  R2_PRESIGN_EXPIRES_SECONDS_DEFAULT,
  R2_VISION_BUCKET_DEFAULT,
  type R2PresignEnv,
  type VisionUrlMode,
} from "../r2/presignedGetUrl";
import { PermanentEvalError } from "../orchestrator/evalErrors";

export interface VisionPublishEnv extends R2PresignEnv {
  CWW_ENV?: string;
  DECK_IMAGE_PUBLIC_BASE_URL?: string;
  CW_EVAL_VISION_PUBLIC_BASE_URL?: string;
}

export function visionPublicBaseUrl(env: VisionPublishEnv): string | null {
  const raw = String(
    env.CW_EVAL_VISION_PUBLIC_BASE_URL || env.DECK_IMAGE_PUBLIC_BASE_URL || ""
  ).trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

export function safeUploadIdForKey(uploadId: string): string {
  return String(uploadId || "unknown")
    .replace(/[^a-zA-Z0-9_\-:.]/g, "_")
    .slice(0, 200);
}

export function visionOrientObjectKey(uploadId: string, step: number): string {
  return `tmp/vision/${safeUploadIdForKey(uploadId)}/orient-${step}.jpg`;
}

export function visionExtractObjectKey(uploadId: string): string {
  return `tmp/vision/${safeUploadIdForKey(uploadId)}/extract.jpg`;
}

export interface VisionImagePublisher {
  readonly urlMode: VisionUrlMode;
  /** Publish orientation preview JPEG; new object key per step (cache-safe). */
  publishOrientStep(step: number, jpegBytes: Uint8Array): Promise<string>;
  /** Publish full-quality extraction JPEG; reuse returned URL for all extraction passes. */
  publishExtract(jpegBytes: Uint8Array): Promise<string>;
}

export function assertVisionPublishConfigured(env: VisionPublishEnv): void {
  if (isLocalEvalEnv(env)) return;
  if (visionPublicBaseUrl(env)) return;
  if (hasR2PresignCredentials(env)) return;
  throw new PermanentEvalError(
    "vision_url_config_missing: set DECK_IMAGE_PUBLIC_BASE_URL or R2 presign secrets " +
      "(CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)"
  );
}

export function createVisionImagePublisher(opts: {
  uploadId: string;
  blob: R2PutBucket;
  env: VisionPublishEnv;
  presignExpiresSeconds?: number;
}): VisionImagePublisher {
  const publicBase = visionPublicBaseUrl(opts.env);
  const urlMode: VisionUrlMode = publicBase ? "public" : "presigned";
  const expires = opts.presignExpiresSeconds ?? R2_PRESIGN_EXPIRES_SECONDS_DEFAULT;
  const bucket = String(opts.env.CW_EVAL_VISION_R2_BUCKET ?? R2_VISION_BUCKET_DEFAULT).trim();

  async function putAndResolveUrl(objectKey: string, jpegBytes: Uint8Array): Promise<string> {
    await opts.blob.put(objectKey, jpegBytes, {
      httpMetadata: { contentType: "image/jpeg" },
    });
    if (publicBase) {
      return publicUrlForR2Key(publicBase, objectKey);
    }
    try {
      return await createR2PresignedGetUrl(
        { ...opts.env, CW_EVAL_VISION_R2_BUCKET: bucket },
        objectKey,
        expires
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new PermanentEvalError(`vision_presign_failed: ${msg}`);
    }
  }

  return {
    urlMode,
    publishOrientStep(step, jpegBytes) {
      return putAndResolveUrl(visionOrientObjectKey(opts.uploadId, step), jpegBytes);
    },
    publishExtract(jpegBytes) {
      return putAndResolveUrl(visionExtractObjectKey(opts.uploadId), jpegBytes);
    },
  };
}
