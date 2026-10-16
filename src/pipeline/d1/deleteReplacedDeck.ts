import type { D1DatabaseLike } from "./executeDeckWritePlan";

type D1Queryable = D1DatabaseLike & {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
    };
  };
};

export async function deleteReplacedDeckRows(
  db: D1DatabaseLike,
  cubeId: string,
  replaceDeckId: number | undefined,
  newDeckId: number,
): Promise<void> {
  if (replaceDeckId == null || !Number.isFinite(replaceDeckId) || replaceDeckId <= 0) return;
  if (replaceDeckId === newDeckId) return;

  const now = new Date().toISOString();
  await db.batch([
    db.prepare("DELETE FROM deck_cards WHERE deck_id = ?").bind(replaceDeckId),
    db.prepare("DELETE FROM deck_stats WHERE deck_id = ?").bind(replaceDeckId),
    db.prepare("DELETE FROM decks WHERE deck_id = ? AND cube_id = ?").bind(replaceDeckId, cubeId),
    db
      .prepare(
        "UPDATE cubes SET total_decks = (SELECT COUNT(*) FROM decks WHERE cube_id = ?), last_updated = ? WHERE cube_id = ?;",
      )
      .bind(cubeId, now, cubeId),
  ]);
}

export async function replacementDeckWriteIsComplete(
  db: D1Queryable,
  deckId: number,
  expectedCards: number,
): Promise<boolean> {
  const stats = await db
    .prepare("SELECT deck_id FROM deck_stats WHERE deck_id = ? LIMIT 1")
    .bind(deckId)
    .first<{ deck_id?: number }>();
  if (!stats?.deck_id) return false;

  const cards = await db
    .prepare("SELECT COUNT(*) AS count FROM deck_cards WHERE deck_id = ?")
    .bind(deckId)
    .first<{ count?: number }>();
  const count = Number(cards?.count ?? 0);
  return Number.isFinite(count) && count >= expectedCards;
}

export async function deleteReplacedDeckRowsIfReplacementComplete(
  db: D1Queryable,
  cubeId: string,
  replaceDeckId: number | undefined,
  newDeckId: number,
  expectedCards: number,
): Promise<boolean> {
  if (!(await replacementDeckWriteIsComplete(db, newDeckId, expectedCards))) return false;
  await deleteReplacedDeckRows(db, cubeId, replaceDeckId, newDeckId);
  return true;
}
