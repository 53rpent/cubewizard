/**
 * Shared boot for cube data pages (cards, colors, synergies).
 * Depends: cw-paths.js, Plotly (when chartType set), card-tooltip (CW.cardNameHtml).
 */
(function (global) {
  var DATA_PAGE_INFO = {
    cards: {
      title: "Card data",
      description:
        'This analysis shows how individual cards perform relative to the cube average. Cards with positive deltas consistently appear in winning decks more often than losing ones, while negative deltas indicate cards that may be underperforming or that their archetype may be weaker. The "Performance Delta" represents how far above or below the cube average each card performs.',
      chartType: "performance_scatter",
    },
    colors: {
      title: "Color data",
      description:
        "This analysis examines how decks of each color perform. A deck is defined as being a certain color if it contains at least one card with that color in it. The color bar chart shows the overall win rate for decks containing each color. Sort any column in the table below to explore.",
      chartType: "color_performance",
    },
    synergies: {
      title: "Synergy data",
      description:
        'This analysis identifies pairs of cards that perform better together than they do individually. The "Synergy Bonus" shows how much the combined win rate exceeds the average of their individual performances. Positive synergy bonuses indicate natural card combinations that fit well together, while negative bonuses may suggest conflicting strategies. Sort columns to explore the list (default: most decks containing both cards).',
      chartType: null,
    },
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function replaceCanonicalUrl(cubeId, dataView) {
    if (!window.CWPaths || !cubeId || !dataView) return;
    try {
      var can = CWPaths.mergeCurrentPathPrefixWith(CWPaths.dataPath(cubeId, dataView));
      history.replaceState({}, "", can);
    } catch (e) {}
  }

  /** Client-side canonicalization when the worker has not yet redirected legacy URLs. */
  function maybeCanonicalizeLegacyPath() {
    try {
      var p = window.location.pathname;
      if (!/\/analysis\/(performance|color|synergies)/i.test(p)) return;
      var loc = window.CWPaths ? CWPaths.parsePathname(p) : {};
      if (!loc.cubeId || !loc.dataView) return;
      history.replaceState(
        {},
        "",
        CWPaths.mergeCurrentPathPrefixWith(CWPaths.dataPath(loc.cubeId, loc.dataView))
      );
    } catch (e2) {}
  }

  function updateHeaderSubtitle(dataView) {
    var sub = document.querySelector(".header-subtitle");
    if (!sub) return;
    var labels = { cards: "Card data", colors: "Color data", synergies: "Synergy data" };
    sub.textContent = labels[dataView] || "Data";
  }

  var dashboardData = null;
  var searchDebounceMs = 150;
  var searchTimer = null;
  var perfSnapshot = null;
  var perfSort = { key: "performance_delta", asc: false };
  var synergySnapshot = null;
  var synergySort = { key: "together_count", asc: false };
  var colorIdentitySnapshot = null;
  /** @type {{ key: string|null, asc: boolean }} null key = preserve API row order */
  var colorIdentitySort = { key: null, asc: true };
  /** @type {string|null} Canonical card name from synergy rows when filter active */
  var synergyFilterName = null;
  var synergyFilterTimer = null;
  var stateDataView = "cards";

  function clearCardSearch() {
    var si = $("analysis-search-input");
    if (si) si.value = "";
    var res = $("analysis-card-search-results");
    if (res) res.innerHTML = "";
    hideSearchSuggestions();
  }

  function hideSearchSuggestions() {
    var ul = $("analysis-card-search-suggestions");
    var inp = $("analysis-search-input");
    if (ul) {
      ul.innerHTML = "";
      ul.classList.remove("is-open");
      ul.hidden = true;
    }
    if (inp) inp.setAttribute("aria-expanded", "false");
  }

  function getSearchSuggestions(query) {
    if (!dashboardData || !dashboardData.card_performances) return [];
    var ql = query.trim().toLowerCase();
    if (!ql) return [];
    var perf = dashboardData.card_performances;
    var starts = [];
    var rest = [];
    var j;
    for (j = 0; j < perf.length; j++) {
      var n = perf[j].name;
      var nl = n.toLowerCase();
      if (nl.indexOf(ql) === -1) continue;
      if (nl.indexOf(ql) === 0) starts.push(perf[j]);
      else rest.push(perf[j]);
    }
    starts.sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
    rest.sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
    return starts.concat(rest).slice(0, 12);
  }

  function renderSuggestionList(cards) {
    var ul = $("analysis-card-search-suggestions");
    var inp = $("analysis-search-input");
    if (!ul || !inp) return;
    ul.innerHTML = "";
    if (!cards.length) {
      hideSearchSuggestions();
      return;
    }
    var idx;
    for (idx = 0; idx < cards.length; idx++) {
      (function (card) {
        var li = document.createElement("li");
        li.setAttribute("role", "none");
        var btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("role", "option");
        btn.textContent = card.name;
        btn.addEventListener("mousedown", function (ev) {
          ev.preventDefault();
          selectSearchSuggestion(card);
        });
        li.appendChild(btn);
        ul.appendChild(li);
      })(cards[idx]);
    }
    ul.classList.add("is-open");
    ul.hidden = false;
    inp.setAttribute("aria-expanded", "true");
  }

  function scheduleSearchSuggestions() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      searchTimer = null;
      updateSearchSuggestions();
    }, searchDebounceMs);
  }

  function updateSearchSuggestions() {
    var inp = $("analysis-search-input");
    var resultsContainer = $("analysis-card-search-results");
    if (!inp) return;
    var q = inp.value;
    if (resultsContainer) resultsContainer.innerHTML = "";
    if (!q.trim()) {
      hideSearchSuggestions();
      return;
    }
    if (!dashboardData || !dashboardData.card_performances) {
      hideSearchSuggestions();
      return;
    }
    renderSuggestionList(getSearchSuggestions(q));
  }

  function selectSearchSuggestion(card) {
    var inp = $("analysis-search-input");
    if (inp) inp.value = card.name;
    hideSearchSuggestions();
    renderCardSearchStats(card);
  }

  function findClosestCardMatch(query) {
    var q = query.trim().toLowerCase();
    if (!q || !dashboardData || !dashboardData.card_performances) return null;
    var arr = dashboardData.card_performances;
    var i;
    var nl;
    for (i = 0; i < arr.length; i++) {
      if (arr[i].name.toLowerCase() === q) return arr[i];
    }
    for (i = 0; i < arr.length; i++) {
      nl = arr[i].name.toLowerCase();
      if (nl.indexOf(q) === 0) return arr[i];
    }
    for (i = 0; i < arr.length; i++) {
      nl = arr[i].name.toLowerCase();
      if (nl.indexOf(q) !== -1) return arr[i];
    }
    return null;
  }

  function commitCardSearch() {
    var searchInput = $("analysis-search-input");
    var resultsContainer = $("analysis-card-search-results");
    if (!searchInput || !resultsContainer) return;
    hideSearchSuggestions();
    var searchTerm = searchInput.value.trim();
    if (!searchTerm) {
      resultsContainer.innerHTML = "";
      return;
    }
    if (!dashboardData || !dashboardData.card_performances) {
      resultsContainer.innerHTML = '<div class="search-error">Load card data first.</div>';
      return;
    }
    var card = findClosestCardMatch(searchTerm);
    if (!card) {
      resultsContainer.innerHTML =
        '<div class="search-error">No matching card found. Try a different name or choose a suggestion from the list.</div>';
      return;
    }
    renderCardSearchStats(card);
  }

  function renderCardSearchStats(card) {
    var resultsContainer = $("analysis-card-search-results");
    if (!resultsContainer) return;
    var winRate = (card.win_rate * 100).toFixed(1);
    var totalGames = card.wins + card.losses;
    var deltaSign = card.performance_delta > 0 ? "+" : "";
    resultsContainer.innerHTML =
      '<div class="card-result">' +
      '<div class="card-name">' +
      CW.cardNameHtml(card.name, card.image_url) +
      "</div>" +
      '<div class="card-search-stat-grid">' +
      '<div class="stat-row"><span>Win rate</span><strong>' +
      winRate +
      "%</strong></div>" +
      '<div class="stat-row"><span>Total games</span><strong>' +
      totalGames +
      "</strong></div>" +
      '<div class="stat-row"><span>Wins</span><strong>' +
      card.wins +
      "</strong></div>" +
      '<div class="stat-row"><span>Losses</span><strong>' +
      card.losses +
      "</strong></div>" +
      '<div class="stat-row"><span>Performance delta</span><strong>' +
      deltaSign +
      (card.performance_delta * 100).toFixed(1) +
      "%</strong></div>" +
      '<div class="stat-row"><span>Appearances</span><strong>' +
      card.appearances +
      "</strong></div>" +
      "</div></div>";
  }

  function ensureCardSearchListeners() {
    if (global._cwDataPageCardSearchBound) return;
    global._cwDataPageCardSearchBound = true;

    var searchInput = $("analysis-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", scheduleSearchSuggestions);
      searchInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          if (searchTimer) clearTimeout(searchTimer);
          searchTimer = null;
          commitCardSearch();
        } else if (e.key === "Escape") {
          hideSearchSuggestions();
        }
      });
    }

    var searchBtn = $("analysis-search-button");
    if (searchBtn) {
      searchBtn.addEventListener("click", function () {
        commitCardSearch();
      });
    }

    document.addEventListener("mousedown", function (ev) {
      var wrap = document.querySelector(".analysis-card-search-field-wrap");
      if (wrap && !wrap.contains(ev.target)) hideSearchSuggestions();
    });
  }

  function uniqueSynergyCardNamesOrdered() {
    var seen = {};
    var order = [];
    if (!synergySnapshot || !synergySnapshot.length) return order;
    var i;
    for (i = 0; i < synergySnapshot.length; i++) {
      var c1 = synergySnapshot[i].card1;
      var c2 = synergySnapshot[i].card2;
      if (c1 != null) {
        var k1 = String(c1).toLowerCase();
        if (!seen[k1]) {
          seen[k1] = true;
          order.push(String(c1));
        }
      }
      if (c2 != null) {
        var k2 = String(c2).toLowerCase();
        if (!seen[k2]) {
          seen[k2] = true;
          order.push(String(c2));
        }
      }
    }
    return order;
  }

  function findClosestNameFromList(names, query) {
    var q = query.trim().toLowerCase();
    if (!q || !names.length) return null;
    var i;
    for (i = 0; i < names.length; i++) {
      if (names[i].toLowerCase() === q) return names[i];
    }
    for (i = 0; i < names.length; i++) {
      if (names[i].toLowerCase().indexOf(q) === 0) return names[i];
    }
    for (i = 0; i < names.length; i++) {
      if (names[i].toLowerCase().indexOf(q) !== -1) return names[i];
    }
    return null;
  }

  function getSynergyFilteredRows() {
    if (!synergySnapshot || !synergySnapshot.length) return [];
    if (!synergyFilterName) return synergySnapshot.slice();
    var fl = synergyFilterName.toLowerCase();
    return synergySnapshot.filter(function (s) {
      return String(s.card1).toLowerCase() === fl || String(s.card2).toLowerCase() === fl;
    });
  }

  function hideSynergyFilterSuggestions() {
    var ul = $("synergy-filter-suggestions");
    var inp = $("synergy-filter-input");
    if (ul) {
      ul.innerHTML = "";
      ul.classList.remove("is-open");
      ul.hidden = true;
    }
    if (inp) inp.setAttribute("aria-expanded", "false");
  }

  function getSynergyFilterSuggestions(query) {
    var ql = query.trim().toLowerCase();
    if (!ql) return [];
    var names = uniqueSynergyCardNamesOrdered();
    var starts = [];
    var rest = [];
    var j;
    for (j = 0; j < names.length; j++) {
      var n = names[j];
      var nl = n.toLowerCase();
      if (nl.indexOf(ql) === -1) continue;
      if (nl.indexOf(ql) === 0) starts.push({ name: n });
      else rest.push({ name: n });
    }
    starts.sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
    rest.sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
    return starts.concat(rest).slice(0, 12);
  }

  function renderSynergySuggestionList(cards) {
    var ul = $("synergy-filter-suggestions");
    var inp = $("synergy-filter-input");
    if (!ul || !inp) return;
    ul.innerHTML = "";
    if (!cards.length) {
      hideSynergyFilterSuggestions();
      return;
    }
    var idx;
    for (idx = 0; idx < cards.length; idx++) {
      (function (card) {
        var li = document.createElement("li");
        li.setAttribute("role", "none");
        var btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("role", "option");
        btn.textContent = card.name;
        btn.addEventListener("mousedown", function (ev) {
          ev.preventDefault();
          selectSynergyFilterSuggestion(card);
        });
        li.appendChild(btn);
        ul.appendChild(li);
      })(cards[idx]);
    }
    ul.classList.add("is-open");
    ul.hidden = false;
    inp.setAttribute("aria-expanded", "true");
  }

  function scheduleSynergyFilterSuggestions() {
    if (synergyFilterTimer) clearTimeout(synergyFilterTimer);
    synergyFilterTimer = setTimeout(function () {
      synergyFilterTimer = null;
      updateSynergyFilterSuggestions();
    }, searchDebounceMs);
  }

  function updateSynergyFilterSuggestions() {
    var inp = $("synergy-filter-input");
    var msg = $("synergy-filter-message");
    if (!inp) return;
    var q = inp.value;
    if (msg && !synergyFilterName) msg.innerHTML = "";
    if (!q.trim()) {
      hideSynergyFilterSuggestions();
      return;
    }
    if (!synergySnapshot || !synergySnapshot.length) {
      hideSynergyFilterSuggestions();
      return;
    }
    renderSynergySuggestionList(getSynergyFilterSuggestions(q));
  }

  function selectSynergyFilterSuggestion(card) {
    var inp = $("synergy-filter-input");
    if (inp) inp.value = card.name;
    hideSynergyFilterSuggestions();
    synergyFilterName = card.name;
    renderSynergyTable();
  }

  function updateSynergyFilterMessage(filteredCount) {
    var msg = $("synergy-filter-message");
    if (!msg) return;
    if (!synergyFilterName) {
      msg.innerHTML = "";
      return;
    }
    var fc =
      filteredCount != null ? filteredCount : getSynergyFilteredRows().length;
    msg.innerHTML =
      '<p class="synergy-filter-status subtle">Showing ' +
      fc +
      " pair" +
      (fc !== 1 ? "s" : "") +
      " involving <strong>" +
      escapeHtml(synergyFilterName) +
      '</strong>. <button type="button" class="search-button" id="synergy-filter-clear" style="margin-left:0.35rem;padding:0.2rem 0.55rem;font-size:0.9rem;">Clear filter</button></p>';
  }

  function commitSynergyFilter() {
    var searchInput = $("synergy-filter-input");
    var msg = $("synergy-filter-message");
    if (!searchInput) return;
    hideSynergyFilterSuggestions();
    var searchTerm = searchInput.value.trim();
    if (!searchTerm) {
      synergyFilterName = null;
      if (msg) msg.innerHTML = "";
      if (synergySnapshot && synergySnapshot.length) renderSynergyTable();
      return;
    }
    if (!synergySnapshot || !synergySnapshot.length) {
      if (msg) msg.innerHTML = '<div class="search-error">No synergy data loaded.</div>';
      return;
    }
    var names = uniqueSynergyCardNamesOrdered();
    var match = findClosestNameFromList(names, searchTerm);
    if (!match) {
      if (msg) {
        msg.innerHTML =
          '<div class="search-error">No matching card in synergy pairs. Try another name or pick a suggestion.</div>';
      }
      return;
    }
    searchInput.value = match;
    synergyFilterName = match;
    renderSynergyTable();
  }

  function clearSynergyFilter() {
    synergyFilterName = null;
    var inp = $("synergy-filter-input");
    if (inp) inp.value = "";
    hideSynergyFilterSuggestions();
    var msg = $("synergy-filter-message");
    if (msg) msg.innerHTML = "";
    if (stateDataView === "synergies" && synergySnapshot && synergySnapshot.length) {
      renderSynergyTable();
    }
  }

  function ensureSynergyFilterListeners() {
    if (global._cwDataPageSynergyFilterBound) return;
    global._cwDataPageSynergyFilterBound = true;

    var searchInput = $("synergy-filter-input");
    if (searchInput) {
      searchInput.addEventListener("input", scheduleSynergyFilterSuggestions);
      searchInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          if (synergyFilterTimer) clearTimeout(synergyFilterTimer);
          synergyFilterTimer = null;
          commitSynergyFilter();
        } else if (e.key === "Escape") {
          hideSynergyFilterSuggestions();
        }
      });
    }

    var searchBtn = $("synergy-filter-button");
    if (searchBtn) {
      searchBtn.addEventListener("click", function () {
        commitSynergyFilter();
      });
    }

    document.addEventListener("mousedown", function (ev) {
      var wraps = document.querySelectorAll(".synergy-filter-field-wrap");
      var wi;
      for (wi = 0; wi < wraps.length; wi++) {
        if (wraps[wi].contains(ev.target)) return;
      }
      hideSynergyFilterSuggestions();
    });

    document.addEventListener("click", function (ev) {
      var t = ev.target;
      if (t && t.id === "synergy-filter-clear") {
        ev.preventDefault();
        clearSynergyFilter();
      }
    });
  }

  function resetViewForReload() {
    dashboardData = null;
    $("error").style.display = "none";
    $("error").innerHTML = "";
    $("loading").style.display = "block";
    $("chart-section").style.display = "none";
    $("data-section").style.display = "none";
    var csp = $("card-search-panel");
    if (csp) csp.style.display = "none";
    clearCardSearch();
    var sfp = $("synergy-filter-panel");
    if (sfp) sfp.style.display = "none";
    synergyFilterName = null;
    var sfi = $("synergy-filter-input");
    if (sfi) sfi.value = "";
    hideSynergyFilterSuggestions();
    var sfm = $("synergy-filter-message");
    if (sfm) sfm.innerHTML = "";
    $("detailed-data").innerHTML = "";
    perfSnapshot = null;
    synergySnapshot = null;
    colorIdentitySnapshot = null;
    colorIdentitySort = { key: null, asc: true };
    var dc = $("detailed-chart");
    if (dc && global.Plotly && dc.querySelector(".js-plotly-plot")) {
      Plotly.purge("detailed-chart");
    }
    if (dc) dc.innerHTML = "";
  }

  function comparePerfRows(a, b, key, asc) {
    if (key === "name") {
      var cmp = String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" });
      return asc ? cmp : -cmp;
    }
    var va = Number(a[key]);
    var vb = Number(b[key]);
    if (va !== vb) {
      return asc ? va - vb : vb - va;
    }
    return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" });
  }

  function buildSortedPerformances(snapshot, sortKey, asc) {
    var rows = snapshot.slice();
    rows.sort(function (a, b) {
      var c = comparePerfRows(a, b, sortKey, asc);
      if (c !== 0) return c;
      return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" });
    });
    return rows;
  }

  function renderPerformanceTable() {
    if (!perfSnapshot || !perfSnapshot.length) {
      $("detailed-data").innerHTML = "<p>No card performance data for this cube.</p>";
      return;
    }
    var sortKey = perfSort.key;
    var asc = perfSort.asc;
    var sorted = buildSortedPerformances(perfSnapshot, sortKey, asc);
    var colDefs = [
      { key: "name", label: "Card name" },
      { key: "appearances", label: "Appearances" },
      { key: "wins", label: "Wins" },
      { key: "losses", label: "Losses" },
      { key: "win_rate", label: "Win rate" },
      { key: "performance_delta", label: "Performance delta" },
    ];
    var h = "";
    var ci;
    h += "<h3>All cards</h3>";
    h +=
      '<table class="table performance-all-cards-table" id="performance-all-cards-table"><thead><tr>';
    for (ci = 0; ci < colDefs.length; ci++) {
      var col = colDefs[ci];
      var active = col.key === sortKey;
      var arrow = active ? (asc ? " \u25b2" : " \u25bc") : "";
      h +=
        '<th scope="col"><button type="button" class="table-sort-btn" data-sort-key="' +
        col.key +
        '">' +
        col.label +
        arrow +
        "</button></th>";
    }
    h += "</tr></thead><tbody>";
    for (var ri = 0; ri < sorted.length; ri++) {
      var card = sorted[ri];
      var deltaStr =
        card.performance_delta >= 0
          ? "+" + (card.performance_delta * 100).toFixed(1) + "%"
          : (card.performance_delta * 100).toFixed(1) + "%";
      h +=
        "<tr><td><strong>" +
        CW.cardNameHtml(card.name, card.image_url) +
        "</strong></td>" +
        "<td>" +
        card.appearances +
        "</td>" +
        "<td>" +
        card.wins +
        "</td>" +
        "<td>" +
        card.losses +
        "</td>" +
        "<td>" +
        (card.win_rate * 100).toFixed(1) +
        "%</td>" +
        '<td class="' +
        (card.performance_delta >= 0 ? "positive" : "negative") +
        '">' +
        deltaStr +
        "</td></tr>";
    }
    h += "</tbody></table>";
    $("detailed-data").innerHTML = h;
  }

  function displayPerformanceAnalysis(performances) {
    perfSnapshot = performances && performances.length ? performances.slice() : [];
    perfSort = { key: "performance_delta", asc: false };
    renderPerformanceTable();
  }

  function ensurePerfTableSortDelegation() {
    if (global._cwDataPagePerfSortBound) return;
    global._cwDataPagePerfSortBound = true;
    var host = $("detailed-data");
    if (!host) return;
    host.addEventListener("click", function (ev) {
      var btn = ev.target.closest("button[data-sort-key]");
      if (!btn || !host.contains(btn)) return;
      var key = btn.getAttribute("data-sort-key");
      if (!key) return;
      if (stateDataView === "cards" && perfSnapshot && perfSnapshot.length) {
        if (perfSort.key === key) {
          perfSort.asc = !perfSort.asc;
        } else {
          perfSort.key = key;
          perfSort.asc = key === "name";
        }
        renderPerformanceTable();
      } else if (stateDataView === "synergies" && synergySnapshot && synergySnapshot.length) {
        if (synergySort.key === key) {
          synergySort.asc = !synergySort.asc;
        } else {
          synergySort.key = key;
          synergySort.asc = key === "card1" || key === "card2";
        }
        renderSynergyTable();
      } else if (stateDataView === "colors" && colorIdentitySnapshot && colorIdentitySnapshot.length) {
        if (colorIdentitySort.key === key) {
          colorIdentitySort.asc = !colorIdentitySort.asc;
        } else {
          colorIdentitySort.key = key;
          colorIdentitySort.asc = key === "color";
        }
        renderColorIdentityTable();
      }
    });
  }

  function synergyPairSortKey(s) {
    return String(s.card1) + "\0" + String(s.card2);
  }

  function compareSynergyRows(a, b, key, asc) {
    if (key === "card1") {
      var c1a = String(a.card1).localeCompare(String(b.card1), undefined, { sensitivity: "base" });
      if (c1a !== 0) return asc ? c1a : -c1a;
      var c2a = String(a.card2).localeCompare(String(b.card2), undefined, { sensitivity: "base" });
      return asc ? c2a : -c2a;
    }
    if (key === "card2") {
      var c2b = String(a.card2).localeCompare(String(b.card2), undefined, { sensitivity: "base" });
      if (c2b !== 0) return asc ? c2b : -c2b;
      var c1b = String(a.card1).localeCompare(String(b.card1), undefined, { sensitivity: "base" });
      return asc ? c1b : -c1b;
    }
    if (key === "together_record") {
      var wa = Number(a.together_wins);
      var wb = Number(b.together_wins);
      if (wa !== wb) return asc ? wa - wb : wb - wa;
      var la = Number(a.together_losses);
      var lb = Number(b.together_losses);
      if (la !== lb) return asc ? la - lb : lb - la;
      var tie = synergyPairSortKey(a).localeCompare(synergyPairSortKey(b));
      return asc ? tie : -tie;
    }
    var va = Number(a[key]);
    var vb = Number(b[key]);
    if (!isFinite(va)) va = 0;
    if (!isFinite(vb)) vb = 0;
    if (va !== vb) return asc ? va - vb : vb - va;
    var t = synergyPairSortKey(a).localeCompare(synergyPairSortKey(b));
    return asc ? t : -t;
  }

  function buildSortedSynergies(snapshot, sortKey, asc) {
    var rows = snapshot.slice();
    rows.sort(function (a, b) {
      var c = compareSynergyRows(a, b, sortKey, asc);
      if (c !== 0) return c;
      return synergyPairSortKey(a).localeCompare(synergyPairSortKey(b));
    });
    return rows;
  }

  function renderSynergyTable() {
    if (!synergySnapshot || !synergySnapshot.length) {
      $("detailed-data").innerHTML = "<h3>Synergy data</h3><p>No synergy data for this cube.</p>";
      var msg0 = $("synergy-filter-message");
      if (msg0) msg0.innerHTML = "";
      return;
    }
    var filtered = getSynergyFilteredRows();
    if (!filtered.length && synergyFilterName) {
      $("detailed-data").innerHTML =
        "<h3>Synergy data</h3><p>No pairs include &quot;" +
        escapeHtml(synergyFilterName) +
        "&quot;. Clear the filter or try another card.</p>";
      updateSynergyFilterMessage(0);
      return;
    }
    var sortKey = synergySort.key;
    var asc = synergySort.asc;
    var sorted = buildSortedSynergies(filtered, sortKey, asc);
    var colDefs = [
      { key: "card1", label: "Card 1" },
      { key: "card2", label: "Card 2" },
      { key: "together_count", label: "Decks" },
      { key: "together_win_rate", label: "Together Win Rate" },
      { key: "synergy_bonus", label: "Synergy Bonus" },
      { key: "together_record", label: "Together Record" },
    ];
    var h = "<h3>Synergy data</h3>";
    h +=
      '<table class="table synergy-pairs-table" id="synergy-pairs-table"><thead><tr>';
    var ci;
    for (ci = 0; ci < colDefs.length; ci++) {
      var col = colDefs[ci];
      var active = col.key === sortKey;
      var arrow = active ? (asc ? " \u25b2" : " \u25bc") : "";
      h +=
        '<th scope="col"><button type="button" class="table-sort-btn" data-sort-key="' +
        col.key +
        '">' +
        col.label +
        arrow +
        "</button></th>";
    }
    h += "</tr></thead><tbody>";
    for (var ri = 0; ri < sorted.length; ri++) {
      var s = sorted[ri];
      var bonus =
        s.synergy_bonus >= 0
          ? "+" + (s.synergy_bonus * 100).toFixed(1) + "%"
          : (s.synergy_bonus * 100).toFixed(1) + "%";
      var deckCount = s.together_count != null ? String(s.together_count) : "\u2014";
      h +=
        "<tr><td><strong>" +
        CW.cardNameHtml(s.card1, s.card1_image_url) +
        "</strong></td><td><strong>" +
        CW.cardNameHtml(s.card2, s.card2_image_url) +
        "</strong></td><td>" +
        deckCount +
        "</td><td>" +
        (s.together_win_rate * 100).toFixed(1) +
        "%</td>" +
        '<td class="' +
        (s.synergy_bonus >= 0 ? "positive" : "negative") +
        '">' +
        bonus +
        "</td><td>" +
        s.together_wins +
        "-" +
        s.together_losses +
        "</td></tr>";
    }
    h += "</tbody></table>";
    $("detailed-data").innerHTML = h;
    updateSynergyFilterMessage(filtered.length);
  }

  function displaySynergyAnalysis(synergies) {
    synergySnapshot = synergies && synergies.length ? synergies.slice() : [];
    synergySort = { key: "together_count", asc: false };
    synergyFilterName = null;
    var sfi = $("synergy-filter-input");
    if (sfi) sfi.value = "";
    hideSynergyFilterSuggestions();
    var sfm = $("synergy-filter-message");
    if (sfm) sfm.innerHTML = "";
    renderSynergyTable();
  }

  function colorIdentityRowClass(label) {
    var s = String(label || "");
    if (s === "All Decks") return "color-identity-total";
    if (
      s === "Mono-color" ||
      s === "Two-color" ||
      s === "Three-color" ||
      s === "Four-color" ||
      s === "Five-color"
    ) {
      return "color-identity-subtotal";
    }
    return "color-identity-detail";
  }

  function compareColorIdentityRows(a, b, key, asc) {
    if (key === "color") {
      var cmp = String(a.color).localeCompare(String(b.color), undefined, { sensitivity: "base" });
      return asc ? cmp : -cmp;
    }
    var va = Number(a[key]);
    var vb = Number(b[key]);
    if (!isFinite(va)) va = 0;
    if (!isFinite(vb)) vb = 0;
    if (va !== vb) {
      return asc ? va - vb : vb - va;
    }
    return String(a.color).localeCompare(String(b.color), undefined, { sensitivity: "base" });
  }

  function buildSortedColorIdentity(snapshot, sortKey, asc) {
    if (!sortKey) return snapshot.slice();
    var rows = snapshot.slice();
    rows.sort(function (a, b) {
      var c = compareColorIdentityRows(a, b, sortKey, asc);
      if (c !== 0) return c;
      return String(a.color).localeCompare(String(b.color), undefined, { sensitivity: "base" });
    });
    return rows;
  }

  function renderColorIdentityTable() {
    var rows = colorIdentitySnapshot && colorIdentitySnapshot.length ? colorIdentitySnapshot : [];
    var html = "<h3>Color data</h3>";
    if (!rows.length) {
      html += "<p>No color identity breakdown is available for this cube.</p>";
      $("detailed-data").innerHTML = html;
      return;
    }
    var sortKey = colorIdentitySort.key;
    var asc = colorIdentitySort.asc;
    var sorted = buildSortedColorIdentity(rows, sortKey, asc);
    var colDefs = [
      { key: "color", label: "Color" },
      { key: "wins", label: "Wins" },
      { key: "total_games", label: "# Games" },
      { key: "win_rate", label: "Win rate" },
    ];
    html += '<table class="table color-identity-table" id="color-identity-table"><thead><tr>';
    var ci;
    for (ci = 0; ci < colDefs.length; ci++) {
      var col = colDefs[ci];
      var active = sortKey === col.key;
      var arrow = active ? (asc ? " \u25b2" : " \u25bc") : "";
      html +=
        '<th scope="col"><button type="button" class="table-sort-btn" data-sort-key="' +
        col.key +
        '">' +
        col.label +
        arrow +
        "</button></th>";
    }
    html += "</tr></thead><tbody>";
    var ri;
    for (ri = 0; ri < sorted.length; ri++) {
      var r = sorted[ri];
      var pct = r.total_games > 0 ? (r.win_rate * 100).toFixed(1) + "%" : "\u2014";
      var trClass = colorIdentityRowClass(r.color);
      html +=
        '<tr class="' +
        trClass +
        '"><td>' +
        escapeHtml(String(r.color)) +
        "</td><td>" +
        r.wins +
        "</td><td>" +
        r.total_games +
        "</td><td>" +
        pct +
        "</td></tr>";
    }
    html += "</tbody></table>";
    $("detailed-data").innerHTML = html;
  }

  function displayColorAnalysis(identityRows) {
    colorIdentitySnapshot =
      identityRows && identityRows.length
        ? identityRows.map(function (r) {
            return {
              color: r.color,
              wins: r.wins,
              total_games: r.total_games,
              win_rate: r.win_rate,
            };
          })
        : [];
    colorIdentitySort = { key: null, asc: true };
    renderColorIdentityTable();
  }

  function displayData(data) {
    if (stateDataView === "cards") {
      displayPerformanceAnalysis(data.card_performances);
    } else if (stateDataView === "synergies") {
      displaySynergyAnalysis(data.synergies);
    } else if (stateDataView === "colors") {
      displayColorAnalysis(data.color_identity_table);
    }
    $("data-section").style.display = "block";
    var panel = $("card-search-panel");
    if (panel) {
      if (stateDataView === "cards") {
        panel.style.display = "block";
        ensureCardSearchListeners();
      } else {
        panel.style.display = "none";
        clearCardSearch();
      }
    }
    var synPanel = $("synergy-filter-panel");
    if (synPanel) {
      if (stateDataView === "synergies") {
        synPanel.style.display = "block";
        ensureSynergyFilterListeners();
      } else {
        synPanel.style.display = "none";
        synergyFilterName = null;
        var sfi2 = $("synergy-filter-input");
        if (sfi2) sfi2.value = "";
        hideSynergyFilterSuggestions();
        var sfm2 = $("synergy-filter-message");
        if (sfm2) sfm2.innerHTML = "";
      }
    }
  }

  function getChartLayoutSize() {
    var container = document.querySelector(".container");
    var w =
      container && container.clientWidth > 100
        ? Math.max(260, container.clientWidth - 32)
        : Math.min(1200, Math.max(280, window.innerWidth - 32));
    var narrow = window.innerWidth <= 640;
    var h = narrow ? Math.max(280, Math.min(420, Math.round(w * 0.72))) : 560;
    return { width: w, height: h };
  }

  function relayoutChartPlot() {
    if (!global.Plotly) return;
    var chartDiv = $("detailed-chart");
    if (!chartDiv || !chartDiv.querySelector(".js-plotly-plot")) return;
    var sz = getChartLayoutSize();
    Plotly.relayout("detailed-chart", { width: sz.width, height: sz.height });
  }

  function loadChart(cubeId, chartType) {
    if (!chartType || !cubeId || !global.Plotly) return;
    fetch("/api/charts/" + encodeURIComponent(cubeId) + "/" + chartType)
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data.error) {
          console.error("Chart error:", data.error);
          return;
        }

        var chartData = JSON.parse(data.chart);
        var sz = getChartLayoutSize();
        chartData.layout.width = sz.width;
        chartData.layout.height = sz.height;
        chartData.layout.margin = { l: 60, r: 60, t: 40, b: 60 };
        chartData.layout.autosize = false;

        chartData.layout.xaxis = chartData.layout.xaxis || {};
        chartData.layout.yaxis = chartData.layout.yaxis || {};
        chartData.layout.xaxis.automargin = true;
        chartData.layout.yaxis.automargin = true;

        Plotly.newPlot("detailed-chart", chartData.data, chartData.layout, {
          responsive: false,
          displayModeBar: true,
          useResizeHandler: false,
        }).then(function () {
          var plotDiv = $("detailed-chart");
          var plotlyDiv = plotDiv.querySelector(".plotly-graph-div");
          if (plotlyDiv) {
            plotlyDiv.style.margin = "0 auto";
            plotlyDiv.style.display = "block";
          }
        });

        $("chart-section").style.display = "block";
      })
      .catch(function (err) {
        console.error("Failed to load chart:", err);
      });
  }

  function hideLoading() {
    $("loading").style.display = "none";
  }

  function showError(message) {
    dashboardData = null;
    var csp = $("card-search-panel");
    if (csp) csp.style.display = "none";
    clearCardSearch();
    var sfp = $("synergy-filter-panel");
    if (sfp) sfp.style.display = "none";
    synergyFilterName = null;
    var sfi = $("synergy-filter-input");
    if (sfi) sfi.value = "";
    hideSynergyFilterSuggestions();
    var sfm = $("synergy-filter-message");
    if (sfm) sfm.innerHTML = "";
    $("chart-section").style.display = "none";
    $("data-section").style.display = "none";
    $("error").innerHTML = message;
    $("error").style.display = "block";
    $("loading").style.display = "none";
  }

  function loadPage(cubeId) {
    var info = DATA_PAGE_INFO[stateDataView];
    if (!cubeId || !info) {
      updateHeaderSubtitle(stateDataView);
      showError(
        "Missing cube or page type. Select a cube in the header or open this page from the dashboard."
      );
      return;
    }
    resetViewForReload();

    $("analysis-title").textContent = info.title;
    $("analysis-description").textContent = info.description;
    document.title = info.title + " - CubeWizard";
    updateHeaderSubtitle(stateDataView);

    fetch("/api/dashboard/" + encodeURIComponent(cubeId))
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data.error) {
          dashboardData = null;
          showError(data.error);
          return;
        }
        dashboardData = stateDataView === "cards" ? data : null;
        displayData(data);
        loadChart(cubeId, info.chartType);
        hideLoading();
      })
      .catch(function (err) {
        dashboardData = null;
        showError("Failed to load analysis data: " + err.message);
      });
  }

  /**
   * @param {{ dataView: 'cards'|'colors'|'synergies' }} opts
   */
  function init(opts) {
    stateDataView = opts.dataView;
    if (!DATA_PAGE_INFO[stateDataView]) {
      console.error("CWDataPage.init: unknown dataView", stateDataView);
      return;
    }

    var cubeId = "";
    try {
      if (window.CWPaths && CWPaths.preferredCubeId) {
        cubeId = CWPaths.preferredCubeId();
      }
    } catch (e) {
      cubeId = "";
    }

    var parsed = window.CWPaths ? CWPaths.parsePathname(window.location.pathname) : {};
    if (parsed.cubeId) cubeId = parsed.cubeId;
    stateDataView = opts.dataView;

    maybeCanonicalizeLegacyPath();

    if (cubeId && window.CWPaths && CWPaths.dataViewPathMatches) {
      try {
        if (!CWPaths.dataViewPathMatches(cubeId, stateDataView)) {
          replaceCanonicalUrl(cubeId, stateDataView);
        }
      } catch (ePretty) {}
    }

    if (cubeId) {
      try {
        localStorage.setItem("selectedCubeId", cubeId);
      } catch (e2) {}
    }

    function boot() {
      ensurePerfTableSortDelegation();
      fetch("/api/cubes")
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          var loc = window.CWPaths ? CWPaths.parsePathname(window.location.pathname) : {};
          if (loc.cubeId) cubeId = loc.cubeId;
          stateDataView = opts.dataView;
          maybeCanonicalizeLegacyPath();
          if (cubeId) {
            try {
              localStorage.setItem("selectedCubeId", cubeId);
            } catch (eSync) {}
          }
          var select = $("cube-select");
          var cubes = data.cubes || [];
          for (var i = 0; i < cubes.length; i++) {
            var opt = document.createElement("option");
            opt.value = cubes[i].cube_id;
            opt.textContent = cubes[i].cube_name + " (" + cubes[i].total_decks + " decks)";
            select.appendChild(opt);
          }
          if (cubeId && window.CWPaths && CWPaths.setCubeSelectValue(select, cubeId)) {
            /* synced */
          }
          select.addEventListener("change", function () {
            var v = select.value;
            if (!v) return;
            cubeId = v;
            try {
              localStorage.setItem("selectedCubeId", cubeId);
            } catch (e3) {}
            try {
              if (window.CWPaths) {
                history.replaceState(
                  {},
                  "",
                  CWPaths.mergeCurrentPathPrefixWith(CWPaths.dataPath(cubeId, stateDataView))
                );
              }
            } catch (e4) {}
            if (window.cubeWizardRefreshNavLinks) window.cubeWizardRefreshNavLinks();
            loadPage(cubeId);
          });
          loadPage(cubeId);
        })
        .catch(function () {
          loadPage(cubeId);
        });
      window.addEventListener("resize", relayoutChartPlot);
      window.addEventListener("orientationchange", relayoutChartPlot);

      window.addEventListener("pageshow", function (ev) {
        if (!ev.persisted) return;
        if (!window.CWPaths || !CWPaths.preferredCubeId || !CWPaths.setCubeSelectValue) return;
        var id = CWPaths.preferredCubeId();
        var sel = $("cube-select");
        if (!sel || !id || !CWPaths.setCubeSelectValue(sel, id)) return;
        cubeId = id;
        if (window.cubeWizardRefreshNavLinks) window.cubeWizardRefreshNavLinks();
        loadPage(cubeId);
      });
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  }

  global.CWDataPage = { init: init };
})(typeof window !== "undefined" ? window : this);
