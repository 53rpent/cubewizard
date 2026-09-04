import { describe, expect, it } from "vitest";
import { deleteReplacedDeckRows } from "./evalTaskShared";

describe("deleteReplacedDeckRows", () => {
  it("deletes replacement target rows only inside the expected cube", async () => {
    const statements: Array<{ sql: string; args: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            statements.push({ sql, args });
            return {
              run: async () => ({ meta: { changes: 1 } }),
              first: async () => null,
            };
          },
        };
      },
      batch: async (stmts: unknown[]) => stmts.map(() => ({ meta: { changes: 1 } })),
    };

    await deleteReplacedDeckRows(db, 123, "cube");

    expect(statements).toHaveLength(4);
    expect(statements[0]?.sql).toContain("DELETE FROM deck_cards");
    expect(statements[0]?.sql).toContain("AND cube_id = ?");
    expect(statements[0]?.args).toEqual([123, 123, "cube"]);
    expect(statements[1]?.sql).toContain("DELETE FROM deck_stats");
    expect(statements[1]?.sql).toContain("AND cube_id = ?");
    expect(statements[1]?.args).toEqual([123, 123, "cube"]);
    expect(statements[2]?.sql).toContain("DELETE FROM decks");
    expect(statements[2]?.args).toEqual([123, "cube"]);
  });
});
