import { afterEach, describe, expect, it, vi } from "vitest";
import { ScryfallClient } from "./client";
import { resetScryfallGlobalThrottleForTests } from "./globalThrottle";
import { mapScryfallCardToRow } from "./types";

describe("mapScryfallCardToRow", () => {
  it("uses card_faces image_uris when top-level image_uris is missing", () => {
    const row = mapScryfallCardToRow({
      name: "Fable of the Mirror-Breaker",
      card_faces: [{ image_uris: { small: "https://example.com/fable.jpg" } }],
    });
    expect(row.image_uris.small).toBe("https://example.com/fable.jpg");
  });
});

describe("ScryfallClient", () => {
  afterEach(() => {
    resetScryfallGlobalThrottleForTests();
  });

  it("enrichCardList maps collection data and lists not_found", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/cards/collection") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            object: "list",
            data: [
              {
                name: "Lightning Bolt",
                mana_cost: "{R}",
                cmc: 1,
                type_line: "Instant",
                colors: ["R"],
                color_identity: ["R"],
                rarity: "uncommon",
                set: "lea",
                set_name: "Limited Edition Alpha",
                collector_number: "116",
                oracle_text: "Lightning Bolt deals 3 damage to any target.",
                scryfall_uri: "https://scryfall.com/card/lea/116/lightning-bolt",
                image_uris: { small: "https://..." },
                prices: { usd: "99.99" },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("not found", { status: 404 });
    });

    const client = new ScryfallClient({
      fetchImpl: fetchImpl as typeof fetch,
    });
    const r = await client.enrichCardList(["Lightning Bolt", "ZZZUnknownZZZ"]);
    expect(r.total_found).toBe(1);
    expect(r.not_found).toEqual(["ZZZUnknownZZZ"]);
    expect(r.cards).toHaveLength(2);
    expect(r.cards[0]!.name).toBe("Lightning Bolt");
    expect(r.cards[0]!.scryfall_uri).toContain("scryfall.com");
    expect(r.cards[1]!.name).toBe("ZZZUnknownZZZ");
    expect(r.cards[1]!.scryfall_uri).toBe("");
  });

  it("fuzzy-fills cards missing from collection batch when collection returns 200", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/cards/collection") && init?.method === "POST") {
        return new Response(JSON.stringify({ object: "list", data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/cards/named")) {
        return new Response(
          JSON.stringify({
            name: "Island",
            cmc: 0,
            type_line: "Basic Land — Island",
            scryfall_uri: "https://scryfall.com/card/island",
            image_uris: { small: "https://island.jpg" },
          }),
          { status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      return new Response("?", { status: 404 });
    });

    const client = new ScryfallClient({
      fetchImpl: fetchImpl as typeof fetch,
    });
    const r = await client.enrichCardList(["Island"]);
    expect(r.total_found).toBe(1);
    expect(r.cards[0]!.scryfall_uri).toContain("scryfall.com");
    expect(r.cards[0]!.image_uris.small).toBe("https://island.jpg");
  });

  it("falls back to /cards/named when collection returns non-OK", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/cards/collection")) {
        return new Response("err", { status: 500 });
      }
      if (url.includes("/cards/named")) {
        return new Response(
          JSON.stringify({
            name: "Island",
            cmc: 0,
            type_line: "Basic Land — Island",
            scryfall_uri: "https://scryfall.com/card/island",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("?", { status: 404 });
    });

    const client = new ScryfallClient({
      fetchImpl: fetchImpl as typeof fetch,
      collectionBatchSize: 75,
    });
    const { rows } = await client.resolveCardNamesInOrder(["Island"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Island");
  });

  it("matches collection results to requested names via name pool", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/cards/collection") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            data: [
              {
                name: "Snapcaster Mage",
                scryfall_uri: "https://scryfall.com/card/snap",
                image_uris: { small: "https://snap.jpg" },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("not found", { status: 404 });
    });

    const client = new ScryfallClient({
      fetchImpl: fetchImpl as typeof fetch,
    });
    const { rows } = await client.resolveCardNamesInOrder(["Snapcaster Mage"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.scryfall_uri).toContain("scryfall.com");
  });
});
