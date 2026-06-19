import { describe, expect, it } from "vitest";
import { executeDeckWritePlan, type D1DatabaseLike } from "./executeDeckWritePlan";
import type { DeckPayload } from "./types";

interface BoundStatement {
  sql: string;
  params: unknown[];
  first<T = unknown>(): Promise<T | null>;
}

interface ExistingDeckRow {
  deck_id: number;
  image_id: string;
  card_count: number;
  stat_count: number;
}

const minimalDeck = (): DeckPayload => ({
  deck: {
    metadata: {
      pilot_name: "P",
      match_wins: 2,
      match_losses: 1,
      match_draws: 0,
      record_logged: "2026-01-01T00:00:00",
      win_rate: 0.667,
      image_source: "",
      processing_timestamp: "ts1",
      total_cards: 1,
    },
    cards: {
      cards: [
        {
          name: "Mountain",
          mana_cost: "",
          cmc: 0,
          type_line: "Basic Land - Mountain",
          colors: [],
          color_identity: ["R"],
          rarity: "common",
          set: "lea",
          set_name: "Limited Edition Alpha",
          collector_number: "164",
          power: null,
          toughness: null,
          oracle_text: "R",
          scryfall_uri: "https://scryfall.com/...",
          image_uris: {},
          prices: {},
        },
      ],
      total_requested: 1,
      total_found: 1,
      not_found: [],
      success_rate: 1,
    },
  },
});

class MockD1 implements D1DatabaseLike {
  readonly batches: BoundStatement[][] = [];
  batchResults: Array<Array<{ meta?: { changes?: number } } | undefined>> = [];
  existingByTimestamp: ExistingDeckRow | null = null;
  existingByImageId: ExistingDeckRow | null = null;
  lookupDeckId = 42;

  prepare(sql: string): { bind(...args: unknown[]): BoundStatement } {
    return {
      bind: (...args: unknown[]) => ({
        sql,
        params: args,
        first: async <T = unknown>(): Promise<T | null> => {
          if (sql.includes("WHERE d.cube_id = ? AND d.processing_timestamp = ?")) {
            return this.existingByTimestamp as T | null;
          }
          if (sql.includes("WHERE d.image_id = ?")) {
            return this.existingByImageId as T | null;
          }
          if (sql.includes("SELECT deck_id FROM decks")) {
            return { deck_id: this.lookupDeckId } as T;
          }
          return null;
        },
      }),
    };
  }

  async batch(stmts: unknown[]): Promise<Array<{ meta?: { changes?: number } } | undefined>> {
    this.batches.push(stmts as BoundStatement[]);
    return this.batchResults.shift() ?? stmts.map(() => ({ meta: { changes: 1 } }));
  }
}

describe("executeDeckWritePlan", () => {
  it("treats an existing deck with complete child rows as a duplicate", async () => {
    const db = new MockD1();
    db.existingByTimestamp = {
      deck_id: 42,
      image_id: "img-existing",
      card_count: 1,
      stat_count: 1,
    };

    const result = await executeDeckWritePlan(db, "c1", minimalDeck());

    expect(result).toEqual({
      success: true,
      duplicate: true,
      deckId: 42,
      imageId: "img-existing",
    });
    expect(db.batches).toHaveLength(0);
  });

  it("repairs an existing deck row whose card/stat rows were not written before retry", async () => {
    const db = new MockD1();
    db.existingByTimestamp = {
      deck_id: 42,
      image_id: "img-existing",
      card_count: 0,
      stat_count: 0,
    };

    const result = await executeDeckWritePlan(db, "c1", minimalDeck());

    expect(result).toEqual({
      success: true,
      duplicate: false,
      deckId: 42,
      imageId: "img-existing",
    });
    expect(db.batches).toHaveLength(1);
    expect(db.batches[0]?.map((stmt) => stmt.sql)).toEqual([
      "DELETE FROM deck_stats WHERE deck_id = ?;",
      "DELETE FROM deck_cards WHERE deck_id = ?;",
      expect.stringContaining("INSERT INTO deck_stats"),
      expect.stringContaining("INSERT INTO deck_cards"),
      expect.stringContaining("UPDATE cubes SET"),
    ]);
  });

  it("repairs an incomplete duplicate found by image id after an ignored insert", async () => {
    const db = new MockD1();
    db.batchResults.push([{}, { meta: { changes: 0 } }]);
    db.existingByImageId = {
      deck_id: 42,
      image_id: "img-existing",
      card_count: 0,
      stat_count: 0,
    };

    const result = await executeDeckWritePlan(db, "c1", minimalDeck());

    expect(result).toEqual({
      success: true,
      duplicate: false,
      deckId: 42,
      imageId: "img-existing",
    });
    expect(db.batches).toHaveLength(2);
    expect(db.batches[1]?.[0]?.sql).toBe("DELETE FROM deck_stats WHERE deck_id = ?;");
    expect(db.batches[1]?.[1]?.sql).toBe("DELETE FROM deck_cards WHERE deck_id = ?;");
  });
});
