import { describe, expect, it } from "vitest";
import { executeDeckWritePlan } from "./executeDeckWritePlan";
import type { DeckPayload } from "./types";

interface DeckRow {
  deck_id: number;
  cube_id: string;
  image_id: string;
  processing_timestamp: string;
}

interface FakeState {
  deck: DeckRow | null;
  hasStats: boolean;
  cards: unknown[][];
  nextDeckId: number;
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

function createFakeD1(initial: Partial<FakeState> = {}) {
  const state: FakeState = {
    deck: initial.deck ?? null,
    hasStats: initial.hasStats ?? false,
    cards: initial.cards ?? [],
    nextDeckId: initial.nextDeckId ?? 1,
  };

  function deckMatches(args: unknown[]): boolean {
    return Boolean(state.deck && state.deck.cube_id === args[0] && state.deck.processing_timestamp === args[1]);
  }

  function firstForSql(sql: string, args: unknown[]) {
    if (sql.includes("FROM decks d")) {
      if (!deckMatches(args)) return null;
      return {
        deck_id: state.deck?.deck_id,
        image_id: state.deck?.image_id,
        stats_deck_id: state.hasStats ? state.deck?.deck_id : null,
        card_count: state.cards.length,
      };
    }
    if (sql.includes("SELECT deck_id FROM decks")) {
      if (!deckMatches(args)) return null;
      return { deck_id: state.deck?.deck_id };
    }
    return null;
  }

  const db = {
    state,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            sql,
            args,
            async first<T>() {
              return firstForSql(sql, args) as T | null;
            },
          };
        },
      };
    },
    async batch(stmts: Array<{ sql: string; args: unknown[] }>) {
      return stmts.map((stmt) => {
        if (stmt.sql.startsWith("INSERT OR IGNORE INTO decks")) {
          if (state.deck) return { meta: { changes: 0 } };
          state.deck = {
            deck_id: state.nextDeckId++,
            cube_id: String(stmt.args[0]),
            image_id: String(stmt.args[8]),
            processing_timestamp: String(stmt.args[9]),
          };
          return { meta: { changes: 1 } };
        }
        if (stmt.sql.startsWith("DELETE FROM deck_cards")) {
          state.cards = [];
          return { meta: { changes: 1 } };
        }
        if (stmt.sql.startsWith("DELETE FROM deck_stats")) {
          state.hasStats = false;
          return { meta: { changes: 1 } };
        }
        if (stmt.sql.startsWith("INSERT INTO deck_stats")) {
          state.hasStats = true;
          return { meta: { changes: 1 } };
        }
        if (stmt.sql.startsWith("INSERT INTO deck_cards")) {
          state.cards.push(stmt.args);
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 1 } };
      });
    },
  };
  return db;
}

describe("executeDeckWritePlan", () => {
  it("treats a complete existing deck as a duplicate", async () => {
    const db = createFakeD1({
      deck: { deck_id: 7, cube_id: "cube", image_id: "img", processing_timestamp: "ts1" },
      hasStats: true,
      cards: [["existing-card"]],
    });

    const result = await executeDeckWritePlan(db, "cube", minimalDeck());

    expect(result).toEqual({ success: true, duplicate: true, deckId: 7, imageId: "img" });
    expect(db.state.cards).toHaveLength(1);
  });

  it("repairs an existing deck shell instead of finalizing it as a duplicate", async () => {
    const db = createFakeD1({
      deck: { deck_id: 7, cube_id: "cube", image_id: "img", processing_timestamp: "ts1" },
      hasStats: false,
      cards: [],
    });

    const result = await executeDeckWritePlan(db, "cube", minimalDeck());

    expect(result).toEqual({ success: true, duplicate: false, deckId: 7, imageId: "img" });
    expect(db.state.hasStats).toBe(true);
    expect(db.state.cards).toHaveLength(1);
    expect(db.state.cards[0]?.[1]).toBe("Mountain");
  });

  it("rebuilds partial child rows before retrying deck stats and cards", async () => {
    const db = createFakeD1({
      deck: { deck_id: 7, cube_id: "cube", image_id: "img", processing_timestamp: "ts1" },
      hasStats: true,
      cards: [],
    });

    const result = await executeDeckWritePlan(db, "cube", minimalDeck());

    expect(result.duplicate).toBe(false);
    expect(db.state.hasStats).toBe(true);
    expect(db.state.cards).toHaveLength(1);
  });
});
