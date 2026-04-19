(function () {
  function fillFooterVersion() {
    var line = document.getElementById("cw-footer-version-line");
    var el = document.getElementById("cw-footer-version");
    if (!line || !el) return;
    fetch("/api/version")
      .then(function (r) {
        if (!r.ok) throw new Error("bad status");
        return r.json();
      })
      .then(function (data) {
        var v =
          data && data.version !== undefined && data.version !== null
            ? String(data.version).trim()
            : "";
        var env =
          data && data.environment !== undefined && data.environment !== null
            ? String(data.environment).trim()
            : "";
        var parts = [];
        if (v) parts.push("Version " + v);
        if (env) parts.push(env);
        if (parts.length === 0) {
          line.hidden = true;
          return;
        }
        el.textContent = parts.join(" · ");
        line.hidden = false;
      })
      .catch(function () {
        line.hidden = true;
      });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fillFooterVersion);
  } else {
    fillFooterVersion();
  }
})();
