/**
 * Deck list + modal (decks.html). Requires cw-paths.js, card-tooltip.js, #cube-select in DOM.
 */
(function () {
  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtmlAttr(s) {
    return CWHtml.escapeHtmlAttr(s);
  }

  function escapeHtmlText(s) {
    return CWHtml.escapeHtmlText(s);
  }

  var currentCubeId = "";
  var processingPollTimer = null;
  var processingFetchInFlight = false;
  var hedronSyncInFlight = false;
  var activeProcessingJobCount = 0;
  var deckListSnapshot = [];
  var deckListSort = { key: "created", asc: false };
  var loggedInUser = null;
  var pendingDeckAction = null;
  var dismissingProcessingJobIds = {};

  function deckPhotoSortValue(d) {
    return d.deck_thumb_url || d.deck_photo_url ? 1 : 0;
  }

  function compareDeckSnapshotRows(a, b, key, asc) {
    if (key === "photo") {
      var pa = deckPhotoSortValue(a);
      var pb = deckPhotoSortValue(b);
      if (pa !== pb) return asc ? pa - pb : pb - pa;
      return String(a.deck_id).localeCompare(String(b.deck_id));
    }
    if (key === "pilot_name") {
      var cmp = String(a.pilot_name || "").localeCompare(String(b.pilot_name || ""), undefined, {
        sensitivity: "base",
      });
      if (cmp !== 0) return asc ? cmp : -cmp;
      return String(a.deck_id).localeCompare(String(b.deck_id));
    }
    if (key === "created") {
      var ta = new Date(a.created).getTime();
      var tb = new Date(b.created).getTime();
      ta = Number.isFinite(ta) ? ta : 0;
      tb = Number.isFinite(tb) ? tb : 0;
      if (ta !== tb) return asc ? ta - tb : tb - ta;
      return String(a.deck_id).localeCompare(String(b.deck_id));
    }
    var va = Number(a[key]);
    var vb = Number(b[key]);
    if (key === "win_rate") {
      if (!Number.isFinite(va)) va = -1;
      if (!Number.isFinite(vb)) vb = -1;
    } else {
      if (!Number.isFinite(va)) va = 0;
      if (!Number.isFinite(vb)) vb = 0;
    }
    if (va !== vb) return asc ? va - vb : vb - va;
    return String(a.deck_id).localeCompare(String(b.deck_id));
  }

  function buildSortedDecks(snapshot, sortKey, asc) {
    var rows = snapshot.slice();
    rows.sort(function (a, b) {
      return compareDeckSnapshotRows(a, b, sortKey, asc);
    });
    return rows;
  }

  function ensureDeckTableSortDelegation() {
    if (window._cwDecksTableSortBound) return;
    window._cwDecksTableSortBound = true;
    var wrap = $("table-section");
    if (!wrap) return;
    wrap.addEventListener("click", function (ev) {
      var btn = ev.target.closest("button[data-sort-key]");
      if (!btn || !wrap.contains(btn)) return;
      var thead = $("decks-thead");
      if (!thead?.contains(btn)) return;
      ev.preventDefault();
      var key = btn.getAttribute("data-sort-key");
      if (!key || !deckListSnapshot.length) return;
      if (deckListSort.key === key) {
        deckListSort.asc = !deckListSort.asc;
      } else {
        deckListSort.key = key;
        deckListSort.asc = key === "pilot_name";
      }
      renderDeckTable();
    });
  }

  function setHedronSyncUiState() {
    var btn = $("hedron-sync-btn");
    var msg = $("hedron-sync-msg");
    if (!btn) return;
    btn.disabled = !currentCubeId || hedronSyncInFlight;
    btn.textContent = hedronSyncInFlight
      ? "Queueing Hedron decks..."
      : activeProcessingJobCount > 0
        ? "Processing decks..."
        : "Sync Hedron";
    if (activeProcessingJobCount > 0 && !hedronSyncInFlight) {
      btn.setAttribute("aria-disabled", "true");
      btn.title = "Wait for current deck processing to finish before syncing Hedron again.";
    } else {
      btn.removeAttribute("aria-disabled");
      btn.title = "";
    }
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

  function getTurnstileToken() {
    var el = document.querySelector('[name="cf-turnstile-response"]');
    return el?.value ? el.value : "";
  }

  function triggerHedronSync() {
    if (!currentCubeId) return;
    if (hedronSyncInFlight) return;
    if (activeProcessingJobCount > 0) {
      var noun = activeProcessingJobCount === 1 ? "deck is" : "decks are";
      setHedronSyncMessage(
        "Hedron sync is unavailable while " +
          activeProcessingJobCount +
          " " +
          noun +
          " still being processed. Wait for processing to finish, then try again.",
        "error",
      );
      return;
    }
    hedronSyncInFlight = true;
    setHedronSyncMessage("Reading Hedron data and queueing deck images...", "");
    setHedronSyncUiState();
    fetch("/api/hedron-sync/" + encodeURIComponent(currentCubeId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "cf-turnstile-response": getTurnstileToken() }),
    })
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
        if (window.turnstile) {
          try {
            turnstile.reset();
          } catch (_e) {
            /* ignore */
          }
        }
        if (!res.ok) {
          var err = res?.data?.error ? String(res.data.error) : "Failed to start Hedron sync (HTTP " + res.status + ")";
          setHedronSyncMessage(err, "error");
          return;
        }
        var queued = res?.data && typeof res.data.decks_queued === "number" ? res.data.decks_queued : 0;
        var noun = queued === 1 ? "deck" : "decks";
        var suffix = res?.data?.continuation_scheduled
          ? " More Hedron pages will continue queueing in the background."
          : "";
        if (queued > 0) {
          setHedronSyncMessage(queued + " Hedron " + noun + " queued for database import." + suffix, "ok");
        } else {
          setHedronSyncMessage("No new Hedron decks found to add.", "ok");
        }
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
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString();
  }

  function clearError() {
    var banner = $("error");
    var msgEl = $("error-message");
    if (msgEl) msgEl.textContent = "";
    if (banner) banner.style.display = "none";
  }

  function showError(msg) {
    var banner = $("error");
    var msgEl = $("error-message");
    if (msgEl) msgEl.textContent = msg;
    if (banner) banner.style.display = "flex";
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

  function setActiveProcessingJobs(jobs) {
    var count = 0;
    jobs = Array.isArray(jobs) ? jobs : [];
    for (var i = 0; i < jobs.length; i++) {
      var st = String(jobs[i]?.status || "queued").toLowerCase();
      if (st !== "done" && st !== "error" && st !== "failed") count++;
    }
    activeProcessingJobCount = count;
    setHedronSyncUiState();
  }

  function dismissProcessingJob(uploadId) {
    var id = String(uploadId || "").trim();
    if (!id || !currentCubeId || dismissingProcessingJobIds[id]) return;
    dismissingProcessingJobIds[id] = true;

    fetch("/api/processing-job/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ upload_id: id, cube_id: currentCubeId }),
    })
      .then(function (r) {
        return r
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            return { ok: r.ok, data: data };
          });
      })
      .then(function (res) {
        delete dismissingProcessingJobIds[id];
        if (!res.ok) {
          alert(res.data?.error || "Could not remove failed upload.");
          return;
        }
        refreshProcessingStatus();
      })
      .catch(function (err) {
        delete dismissingProcessingJobIds[id];
        console.error(err);
        alert("Network error.");
      });
  }

  function renderProcessingJobs(jobs) {
    var ul = $("processing-status-list");
    if (!ul) return;
    ul.innerHTML = "";
    for (var i = 0; i < jobs.length; i++) {
      var j = jobs[i] || {};
      var uploadId = String(j.upload_id || "");
      var st = String(j.status || "queued");
      var pilot = j.pilot_name ? String(j.pilot_name) : "";
      if (!pilot && j.upload_id) {
        var parts = String(j.upload_id).split("/");
        pilot = parts.length ? parts[parts.length - 1] : String(j.upload_id);
      }
      if (!pilot) pilot = "Deck";

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
        '<div class="cw-processing-status-actions">' +
        '<span class="' +
        badgeClass +
        '">' +
        escapeHtmlText(label) +
        "</span>" +
        (st === "error"
          ? '<button type="button" class="cw-processing-dismiss" aria-label="Remove failed upload"' +
            (dismissingProcessingJobIds[uploadId] ? " disabled" : "") +
            ">✕</button>"
          : "") +
        "</div>";
      if (st === "error" && uploadId) {
        var dismissBtn = li.querySelector(".cw-processing-dismiss");
        if (dismissBtn) {
          dismissBtn.addEventListener(
            "click",
            (function (jobUploadId) {
              return function (e) {
                e.stopPropagation();
                dismissProcessingJob(jobUploadId);
              };
            })(uploadId),
          );
        }
      }
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
          setActiveProcessingJobs([]);
          return;
        }
        if (data.disabled) {
          setProcessingStatusVisible(false);
          setActiveProcessingJobs([]);
          return;
        }
        var jobs = data.jobs || [];
        if (!jobs.length) {
          setProcessingStatusVisible(false);
          setActiveProcessingJobs([]);
          return;
        }
        setActiveProcessingJobs(jobs);
        renderProcessingJobs(jobs);
        setProcessingStatusVisible(true);
      })
      .catch(function () {
        processingFetchInFlight = false;
        setProcessingStatusVisible(false);
        setActiveProcessingJobs([]);
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
    } catch (_e) {
      /* ignore */
    }
  }

  function renderDeckTable() {
    var thead = $("decks-thead");
    var tbody = $("decks-tbody");
    if (!thead || !tbody) return;

    var colDefs = [
      { key: "photo", label: "Photo" },
      { key: "pilot_name", label: "Pilot" },
      { key: "match_wins", label: "W", cls: "mono" },
      { key: "match_losses", label: "L", cls: "mono" },
      { key: "match_draws", label: "D", cls: "mono" },
      { key: "win_rate", label: "Win%", cls: "mono" },
      { key: "total_cards", label: "Cards", cls: "mono" },
      { key: "created", label: "Uploaded" },
    ];
    var sk = deckListSort.key;
    var asc = deckListSort.asc;
    var hr = "<tr>";
    for (var ci = 0; ci < colDefs.length; ci++) {
      var col = colDefs[ci];
      var active = sk === col.key;
      var arrow = active ? (asc ? " \u25b2" : " \u25bc") : "";
      var thCls = col.cls ? ' class="' + col.cls + '"' : "";
      hr +=
        '<th scope="col"' +
        thCls +
        '><button type="button" class="table-sort-btn" data-sort-key="' +
        col.key +
        '">' +
        col.label +
        arrow +
        "</button></th>";
    }
    if (loggedInUser) {
      hr += '<th scope="col" class="deck-table-claim-cell">Claim</th>';
    }
    hr += "</tr>";
    thead.innerHTML = hr;

    var sorted = buildSortedDecks(deckListSnapshot, sk, asc);
    tbody.innerHTML = "";
    for (var i = 0; i < sorted.length; i++) {
      var d = sorted[i];
      var tr = document.createElement("tr");
      tr.dataset.deckId = d.deck_id;

      var winPct = d.win_rate != null ? (Number(d.win_rate) * 100).toFixed(1) + "%" : "";

      var thumbSrc = d.deck_thumb_url || d.deck_photo_url;
      var photoCell = thumbSrc
        ? '<td class="deck-table-photo-cell"><img class="deck-table-photo" src="' +
          escapeHtmlAttr(thumbSrc) +
          '" alt="" loading="lazy" decoding="async" /></td>'
        : '<td class="deck-table-photo-cell">\u2014</td>';

      tr.innerHTML =
        photoCell +
        "<td>" +
        CWHtml.escapeHtmlText(d.pilot_name || "") +
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

      if (loggedInUser) {
        var claimTd = document.createElement("td");
        claimTd.className = "deck-table-claim-cell";
        if (d.can_claim) {
          var claimBtn = document.createElement("button");
          claimBtn.type = "button";
          claimBtn.className = "btn-table-claim";
          claimBtn.textContent = "Claim";
          claimBtn.addEventListener(
            "click",
            (function (deckId) {
              return function (e) {
                e.stopPropagation();
                openDeckConfirm("claim", deckId);
              };
            })(d.deck_id),
          );
          claimTd.appendChild(claimBtn);
        }
        tr.appendChild(claimTd);
      }

      tr.addEventListener("click", function () {
        openDeck(this.dataset.deckId);
      });
      tbody.appendChild(tr);
    }
  }

  function loadDecks() {
    clearError();
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

    fetch("/api/decks/" + encodeURIComponent(currentCubeId), { credentials: "include" })
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
          showError("No decks found for this cube yet.");
          setDecksMainVisible(false);
          return;
        }
        deckListSnapshot = decks.slice();
        deckListSort = { key: "created", asc: false };
        renderDeckTable();
        setDecksMainVisible(true);
        maybeOpenDeckFromQuery();
      })
      .catch(function (err) {
        setLoading(false);
        showError("Failed to load decks. Please try again.");
        console.error(err);
      });
  }

  var deckEditContext = { deckId: null, names: [], permissions: null, photoUrl: "" };

  function updateModalActionButtons() {
    var perms = deckEditContext.permissions || {};
    var claimBtn = $("modal-claim-deck-btn");
    var editBtn = $("modal-edit-cards-btn");
    var deleteBtn = $("modal-delete-deck-btn");
    var reprocessBtn = $("modal-reprocess-deck-btn");
    if (claimBtn) {
      claimBtn.style.display = perms.can_claim ? "inline-block" : "none";
    }
    if (deleteBtn) {
      deleteBtn.style.display = perms.can_delete && deckEditContext.deckId ? "inline-block" : "none";
    }
    if (reprocessBtn) {
      reprocessBtn.style.display = perms.can_reprocess && deckEditContext.deckId ? "inline-block" : "none";
    }
    if (editBtn && $("deck-edit-panel").style.display !== "block") {
      editBtn.style.display = perms.can_edit && deckEditContext.deckId ? "inline-block" : "none";
    }
  }

  function updateDeckEditPhoto() {
    var wrap = $("deck-edit-photo-wrap");
    var img = $("deck-edit-photo");
    if (!wrap || !img) return;
    var url = deckEditContext.photoUrl || "";
    if (url) {
      img.src = url;
      img.alt = "Deck photo";
      wrap.style.display = "block";
    } else {
      wrap.style.display = "none";
      img.removeAttribute("src");
    }
  }

  function setDeckViewMode(editing) {
    $("deck-dynamic-root").style.display = editing ? "none" : "block";
    $("deck-edit-panel").style.display = editing ? "block" : "none";
    if (editing) updateDeckEditPhoto();
    if (editing) {
      $("modal-edit-cards-btn").style.display = "none";
      if ($("modal-claim-deck-btn")) $("modal-claim-deck-btn").style.display = "none";
      if ($("modal-delete-deck-btn")) $("modal-delete-deck-btn").style.display = "none";
      if ($("modal-reprocess-deck-btn")) $("modal-reprocess-deck-btn").style.display = "none";
    } else {
      updateModalActionButtons();
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
      credentials: "include",
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
          $("deck-edit-message").textContent = data?.error ? data.error : "Save failed (HTTP " + res.status + ")";
          $("deck-edit-message").className = "deck-edit-message error";
          return;
        }
        if (!data.success) {
          $("deck-edit-message").textContent = data?.error ? data.error : "Save failed.";
          $("deck-edit-message").className = "deck-edit-message error";
          return;
        }
        var nf = data.not_found || [];
        var msg = "Saved.";
        if (nf.length) {
          msg +=
            " " + nf.length + " name(s) could not be matched on Scryfall \u2014 those lines were stored as plain text.";
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

  function deckRowById(deckId) {
    var id = String(deckId || "");
    for (var i = 0; i < deckListSnapshot.length; i++) {
      if (String(deckListSnapshot[i].deck_id) === id) return deckListSnapshot[i];
    }
    return null;
  }

  function pilotLabelForDeck(deckId) {
    var row = deckRowById(deckId);
    if (row?.pilot_name) return String(row.pilot_name);
    if (deckEditContext.deckId && String(deckEditContext.deckId) === String(deckId)) {
      var title = $("modal-title")?.textContent || "";
      var dash = title.indexOf(" \u2014 ");
      if (dash > 0) return title.slice(0, dash);
    }
    return "";
  }

  function openDeckConfirm(action, deckId) {
    if (!deckId) return;
    if (action === "claim" && !loggedInUser) return;
    pendingDeckAction = { action: action, deckId: String(deckId) };
    var pilot = pilotLabelForDeck(deckId);
    var pilotPhrase = pilot ? ' for "' + pilot + '"' : "";
    var title = $("deck-confirm-title");
    var body = $("deck-confirm-body");
    var okBtn = $("deck-confirm-ok");
    if (title && body && okBtn) {
      okBtn.className = "btn-primary";
      if (action === "claim") {
        title.textContent = "Claim this deck?";
        okBtn.textContent = "Claim";
        if (pilot) {
          body.textContent =
            "Claim the deck uploaded as " +
            pilot +
            "? It will be linked to your account (" +
            loggedInUser.username +
            ") and only you will be able to edit its card list.";
        } else {
          body.textContent =
            "This deck will be linked to your account (" +
            loggedInUser.username +
            "). You will be able to edit its card list; others will not.";
        }
      } else if (action === "delete") {
        title.textContent = "Delete this deck?";
        okBtn.textContent = "Delete";
        okBtn.className = "btn-confirm-danger";
        body.textContent =
          "Permanently delete this deck" +
          pilotPhrase +
          " from the database? All card data will be removed. This cannot be undone.";
      } else if (action === "reprocess") {
        title.textContent = "Re-process this deck?";
        okBtn.textContent = "Re-process";
        body.textContent =
          "Re-run vision extraction on the saved deck photo" +
          pilotPhrase +
          "? The current card list will be removed and replaced when processing completes.";
      }
    }
    var overlay = $("deck-confirm-overlay");
    if (overlay) {
      overlay.classList.add("is-open");
      overlay.setAttribute("aria-hidden", "false");
    }
    if (okBtn) okBtn.focus();
  }

  function closeDeckConfirm() {
    pendingDeckAction = null;
    var overlay = $("deck-confirm-overlay");
    if (overlay) {
      overlay.classList.remove("is-open");
      overlay.setAttribute("aria-hidden", "true");
    }
    var okBtn = $("deck-confirm-ok");
    if (okBtn) okBtn.className = "btn-primary";
  }

  function executeDeckAction(action, deckId) {
    if (!deckId || !action) return;
    var confirmBtn = $("deck-confirm-ok");
    if (confirmBtn) confirmBtn.disabled = true;

    var url = "/api/deck/" + encodeURIComponent(deckId);
    var opts = { method: "POST", credentials: "include" };
    if (action === "claim") {
      url += "/claim";
    } else if (action === "delete") {
      opts.method = "DELETE";
    } else if (action === "reprocess") {
      url += "/reprocess";
    }

    fetch(url, opts)
      .then(function (r) {
        return r
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            return { ok: r.ok, data: data };
          });
      })
      .then(function (res) {
        if (confirmBtn) confirmBtn.disabled = false;
        closeDeckConfirm();
        if (!res.ok) {
          var err =
            res.data?.error ||
            (action === "delete"
              ? "Could not delete deck."
              : action === "reprocess"
                ? "Could not re-process deck."
                : "Could not claim deck.");
          alert(err);
          return;
        }
        if (action === "delete") {
          closeModal();
          loadDecks();
          return;
        }
        if (action === "reprocess") {
          closeModal();
          loadDecks();
          refreshProcessingStatus();
          return;
        }
        if (deckEditContext.deckId && String(deckEditContext.deckId) === String(deckId)) {
          openDeck(deckId);
        }
        loadDecks();
      })
      .catch(function (err) {
        if (confirmBtn) confirmBtn.disabled = false;
        console.error(err);
        alert("Network error.");
      });
  }

  function requestClaimDeck() {
    if (!deckEditContext.deckId) return;
    openDeckConfirm("claim", deckEditContext.deckId);
  }

  function requestDeleteDeck() {
    if (!deckEditContext.deckId) return;
    openDeckConfirm("delete", deckEditContext.deckId);
  }

  function requestReprocessDeck() {
    if (!deckEditContext.deckId) return;
    openDeckConfirm("reprocess", deckEditContext.deckId);
  }

  function closeModal() {
    deckEditContext.deckId = null;
    deckEditContext.names = [];
    deckEditContext.permissions = null;
    deckEditContext.photoUrl = "";
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
    if (!Number.isFinite(n) || n < 0) n = 0;
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
    for (var bucketIdx = 0; bucketIdx <= 6; bucketIdx++) {
      html += '<div class="curve-col">' + "<h4>MV " + bucketLabel(bucketIdx) + "</h4>" + '<ul class="curve-list">';
      if (buckets[bucketIdx].length === 0) {
        html += '<li style="color:#999;">\u2014</li>';
      } else {
        for (var li = 0; li < buckets[bucketIdx].length; li++) {
          var curveEntry = buckets[bucketIdx][li];
          var prefix = curveEntry.count > 1 ? curveEntry.count + "x " : "";
          var nameHtml = window.CW ? CW.cardNameHtml(curveEntry.name, curveEntry.image_url) : curveEntry.name;
          html += '<li title="">' + prefix + nameHtml + "</li>";
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
    if ($("modal-claim-deck-btn")) $("modal-claim-deck-btn").style.display = "none";
    if ($("modal-delete-deck-btn")) $("modal-delete-deck-btn").style.display = "none";
    if ($("modal-reprocess-deck-btn")) $("modal-reprocess-deck-btn").style.display = "none";
    openModal();

    fetch("/api/deck/" + encodeURIComponent(deckId), { credentials: "include" })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data.error) {
          $("deck-dynamic-root").innerHTML = '<div class="error">' + escapeHtmlText(data.error || "Error") + "</div>";
          return;
        }
        var deck = data.deck || {};
        var deckStats = data.deck_stats || null;
        var cards = data.cards || [];

        deckEditContext.deckId = deckId;
        deckEditContext.permissions = data.permissions || { can_edit: true, can_claim: false };
        var ordered = data.card_names_ordered;
        if (!ordered?.length && cards.length) {
          ordered = cards.map(function (c) {
            return c.name;
          });
        }
        deckEditContext.names = ordered || [];
        deckEditContext.photoUrl = deck.deck_photo_url || "";

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
        updateModalActionButtons();

        if (deckStats?.processing_notes) {
          try {
            var notes = JSON.parse(deckStats.processing_notes);
            var nf = notes?.not_found ? notes.not_found : [];
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
          } catch (_e) {
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
      if (e.key !== "Escape") return;
      if ($("deck-confirm-overlay")?.classList.contains("is-open")) {
        closeDeckConfirm();
        return;
      }
      closeModal();
    });

    $("modal-edit-cards-btn").addEventListener("click", function () {
      $("deck-edit-textarea").value = (deckEditContext.names || []).join("\n");
      setDeckViewMode(true);
    });
    if ($("modal-claim-deck-btn")) {
      $("modal-claim-deck-btn").addEventListener("click", requestClaimDeck);
    }
    if ($("modal-delete-deck-btn")) {
      $("modal-delete-deck-btn").addEventListener("click", requestDeleteDeck);
    }
    if ($("modal-reprocess-deck-btn")) {
      $("modal-reprocess-deck-btn").addEventListener("click", requestReprocessDeck);
    }
    if ($("deck-confirm-cancel")) {
      $("deck-confirm-cancel").addEventListener("click", closeDeckConfirm);
    }
    if ($("deck-confirm-ok")) {
      $("deck-confirm-ok").addEventListener("click", function () {
        if (pendingDeckAction) executeDeckAction(pendingDeckAction.action, pendingDeckAction.deckId);
      });
    }
    if ($("deck-confirm-overlay")) {
      $("deck-confirm-overlay").addEventListener("click", function (e) {
        if (e.target === this) closeDeckConfirm();
      });
    }
    $("deck-edit-cancel").addEventListener("click", function () {
      setDeckViewMode(false);
    });
    $("deck-edit-save").addEventListener("click", saveDeckCardEdits);
  }

  function boot() {
    try {
      currentCubeId = getCubeFromUrl() || localStorage.getItem("selectedCubeId") || "";
    } catch (_e) {
      currentCubeId = getCubeFromUrl() || "";
    }
    setHedronSyncUiState();
    if (currentCubeId) {
      try {
        localStorage.setItem("selectedCubeId", currentCubeId);
      } catch (_e2) {}
      try {
        if (window.CWPaths && CWPaths.decksPathMatches) {
          if (!CWPaths.decksPathMatches(currentCubeId)) {
            window.history.replaceState({}, "", CWPaths.mergeCurrentPathPrefixWith(CWPaths.decks(currentCubeId)));
          }
        }
      } catch (_e3) {}
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
          } catch (_eSync) {}
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
          } catch (_e4) {}
          try {
            if (window.CWPaths) {
              window.history.replaceState({}, "", CWPaths.mergeCurrentPathPrefixWith(CWPaths.decks(v)));
            }
          } catch (_e5) {}
          if (window.cubeWizardRefreshNavLinks) window.cubeWizardRefreshNavLinks();
          closeModal();
          clearError();
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
    clearError();
    loadDecks();
  }

  function onAuthReady(user) {
    loggedInUser = user || null;
    if (currentCubeId) loadDecks();
  }

  function bindErrorUi() {
    var btn = $("error-dismiss");
    if (btn) btn.addEventListener("click", clearError);
  }

  function init() {
    bindErrorUi();
    bindModalUi();
    ensureDeckTableSortDelegation();
    if (window.CWAuth && typeof CWAuth.onReady === "function") {
      CWAuth.onReady(onAuthReady);
    }
    try {
      var btn = $("hedron-sync-btn");
      if (btn) btn.addEventListener("click", triggerHedronSync);
    } catch (_eBtn) {}
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
