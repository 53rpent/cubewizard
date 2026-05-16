import { isLocalEvalEnv } from "../evalEnv/isLocalEvalEnv";
import { PermanentEvalError } from "../orchestrator/evalErrors";
import type { VisionImageInput } from "../openai/responsesApi";
import type { VisionImagePublisher } from "./visionPublish";

function jpegBytesToBase64(jpegBytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < jpegBytes.length; i += chunk) {
    binary += String.fromCharCode(...jpegBytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Publish JPEG to R2 and return HTTPS URL for OpenAI (hosted eval only). */
export async function visionUrlFromJpegBytes(
  publisher: VisionImagePublisher,
  jpegBytes: Uint8Array,
  purpose: "orient",
  step: number
): Promise<VisionImageInput>;
export async function visionUrlFromJpegBytes(
  publisher: VisionImagePublisher,
  jpegBytes: Uint8Array,
  purpose: "extract"
): Promise<VisionImageInput>;
export async function visionUrlFromJpegBytes(
  publisher: VisionImagePublisher,
  jpegBytes: Uint8Array,
  purpose: "orient" | "extract",
  step?: number
): Promise<VisionImageInput> {
  const url =
    purpose === "orient"
      ? await publisher.publishOrientStep(step ?? 0, jpegBytes)
      : await publisher.publishExtract(jpegBytes);
  return { imageUrl: url };
}

/**
 * Local (`CWW_ENV=local`): inline JPEG as base64 in the OpenAI request.
 * Hosted: R2 publish + presigned or public HTTPS URL.
 */
export async function visionInputFromJpegBytes(opts: {
  env: { CWW_ENV?: string };
  publisher?: VisionImagePublisher;
  jpegBytes: Uint8Array;
  purpose: "orient" | "extract";
  step?: number;
}): Promise<VisionImageInput> {
  if (isLocalEvalEnv(opts.env)) {
    return { imageBase64: jpegBytesToBase64(opts.jpegBytes) };
  }
  if (!opts.publisher) {
    throw new PermanentEvalError("vision_publisher_required");
  }
  if (opts.purpose === "orient") {
    return visionUrlFromJpegBytes(opts.publisher, opts.jpegBytes, "orient", opts.step ?? 0);
  }
  return visionUrlFromJpegBytes(opts.publisher, opts.jpegBytes, "extract");
}
