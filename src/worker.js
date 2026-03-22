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

    return env.ASSETS.fetch(request);
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

  var cardPerformances = computeCardPerformance(decks, cardsByDeck);
  var synergies = computeSynergies(decks, cardsByDeck);
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
        total_games: colorGames,
        wins: colorWins,
        losses: colorGames - colorWins,
        avg_cards_per_deck: round1((dl.length / totalDecksCount) * 100),
      });
    } else {
      colorStats.push({
        color: colorName,
        win_rate: 0,
        total_games: 0,
        wins: 0,
        losses: 0,
        avg_cards_per_deck: 0,
      });
    }
  }

  return colorStats;
}

// ============================================================
//  Chart builders (Plotly JSON)
// ============================================================

function buildPerformanceScatterChart(performances) {
  var x = [];
  var y = [];
  var text = [];
  var colors = [];
  for (var i = 0; i < performances.length; i++) {
    x.push(performances[i].appearances);
    y.push(performances[i].performance_delta);
    text.push(performances[i].name);
    colors.push(performances[i].performance_delta >= 0 ? "rgba(40,167,69,0.7)" : "rgba(220,53,69,0.7)");
  }

  return {
    data: [
      {
        x: x, y: y, text: text,
        mode: "markers",
        type: "scatter",
        marker: { size: 8, color: colors },
        hovertemplate: "%{text}<br>Appearances: %{x}<br>Delta: %{y:.1%}<extra></extra>",
      },
    ],
    layout: {
      title: "Card Performance vs Popularity",
      xaxis: { title: "Appearances in Decks" },
      yaxis: { title: "Performance Delta (%)", tickformat: ".0%" },
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
  var winRates = [];
  var barColors = [];
  var borderColors = [];
  var colorHex = { White: "#F9FAF4", Blue: "#0E68AB", Black: "#150B00", Red: "#D3202A", Green: "#00733E" };
  var borderHex = { White: "#D5C5A1", Blue: "#0E68AB", Black: "#150B00", Red: "#D3202A", Green: "#00733E" };

  for (var i = 0; i < colorStats.length; i++) {
    var c = colorStats[i];
    clrs.push(c.color);
    winRates.push(c.win_rate);
    barColors.push(colorHex[c.color] || "#667eea");
    borderColors.push(borderHex[c.color] || "#333");
  }

  return {
    data: [
      {
        x: clrs,
        y: winRates,
        type: "bar",
        marker: { color: barColors, line: { color: borderColors, width: 1 } },
        hovertemplate: "%{x}<br>Win Rate: %{y:.1%}<extra></extra>",
      },
    ],
    layout: {
      title: "Win Rate by Color",
      yaxis: { title: "Win Rate", tickformat: ".0%" },
      showlegend: false,
      margin: { t: 40, b: 40, l: 60, r: 20 },
    },
  };
}

// ============================================================
//  Existing handlers (unchanged)
// ============================================================

async function handleUpload(request, env) {
  try {
    var formData = await request.formData();

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

    var MAX_SIZE = 10 * 1024 * 1024;
    if (imageFile.size > MAX_SIZE) {
      return jsonResponse(
        { success: false, errors: ["Image file must be under 10 MB"] },
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

    var cubeId = body.cube_id?.trim();
    var cubeName = body.cube_name?.trim();
    var description = body.description?.trim() || "";

    var errors = [];
    if (!cubeId) errors.push("cube_id is required");
    if (!cubeName) errors.push("cube_name is required");
    if (errors.length > 0) {
      return jsonResponse({ success: false, errors: errors }, 400);
    }

    var now = new Date();
    var key = "_cube_requests/" + now.toISOString().replace(/[:.]/g, "-") + "_" + cubeId + ".json";
    var payload = {
      cube_id: cubeId,
      cube_name: cubeName,
      description: description,
      requested_at: now.toISOString(),
    };

    await env.BUCKET.put(key, JSON.stringify(payload, null, 2), {
      httpMetadata: { contentType: "application/json" },
    });

    return jsonResponse({
      success: true,
      message: "Cube registered! It will appear in the dropdown once the next data sync runs.",
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
