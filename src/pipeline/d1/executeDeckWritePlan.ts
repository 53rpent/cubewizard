import { buildDeckWritePlan, deckInsertWasDuplicate } from "./deckWriteBatches";
import type { D1Statement, DeckPayload, DeckWritePlan } from "./types";

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

type ExistingDeck = { deck_id?: number; image_id?: string };

async function findExistingDeckByProcessingTs(
  db: D1DatabaseLike,
  cubeId: string,
  processingTs: string,
): Promise<ExistingDeck | null> {
  const existingBound = db.prepare(
    "SELECT deck_id, image_id FROM decks WHERE cube_id = ? AND processing_timestamp = ? LIMIT 1",
  ) as {
    bind(...args: unknown[]): { first<T = unknown>(): Promise<T | null> };
  };
  return existingBound.bind(cubeId, processingTs).first<ExistingDeck>();
}

async function findExistingDeckByImageId(db: D1DatabaseLike, imageId: string): Promise<ExistingDeck | null> {
  const existingBound = db.prepare("SELECT deck_id, image_id FROM decks WHERE image_id = ? LIMIT 1") as {
    bind(...args: unknown[]): { first<T = unknown>(): Promise<T | null> };
  };
  return existingBound.bind(imageId).first<ExistingDeck>();
}

async function deckWriteIsComplete(db: D1DatabaseLike, deckId: number, expectedCardRows: number): Promise<boolean> {
  const statsBound = db.prepare(
    "SELECT " +
      "(SELECT COUNT(*) FROM deck_stats WHERE deck_id = ?) AS stats_count, " +
      "(SELECT COUNT(*) FROM deck_cards WHERE deck_id = ?) AS card_count",
  ) as {
    bind(...args: unknown[]): { first<T = unknown>(): Promise<T | null> };
  };
  const row = await statsBound.bind(deckId, deckId).first<{ stats_count?: number; card_count?: number }>();
  return Number(row?.stats_count ?? 0) > 0 && Number(row?.card_count ?? -1) === expectedCardRows;
}

async function finishExistingDeckWrite(
  db: D1DatabaseLike,
  plan: DeckWritePlan,
  existing: ExistingDeck,
  expectedCardRows: number,
): Promise<{ success: boolean; duplicate: boolean; deckId?: number; imageId: string }> {
  const deckId = typeof existing.deck_id === "number" ? existing.deck_id : undefined;
  if (deckId == null) {
    return { success: false, duplicate: false, imageId: plan.imageId };
  }

  if (!(await deckWriteIsComplete(db, deckId, expectedCardRows))) {
    const repair: D1Statement[] = [
      { sql: "DELETE FROM deck_stats WHERE deck_id = ?", params: [deckId] },
      { sql: "DELETE FROM deck_cards WHERE deck_id = ?", params: [deckId] },
      ...plan.buildBatchB(deckId),
    ];
    await db.batch(repair.map((s) => bindStatement(db, s)));
  }

  return {
    success: true,
    duplicate: false,
    deckId,
    imageId: typeof existing.image_id === "string" ? existing.image_id : plan.imageId,
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
  const expectedCardRows = deck.deck.cards.cards?.length ?? 0;
  const existing = await findExistingDeckByProcessingTs(db, cubeId, processingTs);
  if (existing?.deck_id != null) {
    return finishExistingDeckWrite(db, plan, existing, expectedCardRows);
  }

  const batchAResults = await db.batch(plan.batchA.map((s) => bindStatement(db, s)));
  if (deckInsertWasDuplicate(batchAResults)) {
    const duplicate = await findExistingDeckByImageId(db, plan.imageId);
    if (duplicate?.deck_id != null) {
      return finishExistingDeckWrite(db, plan, duplicate, expectedCardRows);
    }
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
