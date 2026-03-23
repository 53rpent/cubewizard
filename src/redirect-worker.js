/**
 * CubeWizard Redirect Worker
 *
 * Serves a short "we've moved" page for cubewizard.org,
 * then auto-redirects to cube-wizard.com after 5 seconds.
 * Also handles direct redirects for API calls.
 */

export default {
  async fetch(request) {
    var url = new URL(request.url);

    // API calls and non-HTML requests get an immediate 301
    if (url.pathname.startsWith("/api/") || !requestAcceptsHtml(request)) {
      var target = "https://cube-wizard.com" + url.pathname + url.search;
      return Response.redirect(target, 301);
    }

    // Browser visits get the friendly "we've moved" page
    var destination = "https://cube-wizard.com" + url.pathname + url.search;

    var html = '<!DOCTYPE html>\n' +
      '<html lang="en">\n' +
      '<head>\n' +
      '  <meta charset="UTF-8">\n' +
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '  <meta http-equiv="refresh" content="5;url=' + escapeAttr(destination) + '">\n' +
      '  <title>CubeWizard has moved!</title>\n' +
      '  <link rel="icon" type="image/png" href="https://cube-wizard.com/CubeWizard.png">\n' +
      '  <style>\n' +
      '    * { margin: 0; padding: 0; box-sizing: border-box; }\n' +
      '    body {\n' +
      '      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;\n' +
      '      background: #f5f5f5;\n' +
      '      color: #333;\n' +
      '      display: flex;\n' +
      '      align-items: center;\n' +
      '      justify-content: center;\n' +
      '      min-height: 100vh;\n' +
      '    }\n' +
      '    .card {\n' +
      '      background: white;\n' +
      '      border-radius: 12px;\n' +
      '      padding: 3rem;\n' +
      '      box-shadow: 0 4px 20px rgba(0,0,0,0.1);\n' +
      '      text-align: center;\n' +
      '      max-width: 500px;\n' +
      '    }\n' +
      '    .logo { width: 80px; height: 80px; margin-bottom: 1rem; }\n' +
      '    h1 {\n' +
      '      color: #667eea;\n' +
      '      font-size: 1.5rem;\n' +
      '      margin-bottom: 0.75rem;\n' +
      '    }\n' +
      '    p {\n' +
      '      color: #666;\n' +
      '      line-height: 1.6;\n' +
      '      margin-bottom: 1rem;\n' +
      '    }\n' +
      '    a {\n' +
      '      display: inline-block;\n' +
      '      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);\n' +
      '      color: white;\n' +
      '      padding: 0.75rem 2rem;\n' +
      '      border-radius: 6px;\n' +
      '      text-decoration: none;\n' +
      '      font-weight: 600;\n' +
      '      transition: opacity 0.2s;\n' +
      '    }\n' +
      '    a:hover { opacity: 0.9; }\n' +
      '    .countdown {\n' +
      '      font-size: 0.85rem;\n' +
      '      color: #999;\n' +
      '      margin-top: 1rem;\n' +
      '    }\n' +
      '  </style>\n' +
      '</head>\n' +
      '<body>\n' +
      '  <div class="card">\n' +
      '    <img src="https://cube-wizard.com/CubeWizard.png" alt="CubeWizard" class="logo">\n' +
      '    <h1>CubeWizard has a new home!</h1>\n' +
      '    <p>We&rsquo;ve moved from <strong>cubewizard.org</strong> to<br><strong>cube-wizard.com</strong></p>\n' +
      '    <p>Please update your bookmarks.</p>\n' +
      '    <a href="' + escapeAttr(destination) + '">Go to cube-wizard.com &rarr;</a>\n' +
      '    <p class="countdown">Redirecting automatically in <span id="t">5</span> seconds&hellip;</p>\n' +
      '  </div>\n' +
      '  <script>\n' +
      '    var s = 5;\n' +
      '    var el = document.getElementById("t");\n' +
      '    setInterval(function() {\n' +
      '      s--;\n' +
      '      if (s <= 0) { window.location.href = "' + escapeJs(destination) + '"; }\n' +
      '      else { el.textContent = s; }\n' +
      '    }, 1000);\n' +
      '  </script>\n' +
      '</body>\n' +
      '</html>';

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html;charset=UTF-8",
        "Link": '<' + destination + '>; rel="canonical"',
      },
    });
  },
};

function requestAcceptsHtml(request) {
  var accept = request.headers.get("Accept") || "";
  return accept.indexOf("text/html") !== -1;
}

function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeJs(str) {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/'/g, "\\'");
}
