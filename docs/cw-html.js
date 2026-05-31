/**
 * Shared HTML escaping for CubeWizard static pages.
 */
(function (global) {
  function escapeHtmlAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function escapeHtmlText(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  var api = { escapeHtmlAttr: escapeHtmlAttr, escapeHtmlText: escapeHtmlText };
  global.CWHtml = api;
  if (global.CW) {
    global.CW.escapeHtmlAttr = escapeHtmlAttr;
    global.CW.escapeHtmlText = escapeHtmlText;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
