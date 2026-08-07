import { describe, expect, it } from "vitest";
import { executeDeckWritePlan, type D1DatabaseLike } from "./executeDeckWritePlan";
import type { DeckPayload } from "./types";

type DeckRow = {
  deck_id: number;
  cube_id: string;
  processing_timestamp: string;
  image_id: string;
};

type BoundStatement = {
  sql: string;
  params: unknown[];
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
};

class FakeDeckDb implements D1DatabaseLike {
  decks: DeckRow[];
  deckStats = new Set<number>();
  deckCardCounts = new Map<number, number>();
  batches: string[][] = [];

  constructor(decks: DeckRow[]) {
    this.decks = decks;
  }

  prepare(sql: string) {
    return {
      bind: (...params: unknown[]) => this.bound(sql, params),
    };
  }

  async batch(stmts: unknown[]): Promise<Array<{ meta?: { changes?: number } } | undefined>> {
    const bound = stmts as BoundStatement[];
    this.batches.push(bound.map((stmt) => stmt.sql));

    return bound.map((stmt) => {
      if (stmt.sql.startsWith("INSERT OR IGNORE INTO decks")) {
        const imageId = String(stmt.params[8]);
        if (this.decks.some((deck) => deck.image_id === imageId)) {
          return { meta: { changes: 0 } };
        }
        this.decks.push({
          deck_id: 100 + this.decks.length,
          cube_id: String(stmt.params[0]),
          image_id: imageId,
          processing_timestamp: String(stmt.params[9]),
        });
        return { meta: { changes: 1 } };
      }

      if (stmt.sql === "DELETE FROM deck_stats WHERE deck_id = ?") {
        this.deckStats.delete(Number(stmt.params[0]));
        return { meta: { changes: 1 } };
      }

      if (stmt.sql === "DELETE FROM deck_cards WHERE deck_id = ?") {
        this.deckCardCounts.set(Number(stmt.params[0]), 0);
        return { meta: { changes: 1 } };
      }

      if (stmt.sql.startsWith("INSERT INTO deck_stats")) {
        this.deckStats.add(Number(stmt.params[0]));
        return { meta: { changes: 1 } };
      }

      if (stmt.sql.startsWith("INSERT INTO deck_cards")) {
        const deckId = Number(stmt.params[0]);
        this.deckCardCounts.set(deckId, (this.deckCardCounts.get(deckId) ?? 0) + 1);
        return { meta: { changes: 1 } };
      }

      return { meta: { changes: 1 } };
    });
  }

  private bound(sql: string, params: unknown[]): BoundStatement {
    return {
      sql,
      params,
      first: async <T = unknown>() => this.first(sql, params) as T | null,
      run: async () => ({}),
    };
  }

  private first(sql: string, params: unknown[]): unknown | null {
    if (sql.includes("WHERE cube_id = ? AND processing_timestamp = ?")) {
      return (
        this.decks.find(
          (deck) => deck.cube_id === String(params[0]) && deck.processing_timestamp === String(params[1]),
        ) ?? null
      );
    }

    if (sql.includes("WHERE image_id = ?")) {
      return this.decks.find((deck) => deck.image_id === String(params[0])) ?? null;
    }

    if (sql.includes("SELECT COUNT(*) FROM deck_stats")) {
      const deckId = Number(params[0]);
      return {
        stats_count: this.deckStats.has(deckId) ? 1 : 0,
        card_count: this.deckCardCounts.get(deckId) ?? 0,
      };
    }

    return null;
  }
}

function deckPayload(): DeckPayload {
  return {
    deck: {
      metadata: {
        pilot_name: "Pilot",
        match_wins: 2,
        match_losses: 1,
        match_draws: 0,
        record_logged: "2026-01-01T00:00:00.000Z",
        win_rate: 0.667,
        image_source: "upload",
        processing_timestamp: "ts-1",
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
        not_found: [],
        success_rate: 1,
      },
    },
  };
}

describe("executeDeckWritePlan", () => {
  it("repairs an existing deck shell before treating an extract retry as complete", async () => {
    const db = new FakeDeckDb([
      {
        deck_id: 42,
        cube_id: "cube-1",
        processing_timestamp: "ts-1",
        image_id: "existing-image",
      },
    ]);

    const result = await executeDeckWritePlan(db, "cube-1", deckPayload());

    expect(result).toMatchObject({ success: true, duplicate: false, deckId: 42, imageId: "existing-image" });
    expect(db.deckStats.has(42)).toBe(true);
    expect(db.deckCardCounts.get(42)).toBe(1);
    expect(db.batches).toHaveLength(1);
    expect(db.batches[0]?.[0]).toBe("DELETE FROM deck_stats WHERE deck_id = ?");
    expect(db.batches[0]?.some((sql) => sql.startsWith("INSERT INTO deck_cards"))).toBe(true);
  });

  it("returns an existing complete deck so callers can finish auxiliary updates on retry", async () => {
    const db = new FakeDeckDb([
      {
        deck_id: 42,
        cube_id: "cube-1",
        processing_timestamp: "ts-1",
        image_id: "existing-image",
      },
    ]);
    db.deckStats.add(42);
    db.deckCardCounts.set(42, 1);

    const result = await executeDeckWritePlan(db, "cube-1", deckPayload());

    expect(result).toMatchObject({ success: true, duplicate: false, deckId: 42, imageId: "existing-image" });
    expect(db.batches).toHaveLength(0);
  });
});
