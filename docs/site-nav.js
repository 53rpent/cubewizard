/**
 * Sets analysis and deck links in the shared header from URL or localStorage.
 * Requires cw-paths.js (CWPaths).
 */
(function () {
  function cubeIdForNav() {
    try {
      if (window.CWPaths && typeof CWPaths.preferredCubeId === "function") {
        return CWPaths.preferredCubeId() || "";
      }
    } catch (e) {}
    try {
      if (window.CWPaths) {
        var parsed = CWPaths.parsePathname(window.location.pathname);
        if (parsed.cubeId) return parsed.cubeId;
      }
      var params = new URLSearchParams(window.location.search);
      var c = params.get("cube");
      if (c) return c;
    } catch (e2) {}
    try {
      return localStorage.getItem("selectedCubeId") || "";
    } catch (e3) {
      return "";
    }
  }

  function applyNavLinks() {
    if (!window.CWPaths) return;
    var id = cubeIdForNav();
    var dash = document.getElementById("nav-dashboard-trigger");
    var brand = document.querySelector(".header-brand-link");
    var homeOrDash = id ? CWPaths.dashboard(id) : CWPaths.home();
    if (dash) dash.href = homeOrDash;
    if (brand) brand.href = homeOrDash;
    var links = document.querySelectorAll("a.js-analysis-link[data-analysis-type]");
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var t = a.getAttribute("data-analysis-type");
      if (id) {
        a.href = CWPaths.analysis(id, t);
        a.classList.remove("is-disabled");
        a.removeAttribute("aria-disabled");
        a.removeAttribute("title");
        a.tabIndex = 0;
      } else {
        a.href = "#";
        a.classList.add("is-disabled");
        a.setAttribute("aria-disabled", "true");
        a.removeAttribute("title");
        a.tabIndex = -1;
      }
    }
    var deckLinks = document.querySelectorAll("a.js-decks-link");
    for (var j = 0; j < deckLinks.length; j++) {
      var d = deckLinks[j];
      if (id) {
        d.href = CWPaths.decks(id);
        d.classList.remove("is-disabled");
        d.removeAttribute("aria-disabled");
        d.removeAttribute("title");
        d.tabIndex = 0;
      } else {
        d.href = "#";
        d.classList.add("is-disabled");
        d.setAttribute("aria-disabled", "true");
        d.removeAttribute("title");
        d.tabIndex = -1;
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyNavLinks);
  } else {
    applyNavLinks();
  }

  window.cubeWizardRefreshNavLinks = applyNavLinks;
})();
