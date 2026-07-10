import { buildDeckWritePlan, deckInsertWasDuplicate } from "./deckWriteBatches";
import type { D1Statement, DeckPayload } from "./types";

export interface D1DatabaseLike {
  prepare(sql: string): {
    bind(...args: unknown[]): unknown;
  };
  batch(stmts: unknown[]): Promise<Array<{ meta?: { changes?: number } } | undefined>>;
}

interface ExistingDeckWriteRow {
  deck_id?: number;
  image_id?: string;
  stats_deck_id?: number | null;
  card_count?: number;
}

function bindStatement(db: D1DatabaseLike, s: D1Statement): unknown {
  const p = db.prepare(s.sql);
  const params = s.params ?? [];
  return (p as { bind(...a: unknown[]): unknown }).bind(...params);
}

function existingDeckWriteIsComplete(row: ExistingDeckWriteRow, expectedPersistedCards: number): boolean {
  const hasStats = row.stats_deck_id != null;
  const cardCount = typeof row.card_count === "number" && Number.isFinite(row.card_count) ? row.card_count : 0;
  return hasStats && cardCount >= expectedPersistedCards;
}

/**
 * Run insert deck, deck_cards, and deck_stats in one plan.
 */
export async function executeDeckWritePlan(
  db: D1DatabaseLike,
  cubeId: string,
  deck: DeckPayload,
): Promise<{ success: boolean; duplicate: boolean; deckId?: number; imageId: string }> {
  const plan = await buildDeckWritePlan(cubeId, deck);
  const processingTs = deck.deck.metadata.processing_timestamp;
  const expectedPersistedCards = deck.deck.cards.cards?.length ?? 0;
  const existingBound = db.prepare(
    "SELECT d.deck_id, d.image_id, ds.deck_id AS stats_deck_id, " +
      "(SELECT COUNT(*) FROM deck_cards dc WHERE dc.deck_id = d.deck_id) AS card_count " +
      "FROM decks d " +
      "LEFT JOIN deck_stats ds ON ds.deck_id = d.deck_id " +
      "WHERE d.cube_id = ? AND d.processing_timestamp = ? LIMIT 1",
  ) as {
    bind(...args: unknown[]): { first<T = unknown>(): Promise<T | null> };
  };
  const existing = await existingBound.bind(cubeId, processingTs).first<ExistingDeckWriteRow>();
  if (existing?.deck_id != null) {
    if (!existingDeckWriteIsComplete(existing, expectedPersistedCards)) {
      const deckId = existing.deck_id;
      await db.batch(
        [
          { sql: "DELETE FROM deck_cards WHERE deck_id = ?;", params: [deckId] },
          { sql: "DELETE FROM deck_stats WHERE deck_id = ?;", params: [deckId] },
          ...plan.buildBatchB(deckId),
        ].map((s) => bindStatement(db, s)),
      );
      return {
        success: true,
        duplicate: false,
        deckId,
        imageId: typeof existing.image_id === "string" ? existing.image_id : plan.imageId,
      };
    }
    return {
      success: true,
      duplicate: true,
      deckId: existing.deck_id,
      imageId: typeof existing.image_id === "string" ? existing.image_id : plan.imageId,
    };
  }

  const batchAResults = await db.batch(plan.batchA.map((s) => bindStatement(db, s)));
  if (deckInsertWasDuplicate(batchAResults)) {
    return { success: true, duplicate: true, imageId: plan.imageId };
  }

  const lookupBound = bindStatement(db, plan.lookup) as {
    first: <T = unknown>() => Promise<T | null>;
  };
  const first = await lookupBound.first<{ deck_id?: number }>();
  const deckId = first && typeof first.deck_id === "number" ? first.deck_id : undefined;
  if (deckId == null) {
    return { success: false, duplicate: false, imageId: plan.imageId };
  }

  await db.batch(plan.buildBatchB(deckId).map((s) => bindStatement(db, s)));
  return { success: true, duplicate: false, deckId, imageId: plan.imageId };
}
