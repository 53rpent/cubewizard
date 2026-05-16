import { describe, expect, it } from "vitest";
import { buildDeckWritePlan, deckInsertWasDuplicate } from "./deckWriteBatches";
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
          type_line: "Basic Land — Mountain",
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

describe("buildDeckWritePlan", () => {
  it("produces two batch-A statements and a deck lookup", async () => {
    const cubeId = "abc123";
    const plan = await buildDeckWritePlan(cubeId, minimalDeck());
    expect(plan.batchA).toHaveLength(2);
    expect(plan.batchA[0]!.sql).toContain("INSERT OR IGNORE INTO cubes");
    expect(plan.batchA[1]!.sql).toContain("INSERT OR IGNORE INTO decks");
    expect(plan.batchA[1]!.params![8]).toBe(plan.imageId);
    expect(plan.lookup.sql).toContain("SELECT deck_id FROM decks");
    expect(plan.lookup.params).toEqual([cubeId, "ts1", "P"]);
  });

  it("buildBatchB includes deck_stats, one deck_card, and cube counter update", async () => {
    const plan = await buildDeckWritePlan("c1", minimalDeck());
    const b = plan.buildBatchB(42);
    expect(b[0]!.sql).toContain("INSERT INTO deck_stats");
    expect(b[0]!.params![0]).toBe(42);
    expect(b[1]!.sql).toContain("INSERT INTO deck_cards");
    expect(b[1]!.params![0]).toBe(42);
    expect(b[1]!.params![1]).toBe("Mountain");
    expect(b[b.length - 1]!.sql).toContain("UPDATE cubes SET");
  });

  it("defaults total_not_found from not_found length when omitted", async () => {
    const deck = minimalDeck();
    deck.deck.cards.total_not_found = undefined;
    deck.deck.cards.not_found = ["Missing Card"];
    const plan = await buildDeckWritePlan("c", deck);
    const notes = JSON.parse(plan.buildBatchB(1)[0]!.params![3] as string) as {
      total_not_found: number;
    };
    expect(notes.total_not_found).toBe(1);
  });
});

describe("deckInsertWasDuplicate", () => {
  it("detects duplicate deck insert when changes is 0", () => {
    expect(deckInsertWasDuplicate([{}, { meta: { changes: 0 } }])).toBe(true);
    expect(deckInsertWasDuplicate([{}, { meta: { changes: 1 } }])).toBe(false);
  });
});
