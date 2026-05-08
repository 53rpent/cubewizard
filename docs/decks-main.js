/**
 * Deck list + modal (decks.html). Requires cw-paths.js, card-tooltip.js, #cube-select in DOM.
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

  var currentCubeId = "";
  var processingPollTimer = null;
  var processingFetchInFlight = false;
  var hedronSyncInFlight = false;

  function setHedronSyncUiState() {
    var btn = $("hedron-sync-btn");
    var msg = $("hedron-sync-msg");
    if (!btn) return;
    btn.disabled = !currentCubeId || hedronSyncInFlight;
    if (msg && !currentCubeId) {
      msg.textContent = "";
    }
  }

  function setHedronSyncMessage(text, kind) {
    var msg = $("hedron-sync-msg");
    if (!msg) return;
    msg.textContent = text || "";
    msg.style.color = kind === "error" ? "#c0392b" : kind === "ok" ? "#1e7e34" : "";
  }

  function triggerHedronSync() {
    if (!currentCubeId) return;
    if (hedronSyncInFlight) return;
    hedronSyncInFlight = true;
    setHedronSyncMessage("Starting Hedron sync…", "");
    setHedronSyncUiState();
    fetch("/api/hedron-sync/" + encodeURIComponent(currentCubeId), { method: "POST" })
      .then(function (r) {
        return r
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            return { ok: r.ok, status: r.status, data: data };
          });
      })
      .then(function (res) {
        hedronSyncInFlight = false;
        setHedronSyncUiState();
        if (!res.ok) {
          var err =
            res && res.data && res.data.error
              ? String(res.data.error)
              : "Failed to start Hedron sync (HTTP " + res.status + ")";
          setHedronSyncMessage(err, "error");
          return;
        }
        setHedronSyncMessage("Hedron sync started. New decks will appear as they process.", "ok");
        refreshProcessingStatus();
      })
      .catch(function () {
        hedronSyncInFlight = false;
        setHedronSyncUiState();
        setHedronSyncMessage("Network error starting Hedron sync.", "error");
      });
  }

  function getCubeFromUrl() {
    if (window.CWPaths && CWPaths.preferredCubeId) {
      return CWPaths.preferredCubeId();
    }
    if (window.CWPaths) {
      var parsed = CWPaths.parsePathname(window.location.pathname);
      if (parsed.dataView === "decks" && parsed.cubeId) return parsed.cubeId;
    }
    var params = new URLSearchParams(window.location.search);
    return params.get("cube") || "";
  }

  function fmtDate(value) {
    if (!value) return "";
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString();
  }

  function showError(msg) {
    $("error").textContent = msg;
    $("error").style.display = "block";
    $("loading").style.display = "none";
    setDecksMainVisible(false);
  }

  function setLoading(on) {
    $("loading").style.display = on ? "block" : "none";
  }

  function setDecksMainVisible(on) {
    $("decks-main").style.display = on ? "block" : "none";
  }

  function stopProcessingStatusPoll() {
    if (processingPollTimer) {
      clearInterval(processingPollTimer);
      processingPollTimer = null;
    }
    processingFetchInFlight = false;
  }

  function setProcessingStatusVisible(on) {
    var card = $("processing-status-card");
    if (!card) return;
    if (on) card.removeAttribute("hidden");
    else card.setAttribute("hidden", "hidden");
  }

  function renderProcessingJobs(jobs) {
    var ul = $("processing-status-list");
    if (!ul) return;
    ul.innerHTML = "";
    for (var i = 0; i < jobs.length; i++) {
      var j = jobs[i] || {};
      var pilot = j.pilot_name ? String(j.pilot_name) : "";
      if (!pilot && j.upload_id) {
        var parts = String(j.upload_id).split("/");
        pilot = parts.length ? parts[parts.length - 1] : String(j.upload_id);
      }
      if (!pilot) pilot = "Deck";

      var st = String(j.status || "queued");
      var badgeClass = "cw-processing-badge";
      if (st === "processing") badgeClass += " processing";
      if (st === "error") badgeClass += " error";

      var label = st === "processing" ? "Processing" : st === "error" ? "Error" : "Queued";

      var meta = "";
      if (st === "error" && j.error) {
        meta = '<div class="cw-processing-meta">' + escapeHtmlText(String(j.error)) + "</div>";
      } else if (j.submitted_at) {
        meta = '<div class="cw-processing-meta">' + escapeHtmlText(fmtDate(j.submitted_at)) + "</div>";
      }

      var li = document.createElement("li");
      li.innerHTML =
        '<div style="min-width:0;">' +
        '<div class="cw-processing-pilot">' +
        escapeHtmlText(pilot) +
        "</div>" +
        meta +
        "</div>" +
        '<span class="' +
        badgeClass +
        '">' +
        escapeHtmlText(label) +
        "</span>";
      ul.appendChild(li);
    }
  }

  function refreshProcessingStatus() {
    if (!currentCubeId) return;
    if (processingFetchInFlight) return;
    processingFetchInFlight = true;
    fetch("/api/processing-decks/" + encodeURIComponent(currentCubeId))
      .then(function (r) {
        return r.json().then(function (data) {
          return { ok: r.ok, status: r.status, data: data };
        });
      })
      .then(function (res) {
        processingFetchInFlight = false;
        var data = res.data || {};
        if (!res.ok) {
          setProcessingStatusVisible(false);
          return;
        }
        if (data.disabled) {
          setProcessingStatusVisible(false);
          return;
        }
        var jobs = data.jobs || [];
        if (!jobs.length) {
          setProcessingStatusVisible(false);
          return;
        }
        renderProcessingJobs(jobs);
        setProcessingStatusVisible(true);
      })
      .catch(function () {
        processingFetchInFlight = false;
        setProcessingStatusVisible(false);
      });
  }

  function startProcessingStatusPoll() {
    stopProcessingStatusPoll();
    if (!currentCubeId) return;
    refreshProcessingStatus();
    processingPollTimer = window.setInterval(refreshProcessingStatus, 4000);
  }

  function maybeOpenDeckFromQuery() {
    try {
      var params = new URLSearchParams(window.location.search);
      var deckId = (params.get("deck") || "").trim();
      if (!deckId) return;
      openDeck(deckId);
      params.delete("deck");
      var qs = params.toString();
      var path = window.location.pathname;
      var tail = qs ? "?" + qs : "";
      var hash = window.location.hash || "";
      window.history.replaceState({}, "", path + tail + hash);
    } catch (e) {
      /* ignore */
    }
  }

  function renderDeckRows(decks) {
    var tbody = $("decks-tbody");
    tbody.innerHTML = "";
    for (var i = 0; i < decks.length; i++) {
      var d = decks[i];
      var tr = document.createElement("tr");
      tr.dataset.deckId = d.deck_id;

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
        (d.pilot_name || "") +
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
        fmtDate(d.created) +
        "</td>";

      tr.addEventListener("click", function () {
        openDeck(this.dataset.deckId);
      });
      tbody.appendChild(tr);
    }
  }

  function loadDecks() {
    $("error").style.display = "none";
    setDecksMainVisible(false);
    setLoading(true);

    if (!currentCubeId) {
      stopProcessingStatusPoll();
      setProcessingStatusVisible(false);
      setLoading(false);
      showError("No cube selected. Go back to the dashboard and select a cube first.");
      return;
    }

    startProcessingStatusPoll();

    fetch("/api/decks/" + encodeURIComponent(currentCubeId))
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        setLoading(false);
        if (data.error) {
          showError(data.error);
          return;
        }
        var decks = data.decks || [];
        if (decks.length === 0) {
          $("error").textContent = "No decks found for this cube yet.";
          $("error").style.display = "block";
          setDecksMainVisible(false);
          return;
        }
        renderDeckRows(decks);
        setDecksMainVisible(true);
        maybeOpenDeckFromQuery();
      })
      .catch(function (err) {
        setLoading(false);
        showError("Failed to load decks. Please try again.");
        console.error(err);
      });
  }

  var deckEditContext = { deckId: null, names: [] };

  function setDeckViewMode(editing) {
    $("deck-dynamic-root").style.display = editing ? "none" : "block";
    $("deck-edit-panel").style.display = editing ? "block" : "none";
    if (editing) {
      $("modal-edit-cards-btn").style.display = "none";
    } else {
      $("modal-edit-cards-btn").style.display = deckEditContext.deckId ? "inline-block" : "none";
    }
    $("deck-edit-message").textContent = "";
    $("deck-edit-message").className = "deck-edit-message";
  }

  function parseNamesFromTextarea() {
    var raw = $("deck-edit-textarea").value.split(/\r?\n/);
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var line = String(raw[i] || "").trim();
      if (line.length) out.push(line);
    }
    return out;
  }

  function saveDeckCardEdits() {
    var names = parseNamesFromTextarea();
    if (names.length === 0) {
      $("deck-edit-message").textContent = "Add at least one card name.";
      $("deck-edit-message").className = "deck-edit-message error";
      return;
    }
    var btn = $("deck-edit-save");
    btn.disabled = true;
    $("deck-edit-message").textContent = "Saving (Scryfall lookups; may take a few seconds)...";
    $("deck-edit-message").className = "deck-edit-message";
    fetch("/api/deck/" + encodeURIComponent(deckEditContext.deckId) + "/cards", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names: names }),
    })
      .then(function (r) {
        return r.json().then(function (data) {
          return { ok: r.ok, status: r.status, data: data };
        });
      })
      .then(function (res) {
        btn.disabled = false;
        var data = res.data;
        if (!res.ok) {
          $("deck-edit-message").textContent =
            data && data.error ? data.error : "Save failed (HTTP " + res.status + ")";
          $("deck-edit-message").className = "deck-edit-message error";
          return;
        }
        if (!data.success) {
          $("deck-edit-message").textContent = (data && data.error) ? data.error : "Save failed.";
          $("deck-edit-message").className = "deck-edit-message error";
          return;
        }
        var nf = data.not_found || [];
        var msg = "Saved.";
        if (nf.length) {
          msg +=
            " " +
            nf.length +
            " name(s) could not be matched on Scryfall \u2014 those lines were stored as plain text.";
        }
        $("deck-edit-message").textContent = msg;
        $("deck-edit-message").className = "deck-edit-message ok";
        openDeck(deckEditContext.deckId);
      })
      .catch(function (err) {
        btn.disabled = false;
        $("deck-edit-message").textContent = "Network error.";
        $("deck-edit-message").className = "deck-edit-message error";
        console.error(err);
      });
  }

  function openModal() {
    var overlay = $("modal-overlay");
    overlay.style.display = "flex";
    overlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    deckEditContext.deckId = null;
    deckEditContext.names = [];
    setDeckViewMode(false);
    var overlay = $("modal-overlay");
    overlay.style.display = "none";
    overlay.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function bucketLabel(b) {
    if (b === 6) return "6+";
    return String(b);
  }

  function bucketCmc(cmc) {
    var n = Number(cmc);
    if (!isFinite(n) || n < 0) n = 0;
    var b = Math.floor(n);
    if (b >= 6) return 6;
    return b;
  }

  function renderManaCurve(cards) {
    var counts = {};
    var meta = {};
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var name = c.name || "";
      if (!name) continue;
      if (!counts[name]) {
        counts[name] = 0;
        meta[name] = {
          cmc: c.cmc,
          mana_cost: c.mana_cost || "",
          image_url: c.image_url || null,
        };
      }
      counts[name] += 1;
    }

    var entries = Object.keys(counts).map(function (name) {
      return {
        name: name,
        count: counts[name],
        cmc: meta[name].cmc,
        mana_cost: meta[name].mana_cost,
        image_url: meta[name].image_url,
      };
    });

    entries.sort(function (a, b) {
      var ac = Number(a.cmc) || 0;
      var bc = Number(b.cmc) || 0;
      if (ac !== bc) return ac - bc;
      return a.name.localeCompare(b.name);
    });

    var buckets = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    for (var ei = 0; ei < entries.length; ei++) {
      var e = entries[ei];
      var b = bucketCmc(e.cmc);
      buckets[b].push(e);
    }

    var html = '<div class="curve-grid">';
    for (var b = 0; b <= 6; b++) {
      html +=
        '<div class="curve-col">' +
        "<h4>MV " +
        bucketLabel(b) +
        "</h4>" +
        '<ul class="curve-list">';
      if (buckets[b].length === 0) {
        html += '<li style="color:#999;">\u2014</li>';
      } else {
        for (var li = 0; li < buckets[b].length; li++) {
          var e = buckets[b][li];
          var prefix = e.count > 1 ? e.count + "x " : "";
          var nameHtml = window.CW ? CW.cardNameHtml(e.name, e.image_url) : e.name;
          html += "<li title=\"\">" + prefix + nameHtml + "</li>";
        }
      }
      html += "</ul></div>";
    }
    html += "</div>";
    return html;
  }

  function fitCurveText() {
    var items = document.querySelectorAll(".curve-list li");
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      if (!el || el.textContent === "\u2014") continue;
      el.style.fontSize = "";
      var minPx = 11;
      var size = parseFloat(getComputedStyle(el).fontSize) || 14;
      var guard = 0;
      while (el.scrollWidth > el.clientWidth && size > minPx && guard < 20) {
        size -= 0.5;
        el.style.fontSize = size + "px";
        guard += 1;
      }
    }
  }

  function openDeck(deckId) {
    $("modal-title").textContent = "Deck";
    $("modal-meta").textContent = "";
    $("deck-edit-panel").style.display = "none";
    $("deck-dynamic-root").style.display = "block";
    $("deck-dynamic-root").innerHTML = '<div class="loading">Loading deck...</div>';
    $("modal-edit-cards-btn").style.display = "none";
    openModal();

    fetch("/api/deck/" + encodeURIComponent(deckId))
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data.error) {
          $("deck-dynamic-root").innerHTML = '<div class="error">' + data.error + "</div>";
          return;
        }
        var deck = data.deck || {};
        var deckStats = data.deck_stats || null;
        var cards = data.cards || [];

        deckEditContext.deckId = deckId;
        var ordered = data.card_names_ordered;
        if ((!ordered || !ordered.length) && cards.length) {
          ordered = cards.map(function (c) {
            return c.name;
          });
        }
        deckEditContext.names = ordered || [];

        var title =
          (deck.pilot_name ? deck.pilot_name + " \u2014 " : "") +
          (deck.match_wins + "-" + deck.match_losses + (deck.match_draws ? "-" + deck.match_draws : ""));
        $("modal-title").textContent = title;

        var metaParts = [];
        if (deck.created) metaParts.push("Uploaded: " + fmtDate(deck.created));
        var ocrTotal = deck && deck.total_cards != null ? deck.total_cards : "";
        metaParts.push("Total Cards Found: " + ocrTotal);
        metaParts.push("Scryfall Cards Matched: " + cards.length);
        $("modal-meta").textContent = metaParts.join(" \u2022 ");

        $("modal-image-id").textContent = deck.image_id ? "Image ID: " + deck.image_id : "";

        var photoBlock = "";
        if (deck.deck_photo_url) {
          photoBlock =
            '<div class="modal-deck-photo-wrap"><img class="modal-deck-photo" src="' +
            escapeHtmlAttr(deck.deck_photo_url) +
            '" alt="Deck photo" loading="lazy" /></div>';
        }
        $("deck-dynamic-root").innerHTML =
          photoBlock + '<div id="deck-curve-container">' + renderManaCurve(cards) + "</div>";
        fitCurveText();
        $("modal-edit-cards-btn").style.display = "inline-block";

        if (deckStats && deckStats.processing_notes) {
          try {
            var notes = JSON.parse(deckStats.processing_notes);
            var nf = notes && notes.not_found ? notes.not_found : [];
            if (nf && nf.length > 0) {
              nf.sort(function (a, b) {
                return String(a).localeCompare(String(b));
              });
              var nh =
                '<div style="margin-top:1rem; padding-top:1rem; border-top:1px solid #eee;">' +
                '<div style="font-weight:700; margin-bottom:0.5rem;">Cards not found (' +
                nf.length +
                ")</div>" +
                '<div style="color:#666; font-size:0.9rem; margin-bottom:0.5rem;">These were extracted from the image but did not match a Scryfall card at ingest time.</div>' +
                '<ul style="margin-left:1.25rem;">';
              for (var i = 0; i < nf.length; i++) {
                nh += "<li>" + String(nf[i]).replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</li>";
              }
              nh += "</ul></div>";
              $("deck-dynamic-root").insertAdjacentHTML("beforeend", nh);
            }
          } catch (e) {
            /* ignore */
          }
        }
      })
      .catch(function (err) {
        $("deck-dynamic-root").innerHTML = '<div class="error">Failed to load deck.</div>';
        console.error(err);
      });
  }

  function subtitleForCube(cubeKey, cubes) {
    var label = cubeKey;
    for (var i = 0; i < cubes.length; i++) {
      if (cubes[i].cube_id === cubeKey) {
        label = (cubes[i].cube_name || cubeKey) + " (" + cubeKey + ")";
        break;
      }
    }
    return "All decks submitted for " + label + ".";
  }

  function bindModalUi() {
    $("modal-overlay").addEventListener("click", function (e) {
      if (e.target === this) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });

    $("modal-edit-cards-btn").addEventListener("click", function () {
      $("deck-edit-textarea").value = (deckEditContext.names || []).join("\n");
      setDeckViewMode(true);
    });
    $("deck-edit-cancel").addEventListener("click", function () {
      setDeckViewMode(false);
    });
    $("deck-edit-save").addEventListener("click", saveDeckCardEdits);
  }

  function boot() {
    try {
      currentCubeId = getCubeFromUrl() || localStorage.getItem("selectedCubeId") || "";
    } catch (e) {
      currentCubeId = getCubeFromUrl() || "";
    }
    setHedronSyncUiState();
    if (currentCubeId) {
      try {
        localStorage.setItem("selectedCubeId", currentCubeId);
      } catch (e2) {}
      try {
        if (window.CWPaths && CWPaths.decksPathMatches) {
          if (!CWPaths.decksPathMatches(currentCubeId)) {
            window.history.replaceState(
              {},
              "",
              CWPaths.mergeCurrentPathPrefixWith(CWPaths.decks(currentCubeId))
            );
          }
        }
      } catch (e3) {}
    }

    fetch("/api/cubes")
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var loc = window.CWPaths ? CWPaths.parsePathname(window.location.pathname) : {};
        if (loc.cubeId) {
          currentCubeId = loc.cubeId;
          try {
            localStorage.setItem("selectedCubeId", currentCubeId);
          } catch (eSync) {}
        }
        var cubes = data.cubes || [];
        var sel = $("cube-select");
        for (var i = 0; i < cubes.length; i++) {
          var opt = document.createElement("option");
          opt.value = cubes[i].cube_id;
          opt.textContent = cubes[i].cube_name + " (" + cubes[i].total_decks + " decks)";
          sel.appendChild(opt);
        }
        if (currentCubeId && window.CWPaths && CWPaths.setCubeSelectValue(sel, currentCubeId)) {
          /* ok */
        }

        sel.addEventListener("change", function () {
          var v = sel.value;
          if (!v) return;
          currentCubeId = v;
          setHedronSyncMessage("", "");
          setHedronSyncUiState();
          try {
            localStorage.setItem("selectedCubeId", v);
          } catch (e4) {}
          try {
            if (window.CWPaths) {
              window.history.replaceState(
                {},
                "",
                CWPaths.mergeCurrentPathPrefixWith(CWPaths.decks(v))
              );
            }
          } catch (e5) {}
          if (window.cubeWizardRefreshNavLinks) window.cubeWizardRefreshNavLinks();
          closeModal();
          $("error").style.display = "none";
          $("error").textContent = "";
          $("decks-subtitle").textContent = subtitleForCube(v, cubes);
          loadDecks();
        });

        if (!currentCubeId) {
          stopProcessingStatusPoll();
          setProcessingStatusVisible(false);
          setHedronSyncUiState();
          $("decks-subtitle").textContent = "Select a cube in the header to view decks.";
          $("loading").style.display = "none";
          showError("No cube selected.");
          return;
        }

        $("decks-subtitle").textContent = subtitleForCube(currentCubeId, cubes);
        setHedronSyncUiState();
        loadDecks();
      })
      .catch(function () {
        if (!currentCubeId) {
          stopProcessingStatusPoll();
          setProcessingStatusVisible(false);
          setHedronSyncUiState();
          $("decks-subtitle").textContent = "Select a cube in the header to view decks.";
          $("loading").style.display = "none";
          showError("No cube selected.");
          return;
        }
        $("decks-subtitle").textContent = "All decks for cube " + currentCubeId + ".";
        setHedronSyncUiState();
        loadDecks();
      });
  }

  function onPageShow(ev) {
    if (!ev.persisted) return;
    if (!window.CWPaths || !CWPaths.preferredCubeId || !CWPaths.setCubeSelectValue) return;
    var sel = document.getElementById("cube-select");
    if (!sel || sel.options.length < 2) return;
    var id = CWPaths.preferredCubeId();
    if (!id || !CWPaths.setCubeSelectValue(sel, id)) return;
    currentCubeId = id;
    if (window.cubeWizardRefreshNavLinks) window.cubeWizardRefreshNavLinks();
    closeModal();
    var errEl = document.getElementById("error");
    if (errEl) {
      errEl.style.display = "none";
      errEl.textContent = "";
    }
    loadDecks();
  }

  function init() {
    bindModalUi();
    try {
      var btn = $("hedron-sync-btn");
      if (btn) btn.addEventListener("click", triggerHedronSync);
    } catch (eBtn) {}
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
    window.addEventListener("pageshow", onPageShow);
  }

  window.CubeWizardDecksMain = { init: init, closeModal: closeModal, openDeck: openDeck };
  window.closeModal = closeModal;
})();
