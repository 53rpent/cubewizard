import { describe, expect, it } from "vitest";
import { deleteReplacedDeckRows } from "./evalTaskShared";

function createDbMock() {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  return {
    calls,
    db: {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              sql,
              args,
              async run() {
                return {};
              },
              async first() {
                return null;
              },
            };
          },
        };
      },
      async batch(stmts: unknown[]) {
        calls.push(...(stmts as Array<{ sql: string; args: unknown[] }>));
        return stmts.map(() => ({ meta: { changes: 1 } }));
      },
    },
  };
}

describe("deleteReplacedDeckRows", () => {
  it("deletes only the replaced deck in the same cube and preserves the new deck", async () => {
    const { db, calls } = createDbMock();

    await deleteReplacedDeckRows(db, 123, "cube", 456);

    expect(calls).toHaveLength(4);
    expect(calls[0]?.sql).toContain("DELETE FROM deck_cards");
    expect(calls[0]?.sql).toContain("deck_id = ? AND cube_id = ? AND deck_id <> ?");
    expect(calls[0]?.args).toEqual([123, "cube", 456]);
    expect(calls[1]?.sql).toContain("DELETE FROM deck_stats");
    expect(calls[1]?.args).toEqual([123, "cube", 456]);
    expect(calls[2]?.sql).toContain("DELETE FROM decks WHERE deck_id = ? AND cube_id = ? AND deck_id <> ?");
    expect(calls[2]?.args).toEqual([123, "cube", 456]);
    expect(calls[3]?.sql).toContain("UPDATE cubes SET total_decks");
    expect(calls[3]?.args[0]).toBe("cube");
    expect(calls[3]?.args[2]).toBe("cube");
  });

  it("does not delete when the replacement points at the newly written deck", async () => {
    const { db, calls } = createDbMock();

    await deleteReplacedDeckRows(db, 123, "cube", 123);

    expect(calls).toHaveLength(0);
  });
});
