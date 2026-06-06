/**
 * Sets data-view and deck links in the shared header from URL or localStorage.
 * Requires cw-paths.js (CWPaths).
 */
(function () {
  function cubeIdFromPreferred() {
    if (!window.CWPaths || typeof CWPaths.preferredCubeId !== "function") return "";
    return CWPaths.preferredCubeId() || "";
  }

  function normalizeNavCubeId(raw) {
    if (window.CWPaths && typeof CWPaths.normalizeCubeId === "function") {
      return CWPaths.normalizeCubeId(raw) || "";
    }
    return String(raw || "").trim();
  }

  function cubeIdFromUrl() {
    if (window.CWPaths) {
      var parsed = CWPaths.parsePathname(window.location.pathname);
      if (parsed.cubeId) return parsed.cubeId;
    }
    var params = new URLSearchParams(window.location.search);
    return normalizeNavCubeId(params.get("cube") || "");
  }

  function cubeIdForNav() {
    try {
      var fromPreferred = cubeIdFromPreferred();
      if (fromPreferred) return fromPreferred;
    } catch (_e) {}
    try {
      var fromUrl = cubeIdFromUrl();
      if (fromUrl) return fromUrl;
    } catch (_e2) {}
    try {
      return normalizeNavCubeId(localStorage.getItem("selectedCubeId") || "");
    } catch (_e3) {
      return "";
    }
  }

  /** Same-origin relative path only — blocks open redirects and non-path href values. */
  function sanitizeNavHref(href) {
    if (window.CWPaths && typeof CWPaths.safeAppPath === "function") {
      return CWPaths.safeAppPath(href);
    }
    var p = String(href || "").trim();
    if (p.charAt(0) !== "/" || p.indexOf("//") === 0) return "#";
    return p;
  }

  function hrefForDataView(id, view) {
    if (!window.CWPaths || !id) return "#";
    var v = String(view || "")
      .toLowerCase()
      .trim();
    if (!CWPaths.DATA_VIEWS?.[v]) return "#";
    return CWPaths.safeAppPath(CWPaths.dataPath(id, v));
  }

  function setNavAnchorState(anchor, enabled, href) {
    if (enabled) {
      anchor.setAttribute("href", sanitizeNavHref(href));
      anchor.classList.remove("is-disabled");
      anchor.removeAttribute("aria-disabled");
      anchor.removeAttribute("title");
      anchor.tabIndex = 0;
      return;
    }
    anchor.href = "#";
    anchor.classList.add("is-disabled");
    anchor.setAttribute("aria-disabled", "true");
    anchor.removeAttribute("title");
    anchor.tabIndex = -1;
  }

  function applyNavLinks() {
    if (!window.CWPaths) return;
    var id = cubeIdForNav();
    var dash = document.getElementById("nav-dashboard-trigger");
    var brand = document.querySelector(".header-brand-link");
    var homeOrDash = sanitizeNavHref(id ? CWPaths.dashboard(id) : CWPaths.home());
    if (dash) dash.setAttribute("href", homeOrDash);
    if (brand) brand.setAttribute("href", homeOrDash);

    var viewLinks = document.querySelectorAll("a.js-data-view-link[data-data-view]");
    for (var i = 0; i < viewLinks.length; i++) {
      var a = viewLinks[i];
      var v = a.getAttribute("data-data-view");
      setNavAnchorState(a, !!(id && v), hrefForDataView(id, v));
    }

    var deckLinks = document.querySelectorAll("a.js-decks-link");
    for (var j = 0; j < deckLinks.length; j++) {
      var d = deckLinks[j];
      setNavAnchorState(d, !!id, CWPaths.decks(id));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyNavLinks);
  } else {
    applyNavLinks();
  }

  window.cubeWizardRefreshNavLinks = applyNavLinks;
})();
