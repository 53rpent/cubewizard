/** D1 write plan types for the eval queue consumer. */
export type JsonPrimitive = string | number | boolean | null;

export interface D1Statement {
  sql: string;
  /** Bound parameters in D1 / SQLite order (omit or empty for no binds). */
  params?: JsonPrimitive[];
}

export interface DeckMetadata {
  pilot_name: string;
  match_wins: number;
  match_losses: number;
  match_draws?: number;
  record_logged: string;
  win_rate: number;
  image_source?: string;
  processing_timestamp: string;
  total_cards: number;
}

/** One row of Scryfall-enriched card data (subset stored in `deck_cards`). */
export interface DeckCardRow {
  name: string | null;
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  colors?: string[];
  color_identity?: string[];
  rarity?: string;
  set?: string;
  set_name?: string;
  collector_number?: string;
  power?: string | null;
  toughness?: string | null;
  oracle_text?: string;
  scryfall_uri?: string;
  image_uris?: Record<string, string>;
  prices?: Record<string, JsonPrimitive>;
  /** Present on Scryfall-enriched rows; not persisted in D1. */
  legalities?: Record<string, string>;
}

/** `card_enriched_data` from `ScryfallClient.enrich_card_list`. */
export interface CardsEnrichmentBlock {
  cards: DeckCardRow[];
  total_requested?: number;
  total_found?: number;
  total_not_found?: number;
  not_found?: string[];
  success_rate?: number;
}

export interface DeckPayload {
  deck: {
    metadata: DeckMetadata;
    cards: CardsEnrichmentBlock;
  };
}

export interface DeckWritePlan {
  imageId: string;
  batchA: D1Statement[];
  lookup: D1Statement;
  buildBatchB: (deckId: number) => D1Statement[];
}
