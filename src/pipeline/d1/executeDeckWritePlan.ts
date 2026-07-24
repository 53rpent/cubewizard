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

interface ExistingDeckWriteState {
  deckId: number;
  imageId?: string;
  hasStats: boolean;
  statsTotalFound: number;
  cardCount: number;
}

type DeckWriteResult = { success: boolean; duplicate: boolean; deckId?: number; imageId: string };

async function readExistingDeckWriteState(
  db: D1DatabaseLike,
  cubeId: string,
  processingTs: string,
): Promise<ExistingDeckWriteState | null> {
  const bound = db.prepare(
    "SELECT d.deck_id, d.image_id, ds.deck_id AS stats_deck_id, ds.total_found AS stats_total_found, " +
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
    image_id?: string | null;
    stats_deck_id?: number | null;
    stats_total_found?: number | string | null;
    card_count?: number | string;
  }>();
  const deckId = Number(existing?.deck_id);
  if (!Number.isFinite(deckId)) return null;
  return {
    deckId,
    imageId: typeof existing?.image_id === "string" ? existing.image_id : undefined,
    hasStats: existing?.stats_deck_id != null,
    statsTotalFound: Number(existing?.stats_total_found ?? 0),
    cardCount: Number(existing?.card_count ?? 0),
  };
}

function deckWriteIsComplete(existing: ExistingDeckWriteState): boolean {
  return existing.hasStats && existing.cardCount === existing.statsTotalFound;
}

async function rebuildDeckChildren(db: D1DatabaseLike, plan: DeckWritePlan, deckId: number): Promise<void> {
  await db.batch([
    bindStatement(db, { sql: "DELETE FROM deck_cards WHERE deck_id = ?", params: [deckId] }),
    bindStatement(db, { sql: "DELETE FROM deck_stats WHERE deck_id = ?", params: [deckId] }),
  ]);
  await db.batch(plan.buildBatchB(deckId).map((s) => bindStatement(db, s)));
}

async function resolveExistingDeckWrite(
  db: D1DatabaseLike,
  plan: DeckWritePlan,
  existing: ExistingDeckWriteState,
): Promise<DeckWriteResult> {
  if (!deckWriteIsComplete(existing)) {
    await rebuildDeckChildren(db, plan, existing.deckId);
    return { success: true, duplicate: false, deckId: existing.deckId, imageId: existing.imageId ?? plan.imageId };
  }
  return {
    success: true,
    duplicate: true,
    deckId: existing.deckId,
    imageId: existing.imageId ?? plan.imageId,
  };
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
  const existing = await readExistingDeckWriteState(db, cubeId, processingTs);
  if (existing != null) {
    return resolveExistingDeckWrite(db, plan, existing);
  }

  const batchAResults = await db.batch(plan.batchA.map((s) => bindStatement(db, s)));
  if (deckInsertWasDuplicate(batchAResults)) {
    const duplicate = await readExistingDeckWriteState(db, cubeId, processingTs);
    if (duplicate != null) {
      return resolveExistingDeckWrite(db, plan, duplicate);
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
