import { evalErrorFields } from "../util/formatEvalError";
import type { D1DatabaseLike } from "./processingJobRepo";

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
export async function releaseHedronSyncedDeck(db: D1DatabaseLike, deckImageUuid: string): Promise<number> {
  const uuid = deckImageUuid.trim();
  if (!uuid) return 0;
  const result = (await db.prepare("DELETE FROM hedron_synced_decks WHERE deck_image_uuid = ?").bind(uuid).run()) as {
    meta?: { changes?: number };
  };
  return result?.meta?.changes ?? 0;
}

/** Default R2 prefix for a Hedron deck image UUID (matches site worker `hedronR2Prefix`). */
export function hedronSyncedDeckR2Prefix(deckImageUuid: string): string {
  return "hedron/" + String(deckImageUuid || "").replace(/[^a-zA-Z0-9_\-:.]/g, "_");
}

/**
 * Keep a Hedron deck in `hedron_synced_decks` after claim (or repair a missing row).
 * No-op for non-Hedron `upload_id` values.
 */
export async function ensureHedronSyncedDeck(
  db: D1DatabaseLike,
  cubeId: string,
  uploadId: string,
  opts?: { draftId?: string; playerId?: string; r2Prefix?: string },
): Promise<void> {
  const uuid = deckImageUuidFromHedronUploadId(uploadId);
  if (!uuid) return;
  const cube = String(cubeId || "").trim();
  if (!cube) return;
  const r2Prefix = opts?.r2Prefix?.trim() || hedronSyncedDeckR2Prefix(uuid);
  await db
    .prepare(
      "INSERT OR IGNORE INTO hedron_synced_decks " +
        "(deck_image_uuid, cube_id, draft_id, player_id, r2_prefix, synced_at) " +
        "VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(uuid, cube, opts?.draftId ?? "", opts?.playerId ?? "", r2Prefix, new Date().toISOString())
    .run();
}

export async function safeReleaseHedronSyncedDeckForUpload(db: D1DatabaseLike, uploadId: string): Promise<void> {
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
