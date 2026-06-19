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

interface ExistingDeckState {
  deckId: number;
  imageId: string;
  cardCount: number;
  statCount: number;
}

function normalizeExistingDeckState(row: unknown): ExistingDeckState | null {
  if (!row || typeof row !== "object") return null;
  const r = row as {
    deck_id?: unknown;
    image_id?: unknown;
    card_count?: unknown;
    stat_count?: unknown;
  };
  const deckId = typeof r.deck_id === "number" ? r.deck_id : undefined;
  if (deckId == null) return null;
  return {
    deckId,
    imageId: typeof r.image_id === "string" ? r.image_id : "",
    cardCount: typeof r.card_count === "number" ? r.card_count : 0,
    statCount: typeof r.stat_count === "number" ? r.stat_count : 0,
  };
}

function existingDeckSelect(whereClause: string): string {
  return (
    "SELECT d.deck_id, d.image_id, " +
    "(SELECT COUNT(*) FROM deck_cards dc WHERE dc.deck_id = d.deck_id) AS card_count, " +
    "(SELECT COUNT(*) FROM deck_stats ds WHERE ds.deck_id = d.deck_id) AS stat_count " +
    "FROM decks d " +
    whereClause +
    " LIMIT 1"
  );
}

async function findExistingByProcessingTimestamp(
  db: D1DatabaseLike,
  cubeId: string,
  processingTs: string,
): Promise<ExistingDeckState | null> {
  const existingBound = db.prepare(existingDeckSelect("WHERE d.cube_id = ? AND d.processing_timestamp = ?")) as {
    bind(...args: unknown[]): { first<T = unknown>(): Promise<T | null> };
  };
  const existing = await existingBound.bind(cubeId, processingTs).first();
  return normalizeExistingDeckState(existing);
}

async function findExistingByImageId(db: D1DatabaseLike, imageId: string): Promise<ExistingDeckState | null> {
  const existingBound = db.prepare(existingDeckSelect("WHERE d.image_id = ?")) as {
    bind(...args: unknown[]): { first<T = unknown>(): Promise<T | null> };
  };
  const existing = await existingBound.bind(imageId).first();
  return normalizeExistingDeckState(existing);
}

function existingDeckIsComplete(existing: ExistingDeckState, expectedCardRows: number): boolean {
  return existing.statCount === 1 && existing.cardCount === expectedCardRows;
}

async function rebuildDeckChildren(db: D1DatabaseLike, plan: DeckWritePlan, deckId: number): Promise<void> {
  const repairStatements: D1Statement[] = [
    { sql: "DELETE FROM deck_stats WHERE deck_id = ?;", params: [deckId] },
    { sql: "DELETE FROM deck_cards WHERE deck_id = ?;", params: [deckId] },
    ...plan.buildBatchB(deckId),
  ];
  await db.batch(repairStatements.map((s) => bindStatement(db, s)));
}

async function completeOrReturnDuplicate(
  db: D1DatabaseLike,
  plan: DeckWritePlan,
  existing: ExistingDeckState,
  expectedCardRows: number,
): Promise<{ success: boolean; duplicate: boolean; deckId?: number; imageId: string }> {
  if (existingDeckIsComplete(existing, expectedCardRows)) {
    return {
      success: true,
      duplicate: true,
      deckId: existing.deckId,
      imageId: existing.imageId || plan.imageId,
    };
  }

  await rebuildDeckChildren(db, plan, existing.deckId);
  return {
    success: true,
    duplicate: false,
    deckId: existing.deckId,
    imageId: existing.imageId || plan.imageId,
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
  const existing = await findExistingByProcessingTimestamp(db, cubeId, processingTs);
  if (existing) {
    return completeOrReturnDuplicate(db, plan, existing, expectedCardRows);
  }

  const batchAResults = await db.batch(plan.batchA.map((s) => bindStatement(db, s)));
  if (deckInsertWasDuplicate(batchAResults)) {
    const duplicate = await findExistingByProcessingTimestamp(db, cubeId, processingTs);
    if (duplicate) {
      return completeOrReturnDuplicate(db, plan, duplicate, expectedCardRows);
    }
    const duplicateImage = await findExistingByImageId(db, plan.imageId);
    if (duplicateImage) {
      return completeOrReturnDuplicate(db, plan, duplicateImage, expectedCardRows);
    }
    return { success: false, duplicate: false, imageId: plan.imageId };
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
