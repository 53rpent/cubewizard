/**
 * CubeWizard path helpers:
 * /[cube_id], /[cube_id]/decks, /[cube_id]/cards, /[cube_id]/colors, /[cube_id]/synergies
 * Legacy /[cube_id]/analysis/{performance|color|synergies} is still parsed for client-side canonicalization.
 */
(function (global) {
  /** First path segments that are site routes, not cube ids (also block these as stored "cube" ids). */
  var RESERVED_FIRST = {
    submit: 1,
    addcube: 1,
    add_cube: 1,
    resources: 1,
    api: 1,
    decks: 1,
    analysis: 1,
    cards: 1,
    colors: 1,
    synergies: 1,
    /** Static HTML basenames if assets redirect here; never treat as cube id */
    "analysis-card": 1,
    "analysis-color": 1,
    "analysis-synergy": 1,
    "analysis-card.html": 1,
    "analysis-color.html": 1,
    "analysis-synergy.html": 1,
  };

  /** Second segment for /cube/<view> data pages. */
  var DATA_VIEWS = {
    decks: 1,
    cards: 1,
    colors: 1,
    synergies: 1,
  };

  /** Cube ids from URL, query, or storage (letters, digits, hyphen, underscore). */
  var CUBE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

  function normalizeCubeId(raw) {
    var id = String(raw || "").trim();
    if (!id || isReservedSegment(id)) return "";
    if (!CUBE_ID_RE.test(id)) return "";
    return id;
  }

  /** Same-origin relative path only (blocks open redirects via `//` or schemes). */
  function safeAppPath(path) {
    var p = String(path || "").trim();
    if (!p || p.charAt(0) !== "/" || p.indexOf("//") === 0) return "/";
    if (/[\x00-\x1f\x7f]/.test(p)) return "/";
    return p;
  }

  function isReservedSegment(seg) {
    if (seg === undefined || seg === null || seg === "") return false;
    return !!RESERVED_FIRST[String(seg).toLowerCase()];
  }

  function encSeg(s) {
    return encodeURIComponent(String(s));
  }

  function decSeg(s) {
    try {
      return decodeURIComponent(String(s));
    } catch (e) {
      return String(s);
    }
  }

  function cubePath(cubeId, tail) {
    var c = normalizeCubeId(cubeId);
    if (!c) return "/";
    return "/" + encSeg(c) + tail;
  }

  global.CWPaths = {
    normalizeCubeId: normalizeCubeId,
    safeAppPath: safeAppPath,
    DATA_VIEWS: DATA_VIEWS,
    home: function () {
      return "/";
    },
    dashboard: function (cubeId) {
      var c = normalizeCubeId(cubeId);
      if (!c) return "/";
      return safeAppPath("/" + encSeg(c));
    },
    /** @param {'decks'|'cards'|'colors'|'synergies'} view */
    dataPath: function (cubeId, view) {
      var v = String(view || "").toLowerCase().trim();
      if (!DATA_VIEWS[v]) return "/";
      return safeAppPath(cubePath(cubeId, "/" + v));
    },
    decks: function (cubeId) {
      return this.dataPath(cubeId, "decks");
    },
    cards: function (cubeId) {
      return this.dataPath(cubeId, "cards");
    },
    colors: function (cubeId) {
      return this.dataPath(cubeId, "colors");
    },
    synergies: function (cubeId) {
      return this.dataPath(cubeId, "synergies");
    },
    /** @deprecated Use cards/colors/synergies; kept for any stale references */
    analysis: function (cubeId, type) {
      var t = String(type || "").toLowerCase().trim();
      if (t === "performance") return this.cards(cubeId);
      if (t === "color") return this.colors(cubeId);
      if (t === "synergies") return this.synergies(cubeId);
      return this.cards(cubeId);
    },
    submit: function () {
      return "/submit";
    },
    addCube: function () {
      return "/addcube";
    },
    /**
     * @returns {{ cubeId?: string, dataView?: string, route?: string, legacyAnalysisType?: string }}
     */
    parsePathname: function (pathname) {
      var p = String(pathname || "").replace(/\/+$/, "") || "/";
      if (p === "/") return {};
      if (p === "/submit") return { route: "submit" };
      if (p === "/addcube" || p === "/add_cube") return { route: "addcube" };
      var parts = p.split("/").filter(Boolean);
      if (parts.length === 0) return {};
      var seg0 = parts[0];
      if (parts.length === 1 && RESERVED_FIRST[seg0.toLowerCase()]) return {};
      if (parts.length === 1) {
        try {
          return { cubeId: normalizeCubeId(decSeg(seg0)) };
        } catch (e) {
          return { cubeId: normalizeCubeId(seg0) };
        }
      }
      if (parts.length === 2) {
        var seg1 = String(parts[1]).toLowerCase();
        if (DATA_VIEWS[seg1]) {
          if (isReservedSegment(seg0)) return {};
          try {
            return { cubeId: normalizeCubeId(decSeg(seg0)), dataView: seg1 };
          } catch (e2) {
            return { cubeId: normalizeCubeId(seg0), dataView: seg1 };
          }
        }
      }
      if (parts.length === 3 && String(parts[1]).toLowerCase() === "analysis") {
        if (isReservedSegment(seg0)) return {};
        var at = String(parts[2] || "")
          .toLowerCase()
          .trim();
        var legacyMap = { performance: "cards", color: "colors", synergies: "synergies" };
        if (legacyMap[at]) {
          try {
            return {
              cubeId: normalizeCubeId(decSeg(seg0)),
              dataView: legacyMap[at],
              legacyAnalysisType: at,
            };
          } catch (e3) {
            return {
              cubeId: normalizeCubeId(seg0),
              dataView: legacyMap[at],
              legacyAnalysisType: at,
            };
          }
        }
      }
      return {};
    },
    preferredCubeId: function () {
      var parsed = this.parsePathname(window.location.pathname);
      var id = parsed.cubeId || "";
      if (!id) {
        try {
          var q = new URLSearchParams(window.location.search).get("cube");
          if (q) id = normalizeCubeId(q);
        } catch (e) {}
      }
      if (!id) {
        try {
          id = normalizeCubeId(localStorage.getItem("selectedCubeId") || "");
        } catch (e2) {
          id = "";
        }
      }
      if (!id) {
        try {
          localStorage.removeItem("selectedCubeId");
        } catch (e4) {}
      } else {
        try {
          localStorage.setItem("selectedCubeId", id);
        } catch (e3) {}
      }
      return id;
    },
    setCubeSelectValue: function (selectEl, cubeId) {
      if (!selectEl || cubeId === undefined || cubeId === null || cubeId === "") return false;
      var id = String(cubeId).trim();
      var opts = selectEl.options;
      for (var i = 0; i < opts.length; i++) {
        if (String(opts[i].value).trim() === id) {
          selectEl.selectedIndex = i;
          return true;
        }
      }
      return false;
    },
    pathMatchesCanonical: function (canonicalPath) {
      return this.pathTailMatches(canonicalPath);
    },
    /** True if current pathname equals canonical or ends with the same tail segments. */
    pathTailMatches: function (canonicalPath) {
      function dec(s) {
        try {
          return decodeURIComponent(s);
        } catch (e) {
          return s;
        }
      }
      try {
        var want = String(canonicalPath || "").replace(/\/+$/, "") || "/";
        var have = String(window.location.pathname || "").replace(/\/+$/, "") || "/";
        if (have === want) return true;
        var hp = have.split("/").filter(Boolean);
        var wp = want.split("/").filter(Boolean);
        if (wp.length === 0) return false;
        if (hp.length < wp.length) return false;
        var off = hp.length - wp.length;
        for (var i = 0; i < wp.length; i++) {
          if (dec(hp[off + i]) !== dec(wp[i])) return false;
        }
        return true;
      } catch (e2) {
        return false;
      }
    },
    /** Prefix current pathname (e.g. /app) onto canonical /cube/cards when tails match. */
    mergeCurrentPathPrefixWith: function (canonicalPath) {
      var want = String(canonicalPath || "").replace(/\/+$/, "") || "/";
      var have = String(window.location.pathname || "").replace(/\/+$/, "") || "/";
      var wp = want.split("/").filter(Boolean);
      var hp = have.split("/").filter(Boolean);
      if (wp.length === 0 || hp.length < wp.length) return want;
      var off = hp.length - wp.length;
      for (var i = 0; i < wp.length; i++) {
        try {
          if (decodeURIComponent(hp[off + i]) !== decodeURIComponent(wp[i])) return want;
        } catch (e) {
          if (hp[off + i] !== wp[i]) return want;
        }
      }
      return (off > 0 ? "/" + hp.slice(0, off).join("/") : "") + want;
    },
    dataViewPathMatches: function (cubeId, dataView) {
      return this.pathTailMatches(this.dataPath(String(cubeId).trim(), String(dataView).toLowerCase().trim()));
    },
    /** @deprecated */
    analysisPathMatches: function (cubeId, analysisType) {
      var t = String(analysisType || "").toLowerCase().trim();
      var dv = t === "performance" ? "cards" : t === "color" ? "colors" : t === "synergies" ? "synergies" : "cards";
      return this.dataViewPathMatches(cubeId, dv);
    },
    decksPathMatches: function (cubeId) {
      return this.dataViewPathMatches(cubeId, "decks");
    },
  };
})(typeof window !== "undefined" ? window : this);
