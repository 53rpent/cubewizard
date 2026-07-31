import { buildDeckWritePlan, deckInsertWasDuplicate } from "./deckWriteBatches";
import type { D1Statement, DeckPayload } from "./types";

export interface D1DatabaseLike {
  prepare(sql: string): {
    bind(...args: unknown[]): unknown;
  };
  batch(stmts: unknown[]): Promise<Array<{ meta?: { changes?: number } } | undefined>>;
}

interface ExistingDeckWriteState {
  deckId: number;
  imageId: string;
  hasStats: boolean;
  cardCount: number;
}

interface DeckWriteResult {
  success: boolean;
  duplicate: boolean;
  deckId?: number;
  imageId: string;
}

function bindStatement(db: D1DatabaseLike, s: D1Statement): unknown {
  const p = db.prepare(s.sql);
  const params = s.params ?? [];
  return (p as { bind(...a: unknown[]): unknown }).bind(...params);
}

async function readExistingDeckWriteState(
  db: D1DatabaseLike,
  cubeId: string,
  processingTs: string,
  fallbackImageId: string,
): Promise<ExistingDeckWriteState | null> {
  const bound = db.prepare(
    "SELECT d.deck_id, d.image_id, ds.deck_id AS stats_deck_id, " +
      "(SELECT COUNT(*) FROM deck_cards dc WHERE dc.deck_id = d.deck_id) AS card_count " +
      "FROM decks d " +
      "LEFT JOIN deck_stats ds ON ds.deck_id = d.deck_id " +
      "WHERE d.cube_id = ? AND d.processing_timestamp = ? " +
      "LIMIT 1",
  ) as {
    bind(...args: unknown[]): { first<T = unknown>(): Promise<T | null> };
  };
  const existing = await bound.bind(cubeId, processingTs).first<{
    deck_id?: number;
    image_id?: string;
    stats_deck_id?: number | null;
    card_count?: number;
  }>();
  if (existing?.deck_id == null) return null;
  return {
    deckId: existing.deck_id,
    imageId: typeof existing.image_id === "string" ? existing.image_id : fallbackImageId,
    hasStats: existing.stats_deck_id != null,
    cardCount: Number(existing.card_count ?? 0),
  };
}

function existingDeckIsComplete(existing: ExistingDeckWriteState, deck: DeckPayload): boolean {
  const expectedCards = deck.deck.cards.cards?.length ?? 0;
  return existing.hasStats && existing.cardCount >= expectedCards;
}

async function repairExistingDeckWrite(
  db: D1DatabaseLike,
  plan: Awaited<ReturnType<typeof buildDeckWritePlan>>,
  deckId: number,
): Promise<void> {
  const reset: D1Statement[] = [
    { sql: "DELETE FROM deck_cards WHERE deck_id = ?", params: [deckId] },
    { sql: "DELETE FROM deck_stats WHERE deck_id = ?", params: [deckId] },
  ];
  await db.batch([...reset, ...plan.buildBatchB(deckId)].map((s) => bindStatement(db, s)));
}

/**
 * Run insert deck, deck_cards, and deck_stats in one plan.
 */
export async function executeDeckWritePlan(
  db: D1DatabaseLike,
  cubeId: string,
  deck: DeckPayload,
): Promise<DeckWriteResult> {
  const plan = await buildDeckWritePlan(cubeId, deck);
  const processingTs = deck.deck.metadata.processing_timestamp;
  const existing = await readExistingDeckWriteState(db, cubeId, processingTs, plan.imageId);
  if (existing) {
    if (existingDeckIsComplete(existing, deck)) {
      return {
        success: true,
        duplicate: true,
        deckId: existing.deckId,
        imageId: existing.imageId,
      };
    }
    await repairExistingDeckWrite(db, plan, existing.deckId);
    return { success: true, duplicate: false, deckId: existing.deckId, imageId: existing.imageId };
  }

  const batchAResults = await db.batch(plan.batchA.map((s) => bindStatement(db, s)));
  if (deckInsertWasDuplicate(batchAResults)) {
    const duplicate = await readExistingDeckWriteState(db, cubeId, processingTs, plan.imageId);
    if (duplicate && !existingDeckIsComplete(duplicate, deck)) {
      await repairExistingDeckWrite(db, plan, duplicate.deckId);
      return { success: true, duplicate: false, deckId: duplicate.deckId, imageId: duplicate.imageId };
    }
    if (duplicate) {
      return { success: true, duplicate: true, deckId: duplicate.deckId, imageId: duplicate.imageId };
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
