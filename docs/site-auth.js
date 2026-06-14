/**
 * Optional account login/register — top-right nav control.
 * Requires cw-html.js on pages that render API errors into HTML (optional).
 */
(function () {
  var currentUser = null;
  var authLoaded = false;
  var authReadyCallbacks = [];

  function $(id) {
    return document.getElementById(id);
  }

  function onAuthReady(fn) {
    if (authLoaded) {
      fn(currentUser);
      return;
    }
    authReadyCallbacks.push(fn);
  }

  function notifyReady() {
    for (var i = 0; i < authReadyCallbacks.length; i++) {
      try {
        authReadyCallbacks[i](currentUser);
      } catch (e) {
        console.error(e);
      }
    }
    authReadyCallbacks = [];
  }

  function renderHeaderAuth() {
    var slot = $("header-auth-slot");
    if (!slot) return;
    slot.replaceChildren();
    if (currentUser) {
      var userSpan = document.createElement("span");
      userSpan.className = "header-auth-user";
      userSpan.textContent = currentUser.username;
      userSpan.title = currentUser.username;
      var logoutBtn = document.createElement("button");
      logoutBtn.type = "button";
      logoutBtn.className = "header-auth-logout";
      logoutBtn.textContent = "Log out";
      logoutBtn.addEventListener("click", doLogout);
      slot.appendChild(userSpan);
      slot.appendChild(logoutBtn);
    } else {
      var loginBtn = document.createElement("button");
      loginBtn.type = "button";
      loginBtn.className = "header-auth-btn";
      loginBtn.textContent = "Login";
      loginBtn.addEventListener("click", function () {
        openAuthModal("login");
      });
      slot.appendChild(loginBtn);
    }
  }

  function setAuthMessage(msg, kind) {
    var el = $("auth-modal-message");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "auth-message" + (kind ? " " + kind : "");
  }

  function setAuthTab(mode) {
    var loginTab = $("auth-tab-login");
    var registerTab = $("auth-tab-register");
    var emailField = $("auth-field-email");
    if (loginTab) loginTab.classList.toggle("is-active", mode === "login");
    if (registerTab) registerTab.classList.toggle("is-active", mode === "register");
    if (emailField) emailField.style.display = mode === "register" ? "block" : "none";
    var title = $("auth-modal-title");
    if (title) title.textContent = mode === "register" ? "Create account" : "Log in";
    var overlay = $("auth-modal-overlay");
    if (overlay) overlay.setAttribute("data-mode", mode);
  }

  function openAuthModal(mode) {
    setAuthTab(mode || "login");
    setAuthMessage("");
    var overlay = $("auth-modal-overlay");
    if (overlay) {
      overlay.classList.add("is-open");
      overlay.setAttribute("aria-hidden", "false");
    }
    var userInput = $("auth-username");
    if (userInput) userInput.focus();
  }

  function closeAuthModal() {
    var overlay = $("auth-modal-overlay");
    if (overlay) {
      overlay.classList.remove("is-open");
      overlay.setAttribute("aria-hidden", "true");
    }
    setAuthMessage("");
  }

  function ensureModal() {
    if ($("auth-modal-overlay")) return;
    var html =
      '<div id="auth-modal-overlay" class="auth-modal-overlay" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">' +
      '<div class="auth-modal">' +
      '<button type="button" class="auth-modal-close" id="auth-modal-close" aria-label="Close">&times;</button>' +
      '<h2 id="auth-modal-title">Log in</h2>' +
      '<div class="auth-tabs">' +
      '<button type="button" class="auth-tab is-active" id="auth-tab-login">Log in</button>' +
      '<button type="button" class="auth-tab" id="auth-tab-register">Register</button>' +
      "</div>" +
      '<form id="auth-form">' +
      '<div class="auth-field"><label for="auth-username">Username</label><input type="text" id="auth-username" name="username" autocomplete="username" required minlength="3" maxlength="32" pattern="[a-zA-Z0-9_-]+" /></div>' +
      '<div class="auth-field" id="auth-field-email" style="display:none;"><label for="auth-email">Email</label><input type="email" id="auth-email" name="email" autocomplete="email" /></div>' +
      '<div class="auth-field"><label for="auth-password">Password</label><input type="password" id="auth-password" name="password" autocomplete="current-password" required minlength="8" /></div>' +
      '<button type="submit" class="auth-submit" id="auth-submit-btn">Continue</button>' +
      '<div id="auth-modal-message" class="auth-message" role="status"></div>' +
      "</form></div></div>";
    document.body.insertAdjacentHTML("beforeend", html);

    $("auth-modal-close").addEventListener("click", closeAuthModal);
    $("auth-tab-login").addEventListener("click", function () {
      setAuthTab("login");
    });
    $("auth-tab-register").addEventListener("click", function () {
      setAuthTab("register");
    });
    $("auth-modal-overlay").addEventListener("click", function (e) {
      if (e.target === this) closeAuthModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && $("auth-modal-overlay")?.classList.contains("is-open")) {
        closeAuthModal();
      }
    });
    $("auth-form").addEventListener("submit", function (e) {
      e.preventDefault();
      submitAuthForm();
    });
  }

  function submitAuthForm() {
    var overlay = $("auth-modal-overlay");
    var mode = overlay?.getAttribute("data-mode") || "login";
    var username = String($("auth-username")?.value || "").trim();
    var password = String($("auth-password")?.value || "");
    var email = String($("auth-email")?.value || "").trim();
    var btn = $("auth-submit-btn");
    if (btn) btn.disabled = true;
    setAuthMessage(mode === "register" ? "Creating account…" : "Logging in…");

    var url = mode === "register" ? "/api/auth/register" : "/api/auth/login";
    var body = { username: username, password: password };
    if (mode === "register") body.email = email;

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json().then(function (data) {
          return { ok: r.ok, status: r.status, data: data };
        });
      })
      .then(function (res) {
        if (btn) btn.disabled = false;
        if (!res.ok) {
          setAuthMessage(res.data?.error || "Request failed (HTTP " + res.status + ")", "error");
          return;
        }
        currentUser = res.data.user || null;
        authLoaded = true;
        renderHeaderAuth();
        closeAuthModal();
        notifyReady();
      })
      .catch(function () {
        if (btn) btn.disabled = false;
        setAuthMessage("Network error.", "error");
      });
  }

  function doLogout() {
    fetch("/api/auth/logout", { method: "POST", credentials: "include" })
      .then(function () {
        currentUser = null;
        renderHeaderAuth();
        notifyReady();
      })
      .catch(function (err) {
        console.error(err);
      });
  }

  function loadMe() {
    return fetch("/api/auth/me", { credentials: "include" })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        currentUser = data.user || null;
        authLoaded = true;
        renderHeaderAuth();
        notifyReady();
      })
      .catch(function (err) {
        console.error(err);
        currentUser = null;
        authLoaded = true;
        renderHeaderAuth();
        notifyReady();
      });
  }

  window.CWAuth = {
    getUser: function () {
      return currentUser;
    },
    onReady: onAuthReady,
    openLogin: function () {
      openAuthModal("login");
    },
    openRegister: function () {
      openAuthModal("register");
    },
  };

  function boot() {
    ensureModal();
    loadMe();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
