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
    "SELECT deck_id, image_id FROM decks WHERE cube_id = ? AND processing_timestamp = ? LIMIT 1",
  ) as {
    bind(...args: unknown[]): { first<T = unknown>(): Promise<T | null> };
  };
  const existing = await existingBound.bind(cubeId, processingTs).first<{ deck_id?: number; image_id?: string }>();
  if (existing?.deck_id != null) {
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
