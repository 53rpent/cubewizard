import { encodeJpeg } from "../images/encode";
import { orientedObjectKey, orientedThumbObjectKey } from "../r2/orientedKeys";
import { buildThumbWebpBytesFromImageBytes } from "../r2/thumbWebp";
import { normalizeStoredImagePathRelativeToOutput } from "../d1/storedPath";

export interface R2PutBucket {
  put(
    key: string,
    value: Uint8Array,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<void>;
}

/**
 * Store oriented deck photo as **JPEG** + WebP thumb — matches common Python `.jpg` output.
 */
export async function uploadOrientedImageAndThumb(opts: {
  blob: R2PutBucket;
  cubeId: string;
  imageId: string;
  orientedRgba: import("../images/types").RgbaFrame;
  jpegQuality?: number;
}): Promise<{ orientedKey: string; thumbKey: string; storedImagePath: string; ext: string }> {
  const ext = ".jpg";
  const orientedBytes = encodeJpeg(opts.orientedRgba, opts.jpegQuality ?? 100);
  const orientedKey = orientedObjectKey(opts.cubeId, opts.imageId, ext);
  await opts.blob.put(orientedKey, orientedBytes, {
    httpMetadata: { contentType: "image/jpeg" },
  });

  // Downscale the same bytes served as the full photo (not a separate RGBA→WebP path).
  const thumbBytes = await buildThumbWebpBytesFromImageBytes(orientedBytes, "jpeg");
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
