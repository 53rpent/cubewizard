/**
 * R2 object key helpers for oriented deck images and thumbnails.
 */

export const THUMB_MAX_SIDE = 256;
export const THUMB_WEBP_QUALITY = 82;

export function orientedObjectKey(cubeId: string, imageId: string, ext: string): string {
  let e = ext.startsWith(".") ? ext : `.${ext}`;
  e = e.toLowerCase();
  return `${cubeId}/${imageId}${e}`;
}

export function orientedThumbObjectKey(cubeId: string, imageId: string): string {
  return `${cubeId}/${imageId}_thumb.webp`;
}

export function contentTypeForExt(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, "");
  return (
    {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      heic: "image/heic",
      heif: "image/heif",
    } as Record<string, string>
  )[e] ?? "application/octet-stream";
}
