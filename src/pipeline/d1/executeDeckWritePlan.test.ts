import { describe, expect, it } from "vitest";
import { executeDeckWritePlan } from "./executeDeckWritePlan";
import type { DeckPayload } from "./types";

interface BoundStatement {
  sql: string;
  args: unknown[];
  first?: <T = unknown>() => Promise<T | null>;
}

function minimalDeck(): DeckPayload {
  return {
    deck: {
      metadata: {
        pilot_name: "Pilot",
        match_wins: 2,
        match_losses: 1,
        match_draws: 0,
        record_logged: "2026-01-01T00:00:00Z",
        win_rate: 0.667,
        image_source: "",
        processing_timestamp: "upload-1",
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
            oracle_text: "{T}: Add {R}.",
            scryfall_uri: "https://scryfall.com/card/lea/164/mountain",
            image_uris: {},
            prices: {},
          },
        ],
        total_requested: 1,
        total_found: 1,
        total_not_found: 0,
        not_found: [],
        success_rate: 1,
      },
    },
  };
}

function createDbMock(existingRow: Record<string, unknown> | null) {
  const batches: BoundStatement[][] = [];
  const db = {
    batches,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]): BoundStatement {
          return {
            sql,
            args,
            async first<T = unknown>() {
              if (sql.includes("FROM decks d")) return existingRow as T | null;
              if (sql.includes("SELECT deck_id FROM decks")) return { deck_id: 99 } as T;
              return null;
            },
          };
        },
      };
    },
    async batch(stmts: unknown[]) {
      batches.push(stmts as BoundStatement[]);
      return stmts.map(() => ({ meta: { changes: 1 } }));
    },
  };
  return db;
}

describe("executeDeckWritePlan duplicate retry handling", () => {
  it("rebuilds dependent rows when a previous attempt left only a deck shell", async () => {
    const db = createDbMock({
      deck_id: 42,
      image_id: "image-42",
      stats_deck_id: null,
      card_count: 0,
    });

    const result = await executeDeckWritePlan(db, "cube", minimalDeck());

    expect(result).toEqual({ success: true, duplicate: false, deckId: 42, imageId: "image-42" });
    expect(db.batches).toHaveLength(1);
    expect(db.batches[0]?.map((stmt) => stmt.sql)).toEqual([
      "DELETE FROM deck_cards WHERE deck_id = ?;",
      "DELETE FROM deck_stats WHERE deck_id = ?;",
      expect.stringContaining("INSERT INTO deck_stats"),
      expect.stringContaining("INSERT INTO deck_cards"),
      expect.stringContaining("UPDATE cubes SET"),
    ]);
  });

  it("treats an existing deck as a duplicate only after stats and cards are present", async () => {
    const db = createDbMock({
      deck_id: 42,
      image_id: "image-42",
      stats_deck_id: 42,
      card_count: 1,
    });

    const result = await executeDeckWritePlan(db, "cube", minimalDeck());

    expect(result).toEqual({ success: true, duplicate: true, deckId: 42, imageId: "image-42" });
    expect(db.batches).toHaveLength(0);
  });
});
