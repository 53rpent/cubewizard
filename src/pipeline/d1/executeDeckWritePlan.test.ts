import { describe, expect, it, vi } from "vitest";
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

function createDb(existingRows: Array<Record<string, unknown> | null>) {
  const batch = vi.fn(async () => {
    throw new Error("batch should not run for pre-existing duplicate rows");
  });
  return {
    batch,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            first: vi.fn(async () => {
              if (sql.includes("FROM decks d LEFT JOIN deck_stats")) {
                return existingRows.shift() ?? null;
              }
              return null;
            }),
            args,
            sql,
          };
        },
      };
    },
  };
}

describe("executeDeckWritePlan duplicate handling", () => {
  it("treats complete existing deck rows as duplicate success", async () => {
    const db = createDb([{ deck_id: 42, image_id: "existing-image", total_found: 1, card_count: 1 }]);

    const result = await executeDeckWritePlan(db, "cube", minimalDeck());

    expect(result).toEqual({ success: true, duplicate: true, deckId: 42, imageId: "existing-image" });
    expect(db.batch).not.toHaveBeenCalled();
  });

  it("does not mark an incomplete existing deck shell as duplicate success", async () => {
    const db = createDb([{ deck_id: 42, image_id: "existing-image", total_found: null, card_count: 0 }]);

    const result = await executeDeckWritePlan(db, "cube", minimalDeck());

    expect(result.success).toBe(false);
    expect(result.duplicate).toBe(false);
    expect(result.deckId).toBe(42);
    expect(db.batch).not.toHaveBeenCalled();
  });
});
