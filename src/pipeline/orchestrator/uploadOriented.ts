import { normalizeStoredImagePathRelativeToOutput } from "../d1/storedPath";
import { encodeJpeg } from "../images/encode";
import { orientedObjectKey, orientedThumbObjectKey } from "../r2/orientedKeys";
import { buildThumbWebpBytesFromRgba } from "../r2/thumbWebp";

export interface R2PutBucket {
  put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<void>;
}

export async function uploadOrientedJpeg(opts: {
  blob: R2PutBucket;
  cubeId: string;
  imageId: string;
  jpegBytes: Uint8Array;
}): Promise<{ orientedKey: string; storedImagePath: string; ext: string }> {
  const ext = ".jpg";
  const orientedKey = orientedObjectKey(opts.cubeId, opts.imageId, ext);
  await opts.blob.put(orientedKey, opts.jpegBytes, {
    httpMetadata: { contentType: "image/jpeg" },
  });
  const rel = `stored_images/${opts.imageId}${ext}`;
  return {
    orientedKey,
    storedImagePath: normalizeStoredImagePathRelativeToOutput(rel),
    ext,
  };
}

export async function uploadOrientedThumb(opts: {
  blob: R2PutBucket;
  cubeId: string;
  imageId: string;
  orientedRgba: import("../images/types").RgbaFrame;
}): Promise<{ thumbKey: string }> {
  const thumbBytes = await buildThumbWebpBytesFromRgba(opts.orientedRgba);
  const thumbKey = orientedThumbObjectKey(opts.cubeId, opts.imageId);
  await opts.blob.put(thumbKey, thumbBytes, {
    httpMetadata: { contentType: "image/webp" },
  });
  return { thumbKey };
}

/** Store oriented deck photo as **JPEG** + WebP thumb (single-invocation path / tests). */
export async function uploadOrientedImageAndThumb(opts: {
  blob: R2PutBucket;
  cubeId: string;
  imageId: string;
  orientedRgba: import("../images/types").RgbaFrame;
  jpegQuality?: number;
}): Promise<{ orientedKey: string; thumbKey: string; storedImagePath: string; ext: string }> {
  const orientedBytes = encodeJpeg(opts.orientedRgba, opts.jpegQuality ?? 100);
  const jpeg = await uploadOrientedJpeg({
    blob: opts.blob,
    cubeId: opts.cubeId,
    imageId: opts.imageId,
    jpegBytes: orientedBytes,
  });
  const thumb = await uploadOrientedThumb({
    blob: opts.blob,
    cubeId: opts.cubeId,
    imageId: opts.imageId,
    orientedRgba: opts.orientedRgba,
  });
  return {
    orientedKey: jpeg.orientedKey,
    thumbKey: thumb.thumbKey,
    storedImagePath: jpeg.storedImagePath,
    ext: jpeg.ext,
  };
}
