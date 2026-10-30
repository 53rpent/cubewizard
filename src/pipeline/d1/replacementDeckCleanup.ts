import type { D1Statement } from "./types";

export interface ReplacementCleanupDb {
  prepare(sql: string): {
    bind(...args: unknown[]): unknown;
  };
  batch(stmts: unknown[]): Promise<unknown>;
}

export function buildReplacementDeckCleanupStatements(
  cubeId: string,
  deckId: number,
  now = new Date().toISOString(),
): D1Statement[] {
  return [
    {
      sql: "DELETE FROM deck_cards WHERE deck_id = ?",
      params: [deckId],
    },
    {
      sql: "DELETE FROM deck_stats WHERE deck_id = ?",
      params: [deckId],
    },
    {
      sql: "DELETE FROM decks WHERE deck_id = ? AND cube_id = ?",
      params: [deckId, cubeId],
    },
    {
      sql:
        "UPDATE cubes SET total_decks = (SELECT COUNT(*) FROM decks WHERE cube_id = ?), " +
        "last_updated = ? WHERE cube_id = ?;",
      params: [cubeId, now, cubeId],
    },
  ];
}

export async function deleteReplacementDeckRows(
  db: ReplacementCleanupDb,
  cubeId: string,
  deckId: number,
): Promise<void> {
  const statements = buildReplacementDeckCleanupStatements(cubeId, deckId);
  await db.batch(statements.map((stmt) => db.prepare(stmt.sql).bind(...(stmt.params ?? []))));
}
