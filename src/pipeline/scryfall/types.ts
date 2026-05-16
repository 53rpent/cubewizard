/** Subset of Scryfall card JSON used by CubeWizard D1 rows. */
export interface ScryfallCardJson {
  name?: string;
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
  card_faces?: Array<{ image_uris?: Record<string, string>; name?: string }>;
  prices?: Record<string, unknown>;
  legalities?: Record<string, string>;
}

/** Enriched deck card row written to D1. */
export interface EnrichedDeckCardRow {
  name: string | null;
  mana_cost: string;
  cmc: number;
  type_line: string;
  colors: string[];
  color_identity: string[];
  rarity: string;
  set: string;
  set_name: string;
  collector_number: string;
  power: string | null;
  toughness: string | null;
  oracle_text: string;
  scryfall_uri: string;
  image_uris: Record<string, string>;
  prices: Record<string, unknown>;
  legalities: Record<string, string>;
}

export interface EnrichCardListResult {
  cards: EnrichedDeckCardRow[];
  total_requested: number;
  total_found: number;
  not_found: string[];
  success_rate: number;
}

function pickImageUris(card: ScryfallCardJson): Record<string, string> {
  if (card.image_uris && Object.keys(card.image_uris).length > 0) {
    return card.image_uris;
  }
  const face = card.card_faces?.[0];
  if (face?.image_uris && Object.keys(face.image_uris).length > 0) {
    return face.image_uris;
  }
  return {};
}

export function mapScryfallCardToRow(card: ScryfallCardJson): EnrichedDeckCardRow {
  let cmc = card.cmc ?? 0;
  if (typeof cmc !== "number" || !Number.isFinite(cmc)) {
    const parsed = parseFloat(String(card.cmc));
    cmc = Number.isFinite(parsed) ? parsed : 0;
  }
  return {
    name: card.name ?? null,
    mana_cost: card.mana_cost ?? "",
    cmc,
    type_line: card.type_line ?? "",
    colors: card.colors ?? [],
    color_identity: card.color_identity ?? [],
    rarity: card.rarity ?? "",
    set: card.set ?? "",
    set_name: card.set_name ?? "",
    collector_number:
      card.collector_number != null ? String(card.collector_number) : "",
    power: card.power ?? null,
    toughness: card.toughness ?? null,
    oracle_text: card.oracle_text ?? "",
    scryfall_uri: card.scryfall_uri ?? "",
    image_uris: pickImageUris(card),
    prices: card.prices ?? {},
    legalities: card.legalities ?? {},
  };
}

/** Name-only row when Scryfall has no match (aligned with `stubDeckRowForName` in [`src/worker.js`](../../worker.js)). */
export function stubDeckCardRowForName(name: string): EnrichedDeckCardRow {
  return {
    name,
    mana_cost: "",
    cmc: 0,
    type_line: "",
    colors: [],
    color_identity: [],
    rarity: "",
    set: "",
    set_name: "",
    collector_number: "",
    power: null,
    toughness: null,
    oracle_text: "",
    scryfall_uri: "",
    image_uris: {},
    prices: {},
    legalities: {},
  };
}
