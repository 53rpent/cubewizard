import { describe, expect, it } from "vitest";
import {
  deleteReplacedDeckRows,
  deleteReplacedDeckRowsIfReplacementComplete,
  replacementDeckWriteIsComplete,
} from "./deleteReplacedDeck";

function createDbMock({ hasStats = true, cardCount = 40 } = {}) {
  const calls: Array<{ type: string; sql: string; args: unknown[] }> = [];
  return {
    calls,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            sql,
            args,
            async first<T>() {
              calls.push({ type: "first", sql, args });
              if (sql.includes("FROM deck_stats")) {
                return (hasStats ? { deck_id: args[0] } : null) as T | null;
              }
              if (sql.includes("COUNT(*) AS count FROM deck_cards")) {
                return { count: cardCount } as T;
              }
              return null;
            },
          };
        },
      };
    },
    async batch(stmts: Array<{ sql: string; args: unknown[] }>) {
      for (const stmt of stmts) calls.push({ type: "batch", sql: stmt.sql, args: stmt.args });
      return stmts.map(() => ({ meta: { changes: 1 } }));
    },
  };
}

describe("replacement deck cleanup", () => {
  it("deletes old deck rows and refreshes cube totals", async () => {
    const db = createDbMock();
    await deleteReplacedDeckRows(db, "cube", 123, 456);

    expect(db.calls.some((call) => call.sql.includes("DELETE FROM deck_cards") && call.args[0] === 123)).toBe(true);
    expect(db.calls.some((call) => call.sql.includes("DELETE FROM deck_stats") && call.args[0] === 123)).toBe(true);
    expect(
      db.calls.some(
        (call) => call.sql.includes("DELETE FROM decks") && call.args[0] === 123 && call.args[1] === "cube",
      ),
    ).toBe(true);
    expect(db.calls.some((call) => call.sql.includes("UPDATE cubes SET total_decks"))).toBe(true);
  });

  it("skips cleanup if the replacement points at the same deck", async () => {
    const db = createDbMock();
    await deleteReplacedDeckRows(db, "cube", 123, 123);
    expect(db.calls).toHaveLength(0);
  });

  it("requires deck_stats and expected card rows before retry cleanup", async () => {
    await expect(replacementDeckWriteIsComplete(createDbMock({ hasStats: false }), 456, 40)).resolves.toBe(false);
    await expect(replacementDeckWriteIsComplete(createDbMock({ cardCount: 39 }), 456, 40)).resolves.toBe(false);
    await expect(replacementDeckWriteIsComplete(createDbMock({ cardCount: 40 }), 456, 40)).resolves.toBe(true);
  });

  it("does not delete the old deck when the replacement is incomplete", async () => {
    const db = createDbMock({ cardCount: 39 });
    await expect(deleteReplacedDeckRowsIfReplacementComplete(db, "cube", 123, 456, 40)).resolves.toBe(false);
    expect(db.calls.some((call) => call.type === "batch")).toBe(false);
  });
});
