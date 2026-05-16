/**
 * Deterministic `image_id` (first 16 hex chars of SHA-256 of cube id, pilot, and processing timestamp).
 *
 * `processingTimestamp` must be **stable for a given queue job** (e.g. `upload_id`) so retries
 * dedupe on `decks.image_id`; a wall-clock value creates a new row on every attempt.
 */
export async function computeImageId(
  cubeId: string,
  pilotName: string,
  processingTimestamp: string
): Promise<string> {
  const idSource = `${cubeId}|${pilotName}|${processingTimestamp}`;
  const enc = new TextEncoder().encode(idSource);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 16);
}
