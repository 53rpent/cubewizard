import { describe, expect, it } from "vitest";
import { executeDeckWritePlan } from "./executeDeckWritePlan";
import type { DeckPayload } from "./types";

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
      cards: [{ name: "Mountain" }],
      total_requested: 1,
      total_found: 1,
      not_found: [],
      success_rate: 1,
    },
  },
});

function createDb(existing: { deck_id: number; image_id: string; has_stats: number; card_count: number } | null) {
  const batches: Array<Array<{ sql: string; args: unknown[] }>> = [];
  return {
    batches,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            sql,
            args,
            async first() {
              if (sql.includes("FROM decks d LEFT JOIN deck_stats")) return existing;
              return null;
            },
            async run() {
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
    async batch(stmts: Array<{ sql: string; args: unknown[] }>) {
      batches.push(stmts);
      return stmts.map(() => ({ meta: { changes: 1 } }));
    },
  };
}

describe("executeDeckWritePlan", () => {
  it("repairs same-job deck shells before reporting success", async () => {
    const db = createDb({ deck_id: 42, image_id: "img", has_stats: 0, card_count: 0 });

    const result = await executeDeckWritePlan(db, "cube", minimalDeck());

    expect(result).toMatchObject({ success: true, duplicate: false, deckId: 42, imageId: "img" });
    expect(db.batches).toHaveLength(1);
    expect(db.batches[0]?.some((stmt) => stmt.sql.includes("DELETE FROM deck_cards"))).toBe(true);
    expect(db.batches[0]?.some((stmt) => stmt.sql.includes("INSERT INTO deck_stats"))).toBe(true);
    expect(db.batches[0]?.some((stmt) => stmt.sql.includes("INSERT INTO deck_cards"))).toBe(true);
  });

  it("continues same-job finalization when an existing deck is already complete", async () => {
    const db = createDb({ deck_id: 42, image_id: "img", has_stats: 1, card_count: 1 });

    const result = await executeDeckWritePlan(db, "cube", minimalDeck());

    expect(result).toMatchObject({ success: true, duplicate: false, deckId: 42, imageId: "img" });
    expect(db.batches).toHaveLength(0);
  });
});
