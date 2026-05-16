import type { D1DatabaseLike } from "./processingJobRepo";
import { evalErrorFields } from "../util/formatEvalError";

const HEDRON_UPLOAD_PREFIX = "hedron:";

/** Hedron queue / eval tasks use `upload_id` = `hedron:` + `deck_image_uuid`. */
export function deckImageUuidFromHedronUploadId(uploadId: string): string | null {
  const id = uploadId.trim();
  if (!id.startsWith(HEDRON_UPLOAD_PREFIX)) return null;
  const uuid = id.slice(HEDRON_UPLOAD_PREFIX.length).trim();
  return uuid || null;
}

export function deckImageUuidFromEvalTaskBody(body: unknown): string | null {
  const raw = body as Record<string, unknown> | null;
  const uploadId = raw?.upload_id;
  if (typeof uploadId !== "string") return null;
  return deckImageUuidFromHedronUploadId(uploadId);
}

/**
 * Remove a deck from `hedron_synced_decks` so the next Hedron sync can enqueue it again.
 * No-op when the row is absent (e.g. manual site uploads).
 */
export async function releaseHedronSyncedDeck(
  db: D1DatabaseLike,
  deckImageUuid: string
): Promise<number> {
  const uuid = deckImageUuid.trim();
  if (!uuid) return 0;
  const result = (await db
    .prepare("DELETE FROM hedron_synced_decks WHERE deck_image_uuid = ?")
    .bind(uuid)
    .run()) as { meta?: { changes?: number } };
  return result?.meta?.changes ?? 0;
}

export async function safeReleaseHedronSyncedDeckForUpload(
  db: D1DatabaseLike,
  uploadId: string
): Promise<void> {
  const deckUuid = deckImageUuidFromHedronUploadId(uploadId);
  if (!deckUuid) return;
  try {
    const changes = await releaseHedronSyncedDeck(db, deckUuid);
    if (changes > 0) {
      console.log("hedron_synced_deck_released", {
        deck_image_uuid: deckUuid,
        upload_id: uploadId,
      });
    }
  } catch (e) {
    console.error("hedron_synced_deck_release_error", {
      deck_image_uuid: deckUuid,
      upload_id: uploadId,
      ...evalErrorFields(e),
    });
  }
}
