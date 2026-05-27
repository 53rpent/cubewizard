import {
  EVAL_IMAGE_SIDE_UNLIMITED,
  parseEvalJpegQuality,
  parseEvalMaxImageSide,
} from "../orchestrator/evalImageLimits";
import { decodeToRgba } from "./decode";
import { encodeJpeg } from "./encode";
import { readImageDimensions } from "./readImageDimensions";
import { sniffImageFormat } from "./sniff";
import { resizeToMaxSide } from "./transform";

/** Minimal Cloudflare Images binding surface (see Workers Images API). */
export interface StagingImagesBinding {
  info(stream: ReadableStream): Promise<{ width?: number; height?: number; format?: string }>;
  input(stream: ReadableStream): StagingImagesTransformChain;
}

export interface StagingImagesTransformChain {
  transform(opts: Record<string, string | number>): StagingImagesTransformChain;
  output(opts: { format: string; quality?: number }): Promise<StagingImagesOutputResult>;
}

export interface StagingImagesOutputResult {
  response(): Response | Promise<Response>;
}

export interface NormalizeStagingOptions {
  maxSide: number;
  jpegQuality: number;
}

export interface NormalizeStagingResult {
  bytes: Uint8Array;
  width: number;
  height: number;
  originalWidth?: number;
  originalHeight?: number;
  method: "images_binding" | "decode_fallback";
}

export interface StagingImageEnv {
  CW_STAGING_MAX_IMAGE_SIDE?: string;
  CW_EVAL_MAX_IMAGE_SIDE?: string;
  CW_STAGING_JPEG_QUALITY?: string;
  CW_EVAL_JPEG_QUALITY?: string;
}

const DEFAULT_STAGING_MAX_SIDE = 3072;

export function parseStagingImageConfig(env: StagingImageEnv = {}): NormalizeStagingOptions {
  const maxSideRaw = env.CW_STAGING_MAX_IMAGE_SIDE ?? env.CW_EVAL_MAX_IMAGE_SIDE ?? String(DEFAULT_STAGING_MAX_SIDE);
  let maxSide = parseEvalMaxImageSide(maxSideRaw);
  if (maxSide <= 0 || maxSide === EVAL_IMAGE_SIDE_UNLIMITED) {
    maxSide = DEFAULT_STAGING_MAX_SIDE;
  }
  const jpegQuality = parseEvalJpegQuality(env.CW_STAGING_JPEG_QUALITY ?? env.CW_EVAL_JPEG_QUALITY);
  return { maxSide, jpegQuality };
}

function bytesToReadableStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function readResponseBytes(response: Response): Promise<Uint8Array> {
  const buf = await response.arrayBuffer();
  return new Uint8Array(buf);
}

/** Dev/test fallback when `IMAGES` binding is unavailable (full RGBA decode — not for 12MP in Workers). */
export async function normalizeStagingImageFallback(
  input: Uint8Array,
  opts: NormalizeStagingOptions,
): Promise<NormalizeStagingResult> {
  const fmt = sniffImageFormat(input);
  if (fmt === "unknown") {
    throw new Error("staging_normalize_unknown_format");
  }
  const original = readImageDimensions(input, fmt);
  const frame = resizeToMaxSide(await decodeToRgba(input, fmt), opts.maxSide, opts.maxSide);
  const bytes = encodeJpeg(frame, opts.jpegQuality);
  return {
    bytes,
    width: frame.width,
    height: frame.height,
    originalWidth: original.width,
    originalHeight: original.height,
    method: "decode_fallback",
  };
}

async function normalizeViaImagesBinding(
  images: StagingImagesBinding,
  input: Uint8Array,
  opts: NormalizeStagingOptions,
): Promise<NormalizeStagingResult> {
  let originalWidth: number | undefined;
  let originalHeight: number | undefined;
  try {
    const info = await images.info(bytesToReadableStream(input));
    if (info.width && info.height) {
      originalWidth = info.width;
      originalHeight = info.height;
    }
  } catch {}

  if (originalWidth == null || originalHeight == null) {
    try {
      const dims = readImageDimensions(input);
      originalWidth = dims.width;
      originalHeight = dims.height;
    } catch {}
  }

  const output = await images
    .input(bytesToReadableStream(input))
    .transform({ width: opts.maxSide, height: opts.maxSide, fit: "scale-down" })
    .output({ format: "image/jpeg", quality: opts.jpegQuality });
  const transformed = await output.response();

  if (!transformed.ok) {
    const detail = await transformed.text().catch(() => "");
    throw new Error(`staging_images_transform_failed: HTTP ${transformed.status} ${detail.slice(0, 200)}`);
  }

  const bytes = await readResponseBytes(transformed);
  if (!bytes.byteLength) {
    throw new Error("staging_images_transform_empty");
  }

  const out = readImageDimensions(bytes, "jpeg");
  return {
    bytes,
    width: out.width,
    height: out.height,
    originalWidth,
    originalHeight,
    method: "images_binding",
  };
}

/**
 * Downscale staging uploads to a bounded JPEG via Cloudflare Images (production)
 * or RGBA decode fallback (Vitest / missing binding).
 */
export async function normalizeStagingImage(
  images: StagingImagesBinding | null | undefined,
  input: ReadableStream<Uint8Array> | Uint8Array,
  opts: NormalizeStagingOptions,
): Promise<NormalizeStagingResult> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(await new Response(input).arrayBuffer());

  if (bytes.byteLength === 0) {
    throw new Error("staging_normalize_empty_input");
  }

  if (images && typeof images.input === "function") {
    return normalizeViaImagesBinding(images, bytes, opts);
  }

  return normalizeStagingImageFallback(bytes, opts);
}
