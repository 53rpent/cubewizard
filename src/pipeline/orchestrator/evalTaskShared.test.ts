import { describe, expect, it } from "vitest";
import { deleteReplacedDeckRows } from "./evalTaskShared";

describe("deleteReplacedDeckRows", () => {
  it("deletes only the replaced deck in the target cube and refreshes cube totals", async () => {
    const prepared: string[] = [];
    const bound: unknown[][] = [];
    const db = {
      prepare(sql: string) {
        prepared.push(sql);
        return {
          bind(...args: unknown[]) {
            bound.push(args);
            return {
              run: async () => ({}),
              first: async () => null,
            };
          },
        };
      },
      batch: async (stmts: unknown[]) => {
        expect(stmts).toHaveLength(4);
        return [];
      },
    };

    await deleteReplacedDeckRows(db, 42, "cube1");

    expect(prepared[0]).toContain("DELETE FROM deck_cards");
    expect(prepared[0]).toContain("cube_id = ?");
    expect(prepared[1]).toContain("DELETE FROM deck_stats");
    expect(prepared[1]).toContain("cube_id = ?");
    expect(prepared[2]).toContain("DELETE FROM decks WHERE deck_id = ? AND cube_id = ?");
    expect(prepared[3]).toContain("UPDATE cubes SET total_decks");
    expect(bound[0]).toEqual([42, "cube1"]);
    expect(bound[1]).toEqual([42, "cube1"]);
    expect(bound[2]).toEqual([42, "cube1"]);
    expect(bound[3]?.[0]).toBe("cube1");
    expect(bound[3]?.[2]).toBe("cube1");
  });
});
