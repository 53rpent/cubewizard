export type ComputeImageIdOpts = {
  imageSource?: string;
};

/** Hedron imports use `processing_timestamp` = `hedron:{uuid}`; pilot labels are not stable after claim. */
export function isHedronDeckIdentity(processingTimestamp: string, imageSource?: string): boolean {
  const ts = String(processingTimestamp || "").trim();
  if (ts.startsWith("hedron:")) return true;
  return (
    String(imageSource || "")
      .trim()
      .toLowerCase() === "hedron"
  );
}

/**
 * Deterministic `image_id` (first 16 hex chars of SHA-256).
 *
 * Manual uploads: `cubeId|pilotName|processingTimestamp`.
 * Hedron uploads: `cubeId|processingTimestamp` only (pilot may change when claimed).
 *
 * `processingTimestamp` must be **stable for a given queue job** (e.g. `upload_id`) so retries
 * dedupe on `decks.image_id`; a wall-clock value creates a new row on every attempt.
 */
export async function computeImageId(
  cubeId: string,
  pilotName: string,
  processingTimestamp: string,
  opts?: ComputeImageIdOpts,
): Promise<string> {
  const ts = String(processingTimestamp || "").trim();
  const hedron = isHedronDeckIdentity(ts, opts?.imageSource);
  const idSource = hedron ? `${cubeId}|${ts}` : `${cubeId}|${pilotName}|${ts}`;
  const enc = new TextEncoder().encode(idSource);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 16);
}
