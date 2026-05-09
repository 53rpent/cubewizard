/**
 * Pilot name search (resources-pilot-search.html). Requires cw-paths.js.
 */
(function () {
  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtmlAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function escapeHtmlText(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function fmtDate(value) {
    if (!value) return "";
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString();
  }

  function showError(msg) {
    clearSummary();
    $("pilot-error").textContent = msg;
    $("pilot-error").style.display = "block";
    $("pilot-results").style.display = "none";
    $("pilot-results-hint").hidden = true;
  }

  function clearError() {
    $("pilot-error").textContent = "";
    $("pilot-error").style.display = "none";
  }

  function clearSummary() {
    var wrap = $("pilot-summary");
    if (!wrap) return;
    wrap.innerHTML = "";
    wrap.hidden = true;
  }

  function summaryItem(label, value) {
    return (
      '<div class="pilot-summary-item">' +
      '<span class="pilot-summary-label">' +
      label +
      "</span>" +
      '<span class="pilot-summary-value">' +
      value +
      "</span>" +
      "</div>"
    );
  }

  function renderSummary(decks) {
    var wrap = $("pilot-summary");
    if (!wrap) return;
    var n = decks.length;
    var tw = 0;
    var tl = 0;
    var td = 0;
    for (var i = 0; i < n; i++) {
      tw += Number(decks[i].match_wins) || 0;
      tl += Number(decks[i].match_losses) || 0;
      td += Number(decks[i].match_draws) || 0;
    }
    var denom = tw + tl;
    var winStr = denom > 0 ? ((tw / denom) * 100).toFixed(1) + "%" : "\u2014";
    wrap.innerHTML =
      summaryItem("Decks", String(n)) +
      summaryItem("Total W", String(tw)) +
      summaryItem("Total L", String(tl)) +
      summaryItem("Total D", String(td)) +
      summaryItem("Win %", winStr);
    wrap.hidden = false;
  }

  function setLoading(on) {
    $("pilot-loading").hidden = !on;
  }

  function deckUrlForRow(cubeId, deckId) {
    if (!cubeId || !deckId) return "/";
    if (window.CWPaths && CWPaths.decks) {
      return CWPaths.decks(cubeId) + "?deck=" + encodeURIComponent(deckId);
    }
    return "/" + encodeURIComponent(cubeId) + "/decks?deck=" + encodeURIComponent(deckId);
  }

  var pilotListSnapshot = [];
  var pilotListSort = { key: "created", asc: false };

  function pilotPhotoSortValue(d) {
    return d.deck_thumb_url || d.deck_photo_url ? 1 : 0;
  }

  function pilotRowTieBreak(a, b) {
    var ca = String(a.cube_id || "");
    var cb = String(b.cube_id || "");
    var c = ca.localeCompare(cb);
    if (c !== 0) return c;
    return String(a.deck_id).localeCompare(String(b.deck_id));
  }

  function comparePilotSnapshotRows(a, b, key, asc) {
    if (key === "photo") {
      var pa = pilotPhotoSortValue(a);
      var pb = pilotPhotoSortValue(b);
      if (pa !== pb) return asc ? pa - pb : pb - pa;
      return pilotRowTieBreak(a, b);
    }
    if (key === "cube_id" || key === "pilot_name") {
      var cmp = String(a[key] || "").localeCompare(String(b[key] || ""), undefined, {
        sensitivity: "base",
      });
      if (cmp !== 0) return asc ? cmp : -cmp;
      return pilotRowTieBreak(a, b);
    }
    if (key === "created") {
      var ta = new Date(a.created).getTime();
      var tb = new Date(b.created).getTime();
      ta = isFinite(ta) ? ta : 0;
      tb = isFinite(tb) ? tb : 0;
      if (ta !== tb) return asc ? ta - tb : tb - ta;
      return pilotRowTieBreak(a, b);
    }
    var va = Number(a[key]);
    var vb = Number(b[key]);
    if (key === "win_rate") {
      if (!isFinite(va)) va = -1;
      if (!isFinite(vb)) vb = -1;
    } else {
      if (!isFinite(va)) va = 0;
      if (!isFinite(vb)) vb = 0;
    }
    if (va !== vb) return asc ? va - vb : vb - va;
    return pilotRowTieBreak(a, b);
  }

  function buildSortedPilotRows(snapshot, sortKey, asc) {
    var rows = snapshot.slice();
    rows.sort(function (a, b) {
      return comparePilotSnapshotRows(a, b, sortKey, asc);
    });
    return rows;
  }

  function ensurePilotTableSortDelegation() {
    if (window._cwPilotTableSortBound) return;
    window._cwPilotTableSortBound = true;
    var wrap = document.querySelector(".pilot-table-wrap");
    if (!wrap) return;
    wrap.addEventListener("click", function (ev) {
      var btn = ev.target.closest("button[data-sort-key]");
      if (!btn || !wrap.contains(btn)) return;
      var thead = $("pilot-thead");
      if (!thead || !thead.contains(btn)) return;
      ev.preventDefault();
      var key = btn.getAttribute("data-sort-key");
      if (!key || !pilotListSnapshot.length) return;
      if (pilotListSort.key === key) {
        pilotListSort.asc = !pilotListSort.asc;
      } else {
        pilotListSort.key = key;
        pilotListSort.asc = key === "cube_id" || key === "pilot_name";
      }
      renderPilotTable();
    });
  }

  function renderPilotTable() {
    var thead = $("pilot-thead");
    var tbody = $("pilot-tbody");
    if (!thead || !tbody) return;

    var colDefs = [
      { key: "photo", label: "Photo" },
      { key: "cube_id", label: "Cube" },
      { key: "pilot_name", label: "Pilot" },
      { key: "match_wins", label: "W", cls: "mono" },
      { key: "match_losses", label: "L", cls: "mono" },
      { key: "match_draws", label: "D", cls: "mono" },
      { key: "win_rate", label: "Win%", cls: "mono" },
      { key: "total_cards", label: "Cards", cls: "mono" },
      { key: "created", label: "Uploaded" },
    ];
    var sk = pilotListSort.key;
    var asc = pilotListSort.asc;
    var hr = "<tr>";
    for (var ci = 0; ci < colDefs.length; ci++) {
      var col = colDefs[ci];
      var active = sk === col.key;
      var arrow = active ? (asc ? " \u25b2" : " \u25bc") : "";
      var thCls = col.cls ? ' class="' + col.cls + '"' : "";
      hr +=
        "<th scope=\"col\"" +
        thCls +
        '><button type="button" class="table-sort-btn" data-sort-key="' +
        col.key +
        '">' +
        col.label +
        arrow +
        "</button></th>";
    }
    hr += "</tr>";
    thead.innerHTML = hr;

    var sorted = buildSortedPilotRows(pilotListSnapshot, sk, asc);
    tbody.innerHTML = "";
    for (var i = 0; i < sorted.length; i++) {
      var d = sorted[i];
      var tr = document.createElement("tr");
      tr.dataset.deckId = d.deck_id;
      tr.dataset.cubeId = d.cube_id || "";

      var winPct = d.win_rate != null ? (Number(d.win_rate) * 100).toFixed(1) + "%" : "";

      var thumbSrc = d.deck_thumb_url || d.deck_photo_url;
      var photoCell = thumbSrc
        ? '<td class="deck-table-photo-cell"><img class="deck-table-photo" src="' +
          escapeHtmlAttr(thumbSrc) +
          '" alt="" loading="lazy" decoding="async" /></td>'
        : "<td class=\"deck-table-photo-cell\">\u2014</td>";

      tr.innerHTML =
        photoCell +
        "<td>" +
        escapeHtmlText(d.cube_id || "") +
        "</td>" +
        "<td>" +
        escapeHtmlText(d.pilot_name || "") +
        "</td>" +
        '<td class="mono">' +
        (d.match_wins ?? "") +
        "</td>" +
        '<td class="mono">' +
        (d.match_losses ?? "") +
        "</td>" +
        '<td class="mono">' +
        (d.match_draws ?? 0) +
        "</td>" +
        '<td class="mono">' +
        winPct +
        "</td>" +
        '<td class="mono">' +
        (d.total_cards ?? "") +
        "</td>" +
        "<td>" +
        escapeHtmlText(fmtDate(d.created)) +
        "</td>";

      tr.style.cursor = "pointer";
      tr.addEventListener("click", function () {
        var url = deckUrlForRow(this.dataset.cubeId, this.dataset.deckId);
        window.location.href = url;
      });
      tbody.appendChild(tr);
    }
  }

  function runSearchFromForm() {
    var input = $("pilot-q");
    var q = (input && input.value ? String(input.value) : "").trim();
    if (q.length < 2) {
      showError("Enter at least 2 characters.");
      return;
    }
    clearError();
    clearSummary();
    setLoading(true);
    $("pilot-results").style.display = "none";
    $("pilot-results-hint").hidden = true;

    fetch("/api/decks/by-pilot?q=" + encodeURIComponent(q))
      .then(function (r) {
        return r.json().then(function (data) {
          return { ok: r.ok, status: r.status, data: data };
        });
      })
      .then(function (res) {
        setLoading(false);
        var data = res.data || {};
        if (!res.ok) {
          showError((data && data.error) ? data.error : "Search failed (HTTP " + res.status + ").");
          return;
        }
        if (data.error) {
          showError(data.error);
          return;
        }
        var decks = data.decks || [];
        var hint = $("pilot-results-hint");
        if (decks.length === 0) {
          clearSummary();
          hint.textContent = "No decks matched \u201c" + String(data.query || q) + "\u201d.";
          hint.hidden = false;
          $("pilot-results").style.display = "none";
          return;
        }
        hint.textContent =
          decks.length +
          (decks.length >= 200 ? " decks (showing first 200). " : " deck(s). ") +
          "Search: \u201c" +
          String(data.query || q) +
          "\u201d.";
        hint.hidden = false;
        renderSummary(decks);
        pilotListSnapshot = decks.slice();
        pilotListSort = { key: "created", asc: false };
        renderPilotTable();
        $("pilot-results").style.display = "block";
      })
      .catch(function (err) {
        setLoading(false);
        showError("Search failed. Please try again.");
        console.error(err);
      });
  }

  function init() {
    ensurePilotTableSortDelegation();
    var form = $("pilot-search-form");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      runSearchFromForm();
    });

    try {
      var params = new URLSearchParams(window.location.search);
      var q0 = (params.get("q") || "").trim();
      if (q0.length >= 2 && $("pilot-q")) {
        $("pilot-q").value = q0;
        runSearchFromForm();
      }
    } catch (e1) {
      /* ignore */
    }
  }

  window.CubeWizardPilotSearch = { init: init };
})();
