/**
 * Card name hover: shows Scryfall art preview when data-cw-img is set.
 * Requires card-tooltip.css. Image URL typically comes from deck_cards.image_uris (worker).
 */
(function () {
  var tooltip = null;
  var active = false;

  function escText(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Only http(s) image URLs (blocks javascript: and other schemes in tooltip img src). */
  function safeHttpImageUrl(raw) {
    var s = String(raw || "").trim();
    if (!s) return "";
    try {
      var u = new URL(s, window.location.href);
      if (u.protocol === "https:" || u.protocol === "http:") return u.href;
    } catch (e) {}
    return "";
  }

  function getTooltip() {
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.id = "cw-card-tooltip";
      tooltip.setAttribute("role", "tooltip");
      var im = document.createElement("img");
      im.alt = "";
      tooltip.appendChild(im);
      document.body.appendChild(tooltip);
    }
    return tooltip;
  }

  function position(ev) {
    var t = getTooltip();
    var pad = 12;
    var x = ev.clientX + pad;
    var y = ev.clientY + pad;
    t.style.display = "block";
    var w = t.offsetWidth;
    var h = t.offsetHeight;
    if (x + w > window.innerWidth - 8) x = window.innerWidth - w - 8;
    if (y + h > window.innerHeight - 8) y = ev.clientY - h - pad;
    if (y < 8) y = 8;
    if (x < 8) x = 8;
    t.style.left = x + "px";
    t.style.top = y + "px";
  }

  function hide() {
    active = false;
    if (tooltip) tooltip.style.display = "none";
  }

  window.CW = window.CW || {};
  /**
   * @param {string} name
   * @param {string|null|undefined} imageUrl
   */
  window.CW.cardNameHtml = function (name, imageUrl) {
    var n = escText(name || "");
    if (!imageUrl) return n;
    var u = encodeURIComponent(String(imageUrl));
    return '<span class="cw-card-name" data-cw-img="' + u + '">' + n + "</span>";
  };

  document.addEventListener(
    "mouseover",
    function (ev) {
      var el = ev.target.closest && ev.target.closest(".cw-card-name[data-cw-img]");
      if (!el) return;
      var enc = el.getAttribute("data-cw-img");
      if (!enc) return;
      var decoded;
      try {
        decoded = decodeURIComponent(enc);
      } catch (e) {
        decoded = enc;
      }
      var url = safeHttpImageUrl(decoded);
      if (!url) return;
      active = true;
      var t = getTooltip();
      t.querySelector("img").src = url;
      t.style.display = "block";
      position(ev);
    },
    true
  );

  document.addEventListener(
    "mousemove",
    function (ev) {
      if (!active) return;
      var t = getTooltip();
      if (t.style.display === "none") return;
      position(ev);
    },
    true
  );

  document.addEventListener(
    "mouseout",
    function (ev) {
      var el = ev.target.closest && ev.target.closest(".cw-card-name[data-cw-img]");
      if (!el) return;
      var rel = ev.relatedTarget;
      if (rel && el.contains(rel)) return;
      hide();
    },
    true
  );
})();
