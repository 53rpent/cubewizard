import { encodeJpeg } from "../images/encode";
import { orientedObjectKey, orientedThumbObjectKey } from "../r2/orientedKeys";
import { buildThumbWebpBytesFromRgba } from "../r2/thumbWebp";
import { normalizeStoredImagePathRelativeToOutput } from "../d1/storedPath";

export interface R2PutBucket {
  put(
    key: string,
    value: Uint8Array,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<void>;
}

/**
 * Store oriented deck photo as **JPEG** (quality 95) + WebP thumb — matches common Python `.jpg` output.
 */
export async function uploadOrientedImageAndThumb(opts: {
  blob: R2PutBucket;
  cubeId: string;
  imageId: string;
  orientedRgba: import("../images/types").RgbaFrame;
}): Promise<{ orientedKey: string; thumbKey: string; storedImagePath: string; ext: string }> {
  const ext = ".jpg";
  const orientedBytes = encodeJpeg(opts.orientedRgba, 95);
  const orientedKey = orientedObjectKey(opts.cubeId, opts.imageId, ext);
  await opts.blob.put(orientedKey, orientedBytes, {
    httpMetadata: { contentType: "image/jpeg" },
  });

  const thumbBytes = await buildThumbWebpBytesFromRgba(opts.orientedRgba);
  const thumbKey = orientedThumbObjectKey(opts.cubeId, opts.imageId);
  await opts.blob.put(thumbKey, thumbBytes, {
    httpMetadata: { contentType: "image/webp" },
  });

  const rel = `stored_images/${opts.imageId}${ext}`;
  return {
    orientedKey,
    thumbKey,
    storedImagePath: normalizeStoredImagePathRelativeToOutput(rel),
    ext,
  };
}
