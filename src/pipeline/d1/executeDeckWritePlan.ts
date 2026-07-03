import { buildDeckWritePlan, deckInsertWasDuplicate } from "./deckWriteBatches";
import type { D1Statement, DeckPayload } from "./types";

export interface D1DatabaseLike {
  prepare(sql: string): {
    bind(...args: unknown[]): unknown;
  };
  batch(stmts: unknown[]): Promise<Array<{ meta?: { changes?: number } } | undefined>>;
}

type ExistingDeckRow = {
  deck_id?: number;
  image_id?: string;
  total_found?: number | null;
  card_count?: number | null;
};

function bindStatement(db: D1DatabaseLike, s: D1Statement): unknown {
  const p = db.prepare(s.sql);
  const params = s.params ?? [];
  return (p as { bind(...a: unknown[]): unknown }).bind(...params);
}

async function lookupExistingDeck(
  db: D1DatabaseLike,
  cubeId: string,
  processingTs: string,
): Promise<ExistingDeckRow | null> {
  const existingBound = db.prepare(
    "SELECT d.deck_id, d.image_id, ds.total_found, " +
      "(SELECT COUNT(*) FROM deck_cards dc WHERE dc.deck_id = d.deck_id) AS card_count " +
      "FROM decks d LEFT JOIN deck_stats ds ON ds.deck_id = d.deck_id " +
      "WHERE d.cube_id = ? AND d.processing_timestamp = ? " +
      "ORDER BY d.deck_id DESC LIMIT 1",
  ) as {
    bind(...args: unknown[]): { first<T = unknown>(): Promise<T | null> };
  };
  return existingBound.bind(cubeId, processingTs).first<ExistingDeckRow>();
}

function completeDuplicateResult(
  existing: ExistingDeckRow | null,
  fallbackImageId: string,
): { success: boolean; duplicate: boolean; deckId?: number; imageId: string } {
  if (!existing || existing.deck_id == null) {
    return { success: false, duplicate: false, imageId: fallbackImageId };
  }
  const deckId = existing.deck_id;
  const totalFound = existing.total_found;
  const cardCount = existing.card_count;
  if (typeof totalFound !== "number" || typeof cardCount !== "number" || cardCount < totalFound) {
    return { success: false, duplicate: false, deckId, imageId: fallbackImageId };
  }
  return {
    success: true,
    duplicate: true,
    deckId,
    imageId: typeof existing.image_id === "string" ? existing.image_id : fallbackImageId,
  };
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
  const existing = await lookupExistingDeck(db, cubeId, processingTs);
  if (existing?.deck_id != null) {
    return completeDuplicateResult(existing, plan.imageId);
  }

  const batchAResults = await db.batch(plan.batchA.map((s) => bindStatement(db, s)));
  if (deckInsertWasDuplicate(batchAResults)) {
    return completeDuplicateResult(await lookupExistingDeck(db, cubeId, processingTs), plan.imageId);
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
