import { buildDeckWritePlan, deckInsertWasDuplicate } from "./deckWriteBatches";
import type { D1Statement, DeckPayload } from "./types";

export interface D1DatabaseLike {
  prepare(sql: string): {
    bind(...args: unknown[]): unknown;
  };
  batch(stmts: unknown[]): Promise<Array<{ meta?: { changes?: number } } | undefined>>;
}

function bindStatement(db: D1DatabaseLike, s: D1Statement): unknown {
  const p = db.prepare(s.sql);
  const params = s.params ?? [];
  return (p as { bind(...a: unknown[]): unknown }).bind(...params);
}

async function repairExistingDeckRows(
  db: D1DatabaseLike,
  plan: Awaited<ReturnType<typeof buildDeckWritePlan>>,
  deckId: number,
) {
  await db.batch([
    bindStatement(db, { sql: "DELETE FROM deck_cards WHERE deck_id = ?;", params: [deckId] }),
    bindStatement(db, { sql: "DELETE FROM deck_stats WHERE deck_id = ?;", params: [deckId] }),
    ...plan.buildBatchB(deckId).map((s) => bindStatement(db, s)),
  ]);
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
  const existingBound = db.prepare(
    "SELECT d.deck_id, d.image_id, CASE WHEN ds.deck_id IS NULL THEN 0 ELSE 1 END AS has_stats, " +
      "(SELECT COUNT(*) FROM deck_cards dc WHERE dc.deck_id = d.deck_id) AS card_count " +
      "FROM decks d LEFT JOIN deck_stats ds ON ds.deck_id = d.deck_id " +
      "WHERE d.cube_id = ? AND d.processing_timestamp = ? ORDER BY d.deck_id DESC LIMIT 1",
  ) as {
    bind(...args: unknown[]): { first<T = unknown>(): Promise<T | null> };
  };
  const existing = await existingBound
    .bind(cubeId, processingTs)
    .first<{ deck_id?: number; image_id?: string; has_stats?: number; card_count?: number }>();
  if (existing?.deck_id != null) {
    const deckId = Number(existing.deck_id);
    const expectedCardCount = deck.deck.cards.cards?.length ?? 0;
    const cardCount = Number(existing.card_count ?? 0);
    const hasStats = Number(existing.has_stats ?? 0) === 1;
    if (!hasStats || cardCount < expectedCardCount) {
      await repairExistingDeckRows(db, plan, deckId);
    }
    return {
      success: true,
      duplicate: false,
      deckId,
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
