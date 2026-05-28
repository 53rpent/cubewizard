(function () {
  function trimApiField(data, key) {
    if (!data || data[key] === undefined || data[key] === null) return "";
    return String(data[key]).trim();
  }

  function applyVersionPayload(data, line, el) {
    var v = trimApiField(data, "version");
    var env = trimApiField(data, "environment");
    var parts = [];
    if (v) parts.push("Version " + v);
    if (env) parts.push(env);
    if (parts.length === 0) {
      line.hidden = true;
      return;
    }
    el.textContent = parts.join(" · ");
    line.hidden = false;
  }

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
        applyVersionPayload(data, line, el);
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
