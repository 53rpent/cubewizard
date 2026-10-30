import { describe, expect, it, vi } from "vitest";
import { buildReplacementDeckCleanupStatements, deleteReplacementDeckRows } from "./replacementDeckCleanup";

describe("replacement deck cleanup", () => {
  it("builds scoped cleanup statements for the replaced deck", () => {
    const statements = buildReplacementDeckCleanupStatements("cube-1", 123, "2026-01-01T00:00:00.000Z");

    expect(statements.map((stmt) => stmt.sql)).toEqual([
      "DELETE FROM deck_cards WHERE deck_id = ?",
      "DELETE FROM deck_stats WHERE deck_id = ?",
      "DELETE FROM decks WHERE deck_id = ? AND cube_id = ?",
      "UPDATE cubes SET total_decks = (SELECT COUNT(*) FROM decks WHERE cube_id = ?), last_updated = ? WHERE cube_id = ?;",
    ]);
    expect(statements.map((stmt) => stmt.params)).toEqual([
      [123],
      [123],
      [123, "cube-1"],
      ["cube-1", "2026-01-01T00:00:00.000Z", "cube-1"],
    ]);
  });

  it("executes cleanup in one D1 batch", async () => {
    const bound: unknown[] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            const stmt = { sql, args };
            bound.push(stmt);
            return stmt;
          },
        };
      },
      batch: vi.fn(async () => []),
    };

    await deleteReplacementDeckRows(db, "cube-1", 123);

    expect(bound).toHaveLength(4);
    expect(db.batch).toHaveBeenCalledWith(bound);
  });
});
