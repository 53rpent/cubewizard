/**
 * CubeWizard path helpers: /[cube_id], /[cube_id]/decks, /[cube_id]/analysis/[type], /submit, /addcube
 */
(function (global) {
  /** First path segments that are site routes, not CubeCobra cube ids (also block these as stored "cube" ids). */
  var RESERVED_FIRST = {
    submit: 1,
    addcube: 1,
    add_cube: 1,
    api: 1,
    decks: 1,
    analysis: 1,
  };

  function isReservedSegment(seg) {
    if (seg === undefined || seg === null || seg === "") return false;
    return !!RESERVED_FIRST[String(seg).toLowerCase()];
  }

  function encSeg(s) {
    return encodeURIComponent(String(s));
  }

  global.CWPaths = {
    home: function () {
      return "/";
    },
    dashboard: function (cubeId) {
      var c = String(cubeId || "").trim();
      if (!c || isReservedSegment(c)) return "/";
      return "/" + encSeg(c);
    },
    analysis: function (cubeId, type) {
      var c = String(cubeId || "").trim();
      if (!c || isReservedSegment(c)) return "/";
      return "/" + encSeg(c) + "/analysis/" + encSeg(type);
    },
    decks: function (cubeId) {
      var c = String(cubeId || "").trim();
      if (!c || isReservedSegment(c)) return "/";
      return "/" + encSeg(c) + "/decks";
    },
    submit: function () {
      return "/submit";
    },
    addCube: function () {
      return "/addcube";
    },
    /**
     * @returns {{ cubeId?: string, view?: string, analysisType?: string, route?: string }}
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
          return { cubeId: decodeURIComponent(seg0).trim() };
        } catch (e) {
          return { cubeId: String(seg0).trim() };
        }
      }
      if (parts.length === 2 && parts[1] === "decks") {
        if (isReservedSegment(seg0)) return {};
        try {
          return { cubeId: decodeURIComponent(seg0).trim(), view: "decks" };
        } catch (e2) {
          return { cubeId: String(seg0).trim(), view: "decks" };
        }
      }
      if (parts.length === 3 && parts[1] === "analysis") {
        if (isReservedSegment(seg0)) return {};
        var at = String(parts[2] || "")
          .toLowerCase()
          .trim();
        if (/^(performance|color|synergies)$/.test(at)) {
          try {
            return {
              cubeId: decodeURIComponent(seg0).trim(),
              view: "analysis",
              analysisType: at,
            };
          } catch (e3) {
            return {
              cubeId: String(seg0).trim(),
              view: "analysis",
              analysisType: at,
            };
          }
        }
      }
      return {};
    },
    /**
     * Cube id from URL path, then ?cube=, then localStorage (selectedCubeId).
     */
    preferredCubeId: function () {
      var parsed = this.parsePathname(window.location.pathname);
      var id = parsed.cubeId || "";
      if (!id) {
        try {
          var q = new URLSearchParams(window.location.search).get("cube");
          if (q) id = String(q).trim();
        } catch (e) {}
      }
      if (!id) {
        try {
          id = (localStorage.getItem("selectedCubeId") || "").trim();
        } catch (e2) {
          id = "";
        }
      }
      if (id && isReservedSegment(id)) {
        try {
          localStorage.removeItem("selectedCubeId");
        } catch (e4) {}
        id = "";
      }
      if (id) {
        try {
          localStorage.setItem("selectedCubeId", id);
        } catch (e3) {}
      }
      return id;
    },
    /**
     * Select an option by value without CSS selector parsing (cube ids may contain ".", ":", etc.).
     */
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
    /**
     * True if window.location.pathname matches a canonical path string (encoding-insensitive per segment).
     */
    pathMatchesCanonical: function (canonicalPath) {
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
        if (hp.length !== wp.length) return false;
        for (var i = 0; i < hp.length; i++) {
          if (dec(hp[i]) !== dec(wp[i])) return false;
        }
        return true;
      } catch (e2) {
        return false;
      }
    },
    analysisPathMatches: function (cubeId, analysisType) {
      return this.pathMatchesCanonical(
        this.analysis(String(cubeId).trim(), String(analysisType).toLowerCase().trim())
      );
    },
    decksPathMatches: function (cubeId) {
      return this.pathMatchesCanonical(this.decks(String(cubeId).trim()));
    },
  };
})(typeof window !== "undefined" ? window : this);
