/**
 * Sets data-view and deck links in the shared header from URL or localStorage.
 * Requires cw-paths.js (CWPaths).
 */
(function () {
  function cubeIdFromPreferred() {
    if (!window.CWPaths || typeof CWPaths.preferredCubeId !== "function") return "";
    return CWPaths.preferredCubeId() || "";
  }

  function cubeIdFromUrl() {
    if (window.CWPaths) {
      var parsed = CWPaths.parsePathname(window.location.pathname);
      if (parsed.cubeId) return parsed.cubeId;
    }
    var params = new URLSearchParams(window.location.search);
    return params.get("cube") || "";
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
      return localStorage.getItem("selectedCubeId") || "";
    } catch (_e3) {
      return "";
    }
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
      anchor.href = href;
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
    var homeOrDash = CWPaths.safeAppPath(id ? CWPaths.dashboard(id) : CWPaths.home());
    if (dash) dash.href = homeOrDash;
    if (brand) brand.href = homeOrDash;

    var viewLinks = document.querySelectorAll("a.js-data-view-link[data-data-view]");
    for (var i = 0; i < viewLinks.length; i++) {
      var a = viewLinks[i];
      var v = a.getAttribute("data-data-view");
      setNavAnchorState(a, !!(id && v), hrefForDataView(id, v));
    }

    var deckLinks = document.querySelectorAll("a.js-decks-link");
    for (var j = 0; j < deckLinks.length; j++) {
      var d = deckLinks[j];
      setNavAnchorState(d, !!id, CWPaths.safeAppPath(CWPaths.decks(id)));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyNavLinks);
  } else {
    applyNavLinks();
  }

  window.cubeWizardRefreshNavLinks = applyNavLinks;
})();
