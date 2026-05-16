import type { DeckPayload, D1Statement, DeckWritePlan } from "./types";
import { computeImageId } from "./imageId";

function stmt(sql: string, params?: D1Statement["params"]): D1Statement {
  const s: D1Statement = { sql };
  if (params !== undefined) s.params = params;
  return s;
}

/**
 * True when the second statement in batch A (deck `INSERT OR IGNORE`) made no row change —
 * duplicate `image_id` within a cube.
 */
export function deckInsertWasDuplicate(
  batchAResults: Array<{ meta?: { changes?: number } } | undefined>
): boolean {
  const deckInsertMeta = batchAResults[1]?.meta ?? {};
  return (deckInsertMeta.changes ?? 1) === 0;
}

/**
 * Build parameterized D1 statements for one deck insert (two-phase: A then B after `deck_id` lookup).
 */
export async function buildDeckWritePlan(
  cubeId: string,
  deckData: DeckPayload
): Promise<DeckWritePlan> {
  const metadata = deckData.deck.metadata;
  const cardsData = deckData.deck.cards;
  const now = metadata.record_logged ?? "";

  const imageId = await computeImageId(
    cubeId,
    metadata.pilot_name,
    metadata.processing_timestamp
  );

  const batchA: D1Statement[] = [
    stmt(
      "INSERT OR IGNORE INTO cubes (cube_id, created, last_updated, total_decks) " +
        "VALUES (?, ?, ?, 0);",
      [cubeId, now, now]
    ),
    stmt(
      "INSERT OR IGNORE INTO decks " +
        "(cube_id, pilot_name, match_wins, match_losses, match_draws, win_rate, " +
        "record_logged, image_source, image_id, processing_timestamp, total_cards) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
      [
        cubeId,
        metadata.pilot_name,
        metadata.match_wins,
        metadata.match_losses,
        metadata.match_draws ?? 0,
        metadata.win_rate,
        metadata.record_logged,
        metadata.image_source ?? "",
        imageId,
        metadata.processing_timestamp,
        metadata.total_cards,
      ]
    ),
  ];

  const lookup = stmt(
    "SELECT deck_id FROM decks " +
      "WHERE cube_id = ? AND processing_timestamp = ? AND pilot_name = ? " +
      "ORDER BY deck_id DESC LIMIT 1;",
    [cubeId, metadata.processing_timestamp, metadata.pilot_name]
  );

  function buildBatchB(deckId: number): D1Statement[] {
    const stmts: D1Statement[] = [];
    const notFound = cardsData.not_found ?? [];
    let totalNotFound = cardsData.total_not_found;
    if (totalNotFound === undefined || totalNotFound === null) {
      totalNotFound = notFound.length;
    }

    const processingNotes = {
      total_requested: cardsData.total_requested,
      total_found: cardsData.total_found,
      total_not_found: totalNotFound,
      not_found: notFound,
      success_rate: cardsData.success_rate,
    };

    stmts.push(
      stmt(
        "INSERT INTO deck_stats (deck_id, total_found, total_not_found, processing_notes) " +
          "VALUES (?, ?, ?, ?);",
        [
          deckId,
          cardsData.total_found ?? 0,
          totalNotFound,
          JSON.stringify(processingNotes),
        ]
      )
    );

    for (const card of cardsData.cards ?? []) {
      stmts.push(
        stmt(
          "INSERT INTO deck_cards " +
            "(deck_id, name, mana_cost, cmc, type_line, colors, color_identity, " +
            "rarity, set_code, set_name, collector_number, power, toughness, " +
            "oracle_text, scryfall_uri, image_uris, prices) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
          [
            deckId,
            card.name,
            card.mana_cost ?? null,
            card.cmc ?? null,
            card.type_line ?? null,
            JSON.stringify(card.colors ?? []),
            JSON.stringify(card.color_identity ?? []),
            card.rarity ?? null,
            card.set ?? null,
            card.set_name ?? null,
            card.collector_number ?? null,
            card.power ?? null,
            card.toughness ?? null,
            card.oracle_text ?? null,
            card.scryfall_uri ?? null,
            JSON.stringify(card.image_uris ?? {}),
            JSON.stringify(card.prices ?? {}),
          ]
        )
      );
    }

    stmts.push(
      stmt(
        "UPDATE cubes SET " +
          "total_decks = (SELECT COUNT(*) FROM decks WHERE cube_id = ?), " +
          "last_updated = ? " +
          "WHERE cube_id = ?;",
        [cubeId, now, cubeId]
      )
    );

    return stmts;
  }

  return { imageId, batchA, lookup, buildBatchB };
}
