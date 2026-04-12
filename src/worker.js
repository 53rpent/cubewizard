/**
 * CubeWizard Cloudflare Worker
 *
 * Handles deck image uploads (R2), serves analytics API endpoints (D1),
 * and static assets for the dashboard SPA.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // --- Analytics API endpoints (D1) ---
    if (url.pathname === "/api/cubes" && request.method === "GET") {
      return handleGetCubes(env);
    }

    const dashboardMatch = url.pathname.match(/^\/api\/dashboard\/([^/]+)$/);
    if (dashboardMatch && request.method === "GET") {
      return handleGetDashboard(dashboardMatch[1], env);
    }

    const chartsMatch = url.pathname.match(/^\/api\/charts\/([^/]+)\/([^/]+)$/);
    if (chartsMatch && request.method === "GET") {
      return handleGetChart(chartsMatch[1], chartsMatch[2], env);
    }

    const trophyDecksMatch = url.pathname.match(/^\/api\/trophy-decks\/([^/]+)$/);
    if (trophyDecksMatch && request.method === "GET") {
      return handleGetTrophyDecks(trophyDecksMatch[1], env, request);
    }

    const decksMatch = url.pathname.match(/^\/api\/decks\/([^/]+)$/);
    if (decksMatch && request.method === "GET") {
      return handleGetDecks(decksMatch[1], env, request);
    }

    const deckThumbMatch = url.pathname.match(/^\/api\/deck\/([^/]+)\/thumb$/);
    if (deckThumbMatch && request.method === "GET") {
      return handleGetDeckThumb(deckThumbMatch[1], env);
    }

    const deckPhotoMatch = url.pathname.match(/^\/api\/deck\/([^/]+)\/photo$/);
    if (deckPhotoMatch && request.method === "GET") {
      return handleGetDeckPhoto(deckPhotoMatch[1], env);
    }

    const deckCardsPut = url.pathname.match(/^\/api\/deck\/([^/]+)\/cards$/);
    if (deckCardsPut && request.method === "PUT") {
      return handlePutDeckCards(deckCardsPut[1], request, env);
    }

    const deckMatch = url.pathname.match(/^\/api\/deck\/([^/]+)$/);
    if (deckMatch && request.method === "GET") {
      return handleGetDeck(deckMatch[1], env, request);
    }

    // --- Existing endpoints ---
    if (url.pathname === "/api/upload" && request.method === "POST") {
      return handleUpload(request, env);
    }

    if (url.pathname === "/api/validate-cube" && request.method === "GET") {
      return handleValidateCube(url, env);
    }

    if (url.pathname === "/api/add-cube" && request.method === "POST") {
      return handleAddCube(request, env);
    }

    // Serve static assets for all other paths
    try {
      return await env.ASSETS.fetch(request);
    } catch {
      return jsonResponse({ error: "Not found" }, 404);
    }
  },
};

// ============================================================
//  Analytics API handlers
// ============================================================

const BAYESIAN_SMOOTHING_STRENGTH = 5;
const SYNERGY_MIN_APPEARANCES = 3;

async function handleGetCubes(env) {
  const { results } = await env.cubewizard_db.prepare(
    "SELECT c.cube_id, c.total_decks, c.created, c.last_updated," +
    " COALESCE(m.cube_name, c.cube_id) AS cube_name," +
    " COALESCE(m.description, '') AS description" +
    " FROM cubes c" +
    " LEFT JOIN cube_mapping m ON c.cube_id = m.cube_id" +
    " ORDER BY c.total_decks DESC"
  ).all();

  return jsonResponse({ cubes: results });
}

async function handleGetDashboard(cubeId, env) {
  const cubeRow = await env.cubewizard_db.prepare(
    "SELECT * FROM cubes WHERE cube_id = ?"
  ).bind(cubeId).first();

  if (!cubeRow) {
    return jsonResponse({ error: "Cube not found" }, 404);
  }

  const { results: decks } = await env.cubewizard_db.prepare(
    "SELECT * FROM decks WHERE cube_id = ?"
  ).bind(cubeId).all();

  if (decks.length === 0) {
    return jsonResponse({ error: "No decks found for this cube" }, 404);
  }

  const { results: allCards } = await env.cubewizard_db.prepare(
    "SELECT dc.* FROM deck_cards dc" +
    " JOIN decks d ON dc.deck_id = d.deck_id" +
    " WHERE d.cube_id = ?"
  ).bind(cubeId).all();

  var cardsByDeck = {};
  for (var ci = 0; ci < allCards.length; ci++) {
    var card = allCards[ci];
    if (!cardsByDeck[card.deck_id]) cardsByDeck[card.deck_id] = [];
    cardsByDeck[card.deck_id].push(card);
  }

  var imageMap = buildCardImageMapFromRows(allCards);

  var cardPerformances = computeCardPerformance(decks, cardsByDeck);
  attachPerformanceImages(cardPerformances, imageMap);

  var synergies = computeSynergies(decks, cardsByDeck);
  attachSynergyImages(synergies, imageMap);

  var colorAnalysis = computeColorPerformance(decks, cardsByDeck);

  var allDeckWinRates = [];
  var totalWins = 0;
  var totalLosses = 0;
  for (var di = 0; di < decks.length; di++) {
    allDeckWinRates.push(decks[di].win_rate);
    totalWins += decks[di].match_wins;
    totalLosses += decks[di].match_losses;
  }
  var avgWinRate = mean(allDeckWinRates);

  return jsonResponse({
    cube_info: {
      cube_id: cubeRow.cube_id,
      total_decks: cubeRow.total_decks,
      created: cubeRow.created,
      last_updated: cubeRow.last_updated,
      avg_win_rate: avgWinRate,
      total_wins: totalWins,
      total_losses: totalLosses,
    },
    card_performances: cardPerformances,
    synergies: synergies,
    color_analysis: colorAnalysis,
  });
}

async function handleGetChart(cubeId, chartType, env) {
  var { results: decks } = await env.cubewizard_db.prepare(
    "SELECT * FROM decks WHERE cube_id = ?"
  ).bind(cubeId).all();

  if (decks.length === 0) {
    return jsonResponse({ error: "No decks found" }, 404);
  }

  var { results: allCards } = await env.cubewizard_db.prepare(
    "SELECT dc.* FROM deck_cards dc" +
    " JOIN decks d ON dc.deck_id = d.deck_id" +
    " WHERE d.cube_id = ?"
  ).bind(cubeId).all();

  var cardsByDeck = {};
  for (var ci = 0; ci < allCards.length; ci++) {
    var card = allCards[ci];
    if (!cardsByDeck[card.deck_id]) cardsByDeck[card.deck_id] = [];
    cardsByDeck[card.deck_id].push(card);
  }

  var chart;
  if (chartType === "performance_scatter") {
    var perfs = computeCardPerformance(decks, cardsByDeck);
    chart = buildPerformanceScatterChart(perfs);
  } else if (chartType === "color_performance") {
    var colorStats = computeColorPerformance(decks, cardsByDeck);
    chart = buildColorBarChart(colorStats);
  } else {
    return jsonResponse({ error: "Unknown chart type" }, 400);
  }

  return jsonResponse({ chart: JSON.stringify(chart) });
}

// ============================================================
//  Card image helpers (deck_cards.image_uris JSON from Scryfall)
// ============================================================

function parseImageUrisCell(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function pickCardImageUrl(uriObj) {
  if (!uriObj || typeof uriObj !== "object") return null;
  return (
    uriObj.normal ||
    uriObj.small ||
    uriObj.large ||
    uriObj.png ||
    uriObj.art_crop ||
    uriObj.border_crop ||
    null
  );
}

function buildCardImageMapFromRows(rows) {
  var m = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var n = r.name;
    if (!n) continue;
    var k = String(n).toLowerCase();
    if (m[k]) continue;
    var uris = parseImageUrisCell(r.image_uris);
    var url = pickCardImageUrl(uris);
    if (url) m[k] = url;
  }
  return m;
}

function attachPerformanceImages(arr, map) {
  for (var i = 0; i < arr.length; i++) {
    var p = arr[i];
    p.image_url = map[String(p.name).toLowerCase()] || null;
  }
}

function attachSynergyImages(arr, map) {
  for (var i = 0; i < arr.length; i++) {
    var s = arr[i];
    s.card1_image_url = map[String(s.card1).toLowerCase()] || null;
    s.card2_image_url = map[String(s.card2).toLowerCase()] || null;
  }
}

// ============================================================
//  Deck-by-deck API handlers
// ============================================================

function buildBlobImageUrl(request, env, deckId, objectKey, pathSegment) {
  if (!objectKey) return null;
  var base = env.DECK_IMAGE_PUBLIC_BASE_URL;
  if (base && String(base).trim()) {
    var b = String(base).replace(/\/$/, "");
    var parts = String(objectKey).split("/");
    return b + "/" + parts.map(encodeURIComponent).join("/");
  }
  return new URL(
    "/api/deck/" + encodeURIComponent(String(deckId)) + "/" + pathSegment,
    request.url
  ).href;
}

function contentTypeForDeckPhotoKey(key) {
  var lower = String(key).toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic") || lower.endsWith(".heif")) return "image/heic";
  return "application/octet-stream";
}

async function handleGetDeckThumb(deckId, env) {
  const deck = await env.cubewizard_db.prepare(
    "SELECT oriented_thumb_r2_key FROM decks WHERE deck_id = ?"
  ).bind(deckId).first();

  if (!deck || !deck.oriented_thumb_r2_key) {
    return new Response("Not found", { status: 404 });
  }

  const obj = await env.DECK_IMAGES_BLOB.get(deck.oriented_thumb_r2_key);
  if (!obj) {
    return new Response("Not found", { status: 404 });
  }

  var ct =
    obj.httpMetadata && obj.httpMetadata.contentType
      ? obj.httpMetadata.contentType
      : "image/webp";
  var headers = new Headers();
  headers.set("Content-Type", ct);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
}

async function handleGetDeckPhoto(deckId, env) {
  const deck = await env.cubewizard_db.prepare(
    "SELECT oriented_image_r2_key FROM decks WHERE deck_id = ?"
  ).bind(deckId).first();

  if (!deck || !deck.oriented_image_r2_key) {
    return new Response("Not found", { status: 404 });
  }

  const obj = await env.DECK_IMAGES_BLOB.get(deck.oriented_image_r2_key);
  if (!obj) {
    return new Response("Not found", { status: 404 });
  }

  var ct =
    obj.httpMetadata && obj.httpMetadata.contentType
      ? obj.httpMetadata.contentType
      : contentTypeForDeckPhotoKey(deck.oriented_image_r2_key);
  var headers = new Headers();
  headers.set("Content-Type", ct);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
}

async function handleGetDecks(cubeId, env, request) {
  const { results } = await env.cubewizard_db.prepare(
    "SELECT deck_id, cube_id, pilot_name, match_wins, match_losses, match_draws," +
    " win_rate, record_logged, total_cards, created, oriented_image_r2_key," +
    " oriented_thumb_r2_key" +
    " FROM decks WHERE cube_id = ?" +
    " ORDER BY created DESC"
  ).bind(cubeId).all();

  for (var i = 0; i < results.length; i++) {
    var d = results[i];
    d.deck_photo_url = buildBlobImageUrl(
      request, env, d.deck_id, d.oriented_image_r2_key, "photo"
    );
    d.deck_thumb_url = d.oriented_thumb_r2_key
      ? buildBlobImageUrl(request, env, d.deck_id, d.oriented_thumb_r2_key, "thumb")
      : d.deck_photo_url;
  }

  return jsonResponse({ decks: results });
}

async function handleGetTrophyDecks(cubeId, env, request) {
  const { results } = await env.cubewizard_db.prepare(
    "SELECT deck_id, cube_id, pilot_name, match_wins, match_losses, match_draws," +
    " win_rate, total_cards, created, oriented_image_r2_key, oriented_thumb_r2_key" +
    " FROM decks WHERE cube_id = ? AND match_losses = 0" +
    " ORDER BY created DESC" +
    " LIMIT 5"
  ).bind(cubeId).all();

  for (var j = 0; j < results.length; j++) {
    var t = results[j];
    t.deck_photo_url = buildBlobImageUrl(
      request, env, t.deck_id, t.oriented_image_r2_key, "photo"
    );
    t.deck_thumb_url = t.oriented_thumb_r2_key
      ? buildBlobImageUrl(request, env, t.deck_id, t.oriented_thumb_r2_key, "thumb")
      : t.deck_photo_url;
  }

  return jsonResponse({ decks: results });
}

function normalizeCmc(value) {
  var n = Number(value);
  if (!isFinite(n)) return 0;
  if (n < 0) return 0;
  return n;
}

async function handleGetDeck(deckId, env, request) {
  const deck = await env.cubewizard_db.prepare(
    "SELECT deck_id, cube_id, pilot_name, match_wins, match_losses, match_draws," +
    " win_rate, record_logged, image_id, total_cards, created," +
    " oriented_image_r2_key, oriented_thumb_r2_key, staging_image_r2_key" +
    " FROM decks WHERE deck_id = ?"
  ).bind(deckId).first();

  if (!deck) {
    return jsonResponse({ error: "Deck not found" }, 404);
  }

  deck.deck_photo_url = buildBlobImageUrl(
    request,
    env,
    deck.deck_id,
    deck.oriented_image_r2_key,
    "photo"
  );
  deck.deck_thumb_url = deck.oriented_thumb_r2_key
    ? buildBlobImageUrl(
        request,
        env,
        deck.deck_id,
        deck.oriented_thumb_r2_key,
        "thumb"
      )
    : deck.deck_photo_url;

  const deckStats = await env.cubewizard_db.prepare(
    "SELECT total_found, total_not_found, processing_notes FROM deck_stats WHERE deck_id = ?"
  ).bind(deckId).first();

  const { results: cardsRows } = await env.cubewizard_db.prepare(
    "SELECT name, mana_cost, cmc, type_line, image_uris FROM deck_cards WHERE deck_id = ?"
  ).bind(deckId).all();

  var cards = [];
  for (var i = 0; i < cardsRows.length; i++) {
    var c = cardsRows[i];
    var uris = parseImageUrisCell(c.image_uris);
    cards.push({
      name: c.name,
      mana_cost: c.mana_cost || "",
      cmc: normalizeCmc(c.cmc),
      type_line: c.type_line || "",
      image_url: pickCardImageUrl(uris),
    });
  }

  const { results: orderRows } = await env.cubewizard_db.prepare(
    "SELECT name FROM deck_cards WHERE deck_id = ? ORDER BY card_id ASC"
  ).bind(deckId).all();

  var card_names_ordered = [];
  for (var oi = 0; oi < orderRows.length; oi++) {
    card_names_ordered.push(orderRows[oi].name);
  }

  return jsonResponse({
    deck: deck,
    deck_stats: deckStats || null,
    cards: cards,
    card_names_ordered: card_names_ordered,
  });
}

function scryfallCardToDeckRow(card) {
  if (!card) return null;
  var imgUris = card.image_uris;
  if (!imgUris && card.card_faces && card.card_faces[0] && card.card_faces[0].image_uris) {
    imgUris = card.card_faces[0].image_uris;
  }
  var cmc = typeof card.cmc === "number" ? card.cmc : parseFloat(card.cmc);
  if (!isFinite(cmc)) cmc = 0;
  return {
    name: card.name || "",
    mana_cost: card.mana_cost || "",
    cmc: cmc,
    type_line: card.type_line || "",
    colors: JSON.stringify(card.colors || []),
    color_identity: JSON.stringify(card.color_identity || []),
    rarity: card.rarity || "",
    set_code: card.set || "",
    set_name: card.set_name || "",
    collector_number: String(card.collector_number != null ? card.collector_number : ""),
    power: card.power != null ? String(card.power) : "",
    toughness: card.toughness != null ? String(card.toughness) : "",
    oracle_text: card.oracle_text || "",
    scryfall_uri: card.scryfall_uri || "",
    image_uris: JSON.stringify(imgUris || {}),
    prices: JSON.stringify(card.prices || {}),
  };
}

function stubDeckRowForName(name) {
  return {
    name: name,
    mana_cost: "",
    cmc: 0,
    type_line: "",
    colors: "[]",
    color_identity: "[]",
    rarity: "",
    set_code: "",
    set_name: "",
    collector_number: "",
    power: "",
    toughness: "",
    oracle_text: "",
    scryfall_uri: "",
    image_uris: "{}",
    prices: "{}",
  };
}

function sleepMs(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/** Scryfall /cards/collection allows max 75 identifiers; rate ~2/sec. */
var SCRYFALL_COLLECTION_CHUNK = 75;
/** Per-request wall-clock cap so the Worker does not hang on slow Scryfall responses. */
var SCRYFALL_NAMED_TIMEOUT_MS = 12000;
/** Parallel fuzzy lookups after collection (named endpoint allows ~10/sec). */
var SCRYFALL_FUZZY_CONCURRENCY = 6;

async function fetchCardFromScryfallFuzzyWithTimeout(name, timeoutMs) {
  var ctrl = new AbortController();
  var tid = setTimeout(function () {
    ctrl.abort();
  }, timeoutMs);
  try {
    var u = new URL("https://api.scryfall.com/cards/named");
    u.searchParams.set("fuzzy", name);
    var r = await fetch(u.toString(), {
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "CubeWizard-Worker/1.0",
      },
    });
    if (r.status === 404) return null;
    if (!r.ok) {
      return null;
    }
    return r.json();
  } catch (e) {
    if (e && e.name === "AbortError") {
      console.error("Scryfall named timeout for:", name);
    } else {
      console.error("Scryfall named error for " + name + ":", e);
    }
    return null;
  } finally {
    clearTimeout(tid);
  }
}

function buildScryfallNamePool(dataArr) {
  var pool = {};
  for (var i = 0; i < dataArr.length; i++) {
    var c = dataArr[i];
    if (!c || !c.name) continue;
    var k = String(c.name).toLowerCase();
    if (!pool[k]) pool[k] = [];
    pool[k].push(c);
  }
  return pool;
}

function takeCardFromNamePool(pool, reqName) {
  var k = String(reqName).toLowerCase();
  if (!pool[k] || pool[k].length === 0) return null;
  return pool[k].shift();
}

async function scryfallPostCollection(identifiers) {
  var r = await fetch("https://api.scryfall.com/cards/collection", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "CubeWizard-Worker/1.0",
    },
    body: JSON.stringify({ identifiers: identifiers }),
  });
  if (!r.ok) {
    var errText = await r.text();
    throw new Error("collection " + r.status + ": " + errText.slice(0, 160));
  }
  return r.json();
}

/**
 * Resolve card rows: batched POST /cards/collection (exact name match), then
 * parallel fuzzy /cards/named for anything the batch did not return.
 */
async function resolveDeckCardRowsFromNames(trimmed) {
  var foundRows = new Array(trimmed.length);
  var fuzzyQueue = [];

  for (var start = 0; start < trimmed.length; start += SCRYFALL_COLLECTION_CHUNK) {
    if (start > 0) {
      await sleepMs(550);
    }
    var chunk = trimmed.slice(start, start + SCRYFALL_COLLECTION_CHUNK);
    var identifiers = chunk.map(function (n) {
      return { name: n };
    });
    var json;
    try {
      json = await scryfallPostCollection(identifiers);
    } catch (e) {
      console.error("Scryfall collection batch failed:", e);
      for (var ej = 0; ej < chunk.length; ej++) {
        fuzzyQueue.push({ index: start + ej, name: chunk[ej] });
      }
      continue;
    }

    var pool = buildScryfallNamePool(json.data || []);
    for (var i = 0; i < chunk.length; i++) {
      var globalIdx = start + i;
      var reqName = chunk[i];
      var card = takeCardFromNamePool(pool, reqName);
      if (card) {
        foundRows[globalIdx] = scryfallCardToDeckRow(card);
      } else {
        fuzzyQueue.push({ index: globalIdx, name: reqName });
      }
    }
  }

  for (var b = 0; b < fuzzyQueue.length; b += SCRYFALL_FUZZY_CONCURRENCY) {
    var slice = fuzzyQueue.slice(b, b + SCRYFALL_FUZZY_CONCURRENCY);
    await Promise.all(
      slice.map(function (q) {
        return fetchCardFromScryfallFuzzyWithTimeout(q.name, SCRYFALL_NAMED_TIMEOUT_MS).then(function (card) {
          if (card) {
            foundRows[q.index] = scryfallCardToDeckRow(card);
          }
        });
      })
    );
  }

  var notFoundNames = [];
  var outRows = [];
  for (var ri = 0; ri < trimmed.length; ri++) {
    var row = foundRows[ri];
    if (row && row.scryfall_uri) {
      outRows.push(row);
    } else {
      outRows.push(stubDeckRowForName(trimmed[ri]));
      notFoundNames.push(trimmed[ri]);
    }
  }

  return { rows: outRows, notFoundNames: notFoundNames };
}

async function handlePutDeckCards(deckIdStr, request, env) {
  var deckId = parseInt(String(deckIdStr), 10);
  if (!isFinite(deckId)) {
    return jsonResponse({ error: "Invalid deck id" }, 400);
  }

  var deck = await env.cubewizard_db
    .prepare("SELECT deck_id FROM decks WHERE deck_id = ?")
    .bind(deckId)
    .first();
  if (!deck) {
    return jsonResponse({ error: "Deck not found" }, 404);
  }

  var body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  var names = body.names;
  if (!Array.isArray(names)) {
    return jsonResponse({ error: "Request body must include names: string[]" }, 400);
  }

  var trimmed = [];
  for (var ni = 0; ni < names.length; ni++) {
    var n = String(names[ni] == null ? "" : names[ni]).trim();
    if (n.length > 0) trimmed.push(n);
  }
  if (trimmed.length === 0) {
    return jsonResponse({ error: "At least one card name is required" }, 400);
  }

  var resolved;
  try {
    resolved = await resolveDeckCardRowsFromNames(trimmed);
  } catch (e) {
    console.error("resolveDeckCardRowsFromNames:", e);
    return jsonResponse({ error: "Scryfall lookup failed. Try again with fewer cards or shorter names." }, 502);
  }

  var foundRows = resolved.rows;
  var notFoundNames = resolved.notFoundNames;

  await env.cubewizard_db.prepare("DELETE FROM deck_cards WHERE deck_id = ?").bind(deckId).run();

  for (var ri = 0; ri < foundRows.length; ri++) {
    var row = foundRows[ri];
    await env.cubewizard_db
      .prepare(
        "INSERT INTO deck_cards (deck_id, name, mana_cost, cmc, type_line, colors, color_identity, " +
          "rarity, set_code, set_name, collector_number, power, toughness, oracle_text, scryfall_uri, image_uris, prices) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        deckId,
        row.name,
        row.mana_cost,
        row.cmc,
        row.type_line,
        row.colors,
        row.color_identity,
        row.rarity,
        row.set_code,
        row.set_name,
        row.collector_number,
        row.power,
        row.toughness,
        row.oracle_text,
        row.scryfall_uri,
        row.image_uris,
        row.prices
      )
      .run();
  }

  var totalFound = trimmed.length - notFoundNames.length;
  var notesObj = {
    total_requested: trimmed.length,
    total_found: totalFound,
    total_not_found: notFoundNames.length,
    not_found: notFoundNames,
    success_rate: trimmed.length ? totalFound / trimmed.length : 0,
    edited_via: "deck_view",
  };
  var notesStr = JSON.stringify(notesObj);

  var statRow = await env.cubewizard_db
    .prepare("SELECT deck_id FROM deck_stats WHERE deck_id = ?")
    .bind(deckId)
    .first();
  if (statRow) {
    await env.cubewizard_db
      .prepare(
        "UPDATE deck_stats SET total_found = ?, total_not_found = ?, processing_notes = ? WHERE deck_id = ?"
      )
      .bind(totalFound, notFoundNames.length, notesStr, deckId)
      .run();
  } else {
    await env.cubewizard_db
      .prepare(
        "INSERT INTO deck_stats (deck_id, total_found, total_not_found, processing_notes) VALUES (?, ?, ?, ?)"
      )
      .bind(deckId, totalFound, notFoundNames.length, notesStr)
      .run();
  }

  await env.cubewizard_db
    .prepare("UPDATE decks SET total_cards = ? WHERE deck_id = ?")
    .bind(trimmed.length, deckId)
    .run();

  return jsonResponse({
    success: true,
    total_cards: trimmed.length,
    not_found: notFoundNames,
  });
}

// ============================================================
//  Analytics computation - mirrors dashboard.py exactly
// ============================================================

function computeCardPerformance(decks, cardsByDeck) {
  var allDeckWinRates = [];
  for (var i = 0; i < decks.length; i++) {
    allDeckWinRates.push(decks[i].win_rate);
  }
  var cubeAvgWinRate = mean(allDeckWinRates);

  var cardStats = {};

  for (var di = 0; di < decks.length; di++) {
    var deck = decks[di];
    var cards = cardsByDeck[deck.deck_id] || [];
    for (var ci = 0; ci < cards.length; ci++) {
      var name = cards[ci].name;
      if (!cardStats[name]) {
        cardStats[name] = { wins: 0, losses: 0, appearances: 0, deck_win_rates: [] };
      }
      cardStats[name].wins += deck.match_wins;
      cardStats[name].losses += deck.match_losses;
      cardStats[name].appearances += 1;
      cardStats[name].deck_win_rates.push(deck.win_rate);
    }
  }

  var performances = [];
  var names = Object.keys(cardStats);
  for (var ni = 0; ni < names.length; ni++) {
    var cardName = names[ni];
    var stats = cardStats[cardName];
    var totalGames = stats.wins + stats.losses;
    if (totalGames > 0) {
      var smoothed = stats.deck_win_rates.slice();
      for (var si = 0; si < BAYESIAN_SMOOTHING_STRENGTH; si++) {
        smoothed.push(cubeAvgWinRate);
      }

      var avgDeckWinRate = mean(smoothed);
      var performanceDelta = avgDeckWinRate - cubeAvgWinRate;

      performances.push({
        name: cardName,
        appearances: stats.appearances,
        wins: stats.wins,
        losses: stats.losses,
        win_rate: round3(avgDeckWinRate),
        performance_delta: round3(performanceDelta),
      });
    }
  }

  performances.sort(function(a, b) {
    if (b.performance_delta !== a.performance_delta) {
      return b.performance_delta - a.performance_delta;
    }
    return b.appearances - a.appearances;
  });

  return performances;
}

function computeSynergies(decks, cardsByDeck) {
  var cardPairs = {};
  var individual = {};

  for (var di = 0; di < decks.length; di++) {
    var deck = decks[di];
    var cards = cardsByDeck[deck.deck_id] || [];
    var cardNames = [];
    for (var ci = 0; ci < cards.length; ci++) {
      cardNames.push(cards[ci].name);
    }
    var wins = deck.match_wins;
    var losses = deck.match_losses;

    for (var ii = 0; ii < cardNames.length; ii++) {
      var name = cardNames[ii];
      if (!individual[name]) {
        individual[name] = { wins: 0, losses: 0, appearances: 0 };
      }
      individual[name].wins += wins;
      individual[name].losses += losses;
      individual[name].appearances += 1;
    }

    for (var pi = 0; pi < cardNames.length; pi++) {
      for (var pj = pi + 1; pj < cardNames.length; pj++) {
        var c1 = cardNames[pi];
        var c2 = cardNames[pj];
        if (c1 === c2) continue;

        var pair = c1 < c2 ? c1 + "\0" + c2 : c2 + "\0" + c1;
        if (!cardPairs[pair]) {
          cardPairs[pair] = { together_wins: 0, together_losses: 0, together_count: 0 };
        }
        cardPairs[pair].together_wins += wins;
        cardPairs[pair].together_losses += losses;
        cardPairs[pair].together_count += 1;
      }
    }
  }

  var synergies = [];
  var pairKeys = Object.keys(cardPairs);
  for (var ki = 0; ki < pairKeys.length; ki++) {
    var pairKey = pairKeys[ki];
    var ps = cardPairs[pairKey];
    if (ps.together_count < SYNERGY_MIN_APPEARANCES) continue;

    var togetherTotal = ps.together_wins + ps.together_losses;
    if (togetherTotal === 0) continue;
    var togetherWinRate = ps.together_wins / togetherTotal;

    var parts = pairKey.split("\0");
    var sc1 = parts[0];
    var sc2 = parts[1];
    var c1Stats = individual[sc1];
    var c2Stats = individual[sc2];

    var c1Total = c1Stats.wins + c1Stats.losses;
    var c2Total = c2Stats.wins + c2Stats.losses;

    if (c1Total > 0 && c2Total > 0) {
      var c1WinRate = c1Stats.wins / c1Total;
      var c2WinRate = c2Stats.wins / c2Total;
      var separateWinRate = (c1WinRate + c2WinRate) / 2;
      var synergyBonus = togetherWinRate - separateWinRate;

      synergies.push({
        card1: sc1,
        card2: sc2,
        together_win_rate: round3(togetherWinRate),
        synergy_bonus: round3(synergyBonus),
        together_wins: ps.together_wins,
        together_losses: ps.together_losses,
      });
    }
  }

  synergies.sort(function(a, b) { return b.synergy_bonus - a.synergy_bonus; });
  return synergies.slice(0, 20);
}

function computeColorPerformance(decks, cardsByDeck) {
  var COLOR_MAP = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
  var decksByColor = { White: [], Blue: [], Black: [], Red: [], Green: [] };

  var totalWins = 0;
  var totalLosses = 0;

  for (var di = 0; di < decks.length; di++) {
    var deck = decks[di];
    var dWins = deck.match_wins;
    var dLosses = deck.match_losses;
    var total = dWins + dLosses;
    totalWins += dWins;
    totalLosses += dLosses;

    if (total === 0) continue;

    var deckColors = {};
    var cards = cardsByDeck[deck.deck_id] || [];
    for (var ci = 0; ci < cards.length; ci++) {
      var colorsRaw = cards[ci].colors;
      if (colorsRaw) {
        try {
          var colorsList = JSON.parse(colorsRaw);
          if (Array.isArray(colorsList)) {
            for (var cli = 0; cli < colorsList.length; cli++) {
              var sym = colorsList[cli];
              if (COLOR_MAP[sym]) {
                deckColors[COLOR_MAP[sym]] = true;
              }
            }
          }
        } catch (e) { /* ignore */ }
      }
    }

    var record = { wins: dWins, losses: dLosses, total_games: total, win_rate: dWins / total };
    var colorKeys = Object.keys(deckColors);
    for (var cki = 0; cki < colorKeys.length; cki++) {
      decksByColor[colorKeys[cki]].push(record);
    }
  }

  var totalGames = totalWins + totalLosses;
  var overallWinRate = totalGames > 0 ? totalWins / totalGames : 0;

  var colorStats = [];
  var totalDecksCount = decks.length;
  var colorOrder = ["White", "Blue", "Black", "Red", "Green"];

  for (var oi = 0; oi < colorOrder.length; oi++) {
    var colorName = colorOrder[oi];
    var dl = decksByColor[colorName];
    if (dl.length > 0) {
      var colorWins = 0;
      var colorGames = 0;
      for (var dli = 0; dli < dl.length; dli++) {
        colorWins += dl[dli].wins;
        colorGames += dl[dli].total_games;
      }
      var colorWinRate = colorGames > 0 ? colorWins / colorGames : 0;

      colorStats.push({
        color: colorName,
        win_rate: round3(colorWinRate),
        performance_delta: round3(colorWinRate - overallWinRate),
        total_games: colorGames,
        wins: colorWins,
        losses: colorGames - colorWins,
        deck_percentage: round3(dl.length / totalDecksCount),
      });
    } else {
      colorStats.push({
        color: colorName,
        win_rate: 0,
        performance_delta: 0,
        total_games: 0,
        wins: 0,
        losses: 0,
        deck_percentage: 0,
      });
    }
  }

  return colorStats;
}

// ============================================================
//  Chart builders (Plotly JSON)
// ============================================================

function performanceScatterKey(p) {
  return String(p.appearances) + "\t" + String(p.performance_delta);
}

function buildPerformanceScatterChart(performances) {
  var groups = {};
  for (var i = 0; i < performances.length; i++) {
    var k = performanceScatterKey(performances[i]);
    if (!groups[k]) groups[k] = [];
    groups[k].push(i);
  }

  var x = [];
  var y = [];
  var customdata = [];
  var colors = [];

  var keys = Object.keys(groups);
  for (var gi = 0; gi < keys.length; gi++) {
    var indices = groups[keys[gi]].slice();
    indices.sort(function (a, b) {
      return performances[a].name.localeCompare(performances[b].name);
    });
    var names = [];
    for (var j = 0; j < indices.length; j++) {
      names.push(performances[indices[j]].name);
    }
    var p = performances[indices[0]];
    var cx = p.appearances;
    var cy = p.performance_delta;
    x.push(cx);
    y.push(cy);
    customdata.push([cx, cy, names.join("<br>")]);
    colors.push(cy >= 0 ? "rgba(40,167,69,0.7)" : "rgba(220,53,69,0.7)");
  }

  return {
    data: [
      {
        x: x,
        y: y,
        customdata: customdata,
        mode: "markers",
        type: "scatter",
        marker: { size: 8, color: colors },
        hovertemplate:
          "%{customdata[2]}<br><br>Appearances: %{customdata[0]}<br>Delta: %{customdata[1]:.1%}<extra></extra>",
      },
    ],
    layout: {
      title: "Card Performance vs Popularity",
      xaxis: { title: "Appearances in Decks" },
      yaxis: { title: "Performance Delta (%)", tickformat: ".0%" },
      hovermode: "closest",
      showlegend: false,
      shapes: [
        {
          type: "line",
          x0: 0, x1: 1, xref: "paper",
          y0: 0, y1: 0,
          line: { color: "gray", width: 1, dash: "dash" },
        },
      ],
      margin: { t: 40, b: 40, l: 60, r: 20 },
    },
  };
}

function buildColorBarChart(colorStats) {
  var clrs = [];
  var perfDeltas = [];
  var barColors = [];
  var borderColors = [];
  var customData = [];
  var textLabels = [];
  var colorHex = { White: "#FFFBD5", Blue: "#0E68AB", Black: "#150B00", Red: "#D3202A", Green: "#00733E" };
  var borderHex = { White: "#D5C5A1", Blue: "#0E68AB", Black: "#150B00", Red: "#D3202A", Green: "#00733E" };

  for (var i = 0; i < colorStats.length; i++) {
    var c = colorStats[i];
    clrs.push(c.color);
    perfDeltas.push(c.performance_delta);
    barColors.push(colorHex[c.color] || "#667eea");
    borderColors.push(borderHex[c.color] || "#333");
    customData.push([c.win_rate, c.deck_percentage * 100]);
    var sign = c.performance_delta >= 0 ? "+" : "";
    textLabels.push(sign + (c.performance_delta * 100).toFixed(1) + "%");
  }

  return {
    data: [
      {
        x: clrs,
        y: perfDeltas,
        type: "bar",
        text: textLabels,
        textposition: "auto",
        customdata: customData,
        marker: { color: barColors, line: { color: borderColors, width: 1 } },
        hovertemplate: "<b>%{x}</b><br>Performance Delta: %{y:+.1%}<br>Win Rate: %{customdata[0]:.1%}<br>Deck Usage: %{customdata[1]:.1f}%<extra></extra>",
      },
    ],
    layout: {
      title: "Color Performance Analysis",
      xaxis: { title: "Magic Colors" },
      yaxis: { title: "Performance Delta", tickformat: "+.1%" },
      showlegend: false,
      shapes: [
        {
          type: "line",
          x0: 0, x1: 1, xref: "paper",
          y0: 0, y1: 0,
          line: { color: "gray", width: 1, dash: "dash" },
        },
      ],
      margin: { t: 40, b: 40, l: 60, r: 20 },
    },
  };
}

// ============================================================
//  Existing handlers (unchanged)
// ============================================================

/**
 * Verify a Cloudflare Turnstile token server-side.
 * Returns true if valid, false otherwise.
 */
async function verifyTurnstile(token, ip, env) {
  if (!token) return false;
  var secret = env.TURNSTILE_SECRET;
  if (!secret) {
    console.error("TURNSTILE_SECRET is not configured");
    return false;
  }

  try {
    var resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: secret,
        response: token,
        remoteip: ip || "",
      }),
    });
    var result = await resp.json();
    return result.success === true;
  } catch (err) {
    console.error("Turnstile verification error:", err);
    return false;
  }
}

async function handleUpload(request, env) {
  try {
    var formData = await request.formData();

    // Verify Turnstile token
    var turnstileToken = formData.get("cf-turnstile-response");
    var clientIp = request.headers.get("CF-Connecting-IP");
    if (!await verifyTurnstile(turnstileToken, clientIp, env)) {
      return jsonResponse(
        { success: false, errors: ["Bot verification failed. Please try again."] },
        403
      );
    }

    var cubeId = formData.get("cube_id")?.trim();
    var pilotName = formData.get("pilot_name")?.trim();
    var winsRaw = formData.get("wins");
    var lossesRaw = formData.get("losses");
    var drawsRaw = formData.get("draws") || "0";
    var imageFile = formData.get("image");

    var errors = [];
    if (!cubeId) errors.push("cube_id is required");
    if (!pilotName) errors.push("pilot_name is required");
    if (winsRaw === null || winsRaw === "") errors.push("wins is required");
    if (lossesRaw === null || lossesRaw === "") errors.push("losses is required");
    if (!imageFile || !(imageFile instanceof File) || imageFile.size === 0) {
      errors.push("image file is required");
    }

    if (errors.length > 0) {
      return jsonResponse({ success: false, errors: errors }, 400);
    }

    var wins = parseInt(winsRaw, 10);
    var losses = parseInt(lossesRaw, 10);
    var draws = parseInt(drawsRaw, 10);

    if (isNaN(wins) || wins < 0) errors.push("wins must be a non-negative integer");
    if (isNaN(losses) || losses < 0) errors.push("losses must be a non-negative integer");
    if (isNaN(draws) || draws < 0) errors.push("draws must be a non-negative integer");

    if (errors.length > 0) {
      return jsonResponse({ success: false, errors: errors }, 400);
    }

    var allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    if (allowedTypes.indexOf(imageFile.type) === -1) {
      return jsonResponse(
        { success: false, errors: ["Invalid image type: " + imageFile.type + ". Allowed: JPEG, PNG, WebP, HEIC"] },
        400
      );
    }

    var MAX_SIZE = 20 * 1024 * 1024;
    if (imageFile.size > MAX_SIZE) {
      return jsonResponse(
        { success: false, errors: ["Image file must be under 20 MB"] },
        400
      );
    }

    var now = new Date();
    var timestamp = now.toISOString().replace(/[:.]/g, "-");
    var safePilot = pilotName.replace(/[^a-zA-Z0-9_\- ]/g, "");
    var prefix = cubeId + "/" + timestamp + "_" + safePilot;

    var extMap = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/heic": "heic",
      "image/heif": "heif",
    };
    var ext = extMap[imageFile.type] || "jpg";

    var imageKey = prefix + "/image." + ext;
    await env.BUCKET.put(imageKey, imageFile.stream(), {
      httpMetadata: { contentType: imageFile.type },
      customMetadata: { pilotName: pilotName, cubeId: cubeId },
    });

    var winRate = (wins + losses) > 0 ? wins / (wins + losses) : 0;
    var metadata = {
      cube_id: cubeId,
      pilot_name: pilotName,
      match_wins: wins,
      match_losses: losses,
      match_draws: draws,
      win_rate: winRate,
      record_logged: now.toISOString(),
      image_key: imageKey,
      original_filename: imageFile.name,
    };

    var metadataKey = prefix + "/metadata.json";
    await env.BUCKET.put(metadataKey, JSON.stringify(metadata, null, 2), {
      httpMetadata: { contentType: "application/json" },
    });

    return jsonResponse({
      success: true,
      message: "Deck uploaded successfully!",
      key: prefix,
    });
  } catch (err) {
    console.error("Upload error:", err);
    return jsonResponse(
      { success: false, errors: ["Internal server error. Please try again."] },
      500
    );
  }
}

async function handleValidateCube(url, env) {
  var cubeId = url.searchParams.get("cube_id")?.trim();
  if (!cubeId) {
    return jsonResponse({ valid: false, error: "cube_id parameter is required" }, 400);
  }

  try {
    var apiUrl = "https://cubecobra.com/cube/api/cubeJSON/" + encodeURIComponent(cubeId);
    var resp = await fetch(apiUrl, {
      headers: { "User-Agent": "CubeWizard/1.0" },
    });

    if (!resp.ok) {
      return jsonResponse({ valid: false, error: "Cube not found on CubeCobra." });
    }

    var data = await resp.json();
    var name = data.name || cubeId;
    var cardCount = 0;
    if (data.cards && Array.isArray(data.cards.mainboard)) {
      cardCount = data.cards.mainboard.length;
    }

    return jsonResponse({ valid: true, name: name, card_count: cardCount });
  } catch (err) {
    console.error("CubeCobra validation error:", err);
    return jsonResponse({ valid: false, error: "Failed to reach CubeCobra. Try again later." }, 502);
  }
}

async function handleAddCube(request, env) {
  try {
    var body = await request.json();

    // Verify Turnstile token
    var turnstileToken = body["cf-turnstile-response"];
    var clientIp = request.headers.get("CF-Connecting-IP");
    if (!await verifyTurnstile(turnstileToken, clientIp, env)) {
      return jsonResponse(
        { success: false, errors: ["Bot verification failed. Please try again."] },
        403
      );
    }

    var cubeId = body.cube_id?.trim();
    var cubeName = body.cube_name?.trim();
    var description = body.description?.trim() || "";

    var errors = [];
    if (!cubeId) errors.push("cube_id is required");
    if (!cubeName) errors.push("cube_name is required");
    if (errors.length > 0) {
      return jsonResponse({ success: false, errors: errors }, 400);
    }

    // Check if cube already exists in D1
    var existing = await env.cubewizard_db.prepare(
      "SELECT cube_id FROM cubes WHERE cube_id = ?"
    ).bind(cubeId).first();

    if (existing) {
      return jsonResponse({ success: false, errors: ["Cube '" + cubeId + "' already exists."] }, 409);
    }

    // Insert into D1 — both cubes and cube_mapping tables
    var now = new Date().toISOString();

    await env.cubewizard_db.batch([
      env.cubewizard_db.prepare(
        "INSERT INTO cubes (cube_id, created, last_updated, total_decks) VALUES (?, ?, ?, 0)"
      ).bind(cubeId, now, now),
      env.cubewizard_db.prepare(
        "INSERT INTO cube_mapping (cube_id, cube_name, description) VALUES (?, ?, ?)"
      ).bind(cubeId, cubeName, description),
    ]);

    // Also write to R2 as an audit trail
    var key = "_cube_requests/" + now.replace(/[:.]/g, "-") + "_" + cubeId + ".json";
    var payload = {
      cube_id: cubeId,
      cube_name: cubeName,
      description: description,
      requested_at: now,
    };

    await env.BUCKET.put(key, JSON.stringify(payload, null, 2), {
      httpMetadata: { contentType: "application/json" },
    });

    return jsonResponse({
      success: true,
      message: "Cube added successfully! It should now appear in the cube selector.",
    });
  } catch (err) {
    console.error("Add cube error:", err);
    return jsonResponse(
      { success: false, errors: ["Internal server error. Please try again."] },
      500
    );
  }
}

// ============================================================
//  Utilities
// ============================================================

function mean(arr) {
  if (arr.length === 0) return 0;
  var sum = 0;
  for (var i = 0; i < arr.length; i++) {
    sum += arr[i];
  }
  return sum / arr.length;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function jsonResponse(body, status) {
  if (status === undefined) status = 200;
  return new Response(JSON.stringify(body), {
    status: status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
