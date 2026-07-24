import { describe, expect, it } from "vitest";
import { type D1DatabaseLike, executeDeckWritePlan } from "./executeDeckWritePlan";
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
  statsTotalFound: number;
  cards: unknown[][];
  nextDeckId: number;
}

function minimalDeck(processingTimestamp = "ts1"): DeckPayload {
  return {
    deck: {
      metadata: {
        pilot_name: "P",
        match_wins: 2,
        match_losses: 1,
        match_draws: 0,
        record_logged: "2026-01-01T00:00:00",
        win_rate: 0.667,
        image_source: "",
        processing_timestamp: processingTimestamp,
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
  };
}

function createFakeD1(initial: Partial<FakeState> = {}): D1DatabaseLike & { state: FakeState } {
  const state: FakeState = {
    deck: initial.deck ?? null,
    hasStats: initial.hasStats ?? false,
    statsTotalFound: initial.statsTotalFound ?? initial.cards?.length ?? 0,
    cards: initial.cards ?? [],
    nextDeckId: initial.nextDeckId ?? 1,
  };

  function deckMatches(args: unknown[]): boolean {
    return Boolean(state.deck && state.deck.cube_id === args[0] && state.deck.processing_timestamp === args[1]);
  }

  function firstDeckWriteState<T>(args: unknown[]): T | null {
    if (!deckMatches(args)) return null;
    return {
      deck_id: state.deck?.deck_id,
      image_id: state.deck?.image_id,
      stats_deck_id: state.hasStats ? state.deck?.deck_id : null,
      stats_total_found: state.statsTotalFound,
      card_count: state.cards.length,
    } as T;
  }

  function firstDeckLookup<T>(args: unknown[]): T | null {
    if (!deckMatches(args)) return null;
    return { deck_id: state.deck?.deck_id } as T;
  }

  const runHandlers = [
    {
      prefix: "INSERT OR IGNORE INTO cubes",
      run: () => ({ meta: { changes: 1 } }),
    },
    {
      prefix: "INSERT OR IGNORE INTO decks",
      run: (args: unknown[]) => {
        if (state.deck) return { meta: { changes: 0 } };
        state.deck = {
          deck_id: state.nextDeckId++,
          cube_id: String(args[0]),
          image_id: String(args[8]),
          processing_timestamp: String(args[9]),
        };
        return { meta: { changes: 1 } };
      },
    },
    {
      prefix: "DELETE FROM deck_cards",
      run: () => {
        const changes = state.cards.length;
        state.cards = [];
        return { meta: { changes } };
      },
    },
    {
      prefix: "DELETE FROM deck_stats",
      run: () => {
        const changes = state.hasStats ? 1 : 0;
        state.hasStats = false;
        state.statsTotalFound = 0;
        return { meta: { changes } };
      },
    },
    {
      prefix: "INSERT INTO deck_stats",
      run: (args: unknown[]) => {
        state.hasStats = true;
        state.statsTotalFound = Number(args[1]);
        return { meta: { changes: 1 } };
      },
    },
    {
      prefix: "INSERT INTO deck_cards",
      run: (args: unknown[]) => {
        state.cards.push(args);
        return { meta: { changes: 1 } };
      },
    },
    {
      prefix: "UPDATE cubes SET",
      run: () => ({ meta: { changes: 1 } }),
    },
  ];

  function runStatement(sql: string, args: unknown[]): { meta: { changes: number } } {
    const handler = runHandlers.find((candidate) => sql.startsWith(candidate.prefix));
    if (handler) return handler.run(args);
    throw new Error(`Unexpected SQL: ${sql}`);
  }

  const db: D1DatabaseLike & { state: FakeState } = {
    state,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            sql,
            args,
            async first<T = unknown>(): Promise<T | null> {
              if (sql.startsWith("SELECT d.deck_id")) {
                return firstDeckWriteState<T>(args);
              }
              if (sql.startsWith("SELECT deck_id FROM decks")) {
                return firstDeckLookup<T>(args);
              }
              throw new Error(`Unexpected first SQL: ${sql}`);
            },
            async run() {
              return runStatement(sql, args);
            },
          };
        },
      };
    },
    async batch(statements: unknown[]) {
      const results: Array<{ meta?: { changes?: number } }> = [];
      for (const stmt of statements as Array<{ run(): Promise<{ meta?: { changes?: number } }> }>) {
        results.push(await stmt.run());
      }
      return results;
    },
  };
  return db;
}

describe("executeDeckWritePlan", () => {
  it("treats a complete existing deck as a duplicate", async () => {
    const db = createFakeD1({
      deck: { deck_id: 7, cube_id: "cube", image_id: "img", processing_timestamp: "ts1" },
      hasStats: true,
      statsTotalFound: 1,
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
      statsTotalFound: 1,
      cards: [],
    });

    const result = await executeDeckWritePlan(db, "cube", minimalDeck());

    expect(result.duplicate).toBe(false);
    expect(db.state.hasStats).toBe(true);
    expect(db.state.cards).toHaveLength(1);
  });
});
