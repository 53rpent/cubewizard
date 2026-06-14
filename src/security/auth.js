/**
 * User accounts: password hashing (PBKDF2-SHA256), D1 sessions, signed cookies.
 */

var SESSION_COOKIE_NAME = "cw_session";
var SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Workers Web Crypto caps PBKDF2 at 100_000 iterations (OWASP suggests 210k for SHA-256 elsewhere). */
var PBKDF2_ITERATIONS = 100_000;
var USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/;
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isCwwLocalEnv(env) {
  var cwEnv = typeof env.CWW_ENV === "string" ? env.CWW_ENV.trim().toLowerCase() : "";
  return cwEnv === "local";
}

function sessionSecret(env) {
  var secret = typeof env.SESSION_SECRET === "string" ? env.SESSION_SECRET.trim() : "";
  if (secret) return secret;
  if (isCwwLocalEnv(env)) return "cw-local-dev-session-secret";
  return "";
}

function bytesToBase64Url(bytes) {
  var bin = "";
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  var b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(b64url) {
  var b64 = String(b64url || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  var bin = atob(b64);
  var out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSign(message, secret) {
  var key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  var sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bytesToBase64Url(new Uint8Array(sig));
}

async function hmacVerify(message, signatureB64Url, secret) {
  var key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  try {
    return await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(signatureB64Url),
      new TextEncoder().encode(message),
    );
  } catch (_e) {
    return false;
  }
}

function normalizeUsername(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase();
}

export function validateUsername(raw) {
  var username = normalizeUsername(raw);
  if (!USERNAME_RE.test(username)) {
    return { ok: false, error: "Username must be 3–32 characters (letters, numbers, underscore, hyphen)." };
  }
  return { ok: true, username: username };
}

export function validateEmail(raw) {
  var email = String(raw || "")
    .trim()
    .toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return { ok: false, error: "A valid email address is required." };
  }
  return { ok: true, email: email };
}

export function validatePassword(raw) {
  var password = String(raw || "");
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  if (password.length > 256) {
    return { ok: false, error: "Password is too long." };
  }
  return { ok: true, password: password };
}

export async function hashPassword(password) {
  var salt = crypto.getRandomValues(new Uint8Array(16));
  var keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  var derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return (
    "pbkdf2-sha256$" +
    PBKDF2_ITERATIONS +
    "$" +
    bytesToBase64Url(salt) +
    "$" +
    bytesToBase64Url(new Uint8Array(derived))
  );
}

export async function verifyPassword(password, stored) {
  var parts = String(stored || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  var iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  var salt = base64UrlToBytes(parts[2]);
  var expected = base64UrlToBytes(parts[3]);
  var keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  var derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt, iterations: iterations, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  var actual = new Uint8Array(derived);
  if (actual.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

function randomSessionId() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function parseCookies(request) {
  var header = request.headers.get("Cookie") || "";
  var out = {};
  var parts = header.split(";");
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].trim();
    if (!p) continue;
    var eq = p.indexOf("=");
    if (eq <= 0) continue;
    var k = p.slice(0, eq).trim();
    var v = p.slice(eq + 1).trim();
    out[k] = v;
  }
  return out;
}

async function signedCookieValue(sessionId, env) {
  var secret = sessionSecret(env);
  if (!secret) return null;
  var sig = await hmacSign(sessionId, secret);
  return sessionId + "." + sig;
}

async function parseSignedSessionCookie(raw, env) {
  var secret = sessionSecret(env);
  if (!secret || !raw) return null;
  var dot = String(raw).lastIndexOf(".");
  if (dot <= 0) return null;
  var sessionId = raw.slice(0, dot);
  var sig = raw.slice(dot + 1);
  if (!sessionId || !sig) return null;
  var ok = await hmacVerify(sessionId, sig, secret);
  return ok ? sessionId : null;
}

function cookieSecureFlag(env) {
  return isCwwLocalEnv(env) ? "" : "; Secure";
}

export function sessionCookieHeader(signedValue, env) {
  return (
    SESSION_COOKIE_NAME +
    "=" +
    signedValue +
    "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" +
    Math.floor(SESSION_TTL_MS / 1000) +
    cookieSecureFlag(env)
  );
}

export function clearSessionCookieHeader(env) {
  return SESSION_COOKIE_NAME + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" + cookieSecureFlag(env);
}

export async function purgeExpiredSessions(db) {
  var now = new Date().toISOString();
  await db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now).run();
}

export async function createSession(db, userId, env) {
  var sessionId = randomSessionId();
  var expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db
    .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(sessionId, userId, expiresAt)
    .run();
  var signed = await signedCookieValue(sessionId, env);
  if (!signed) throw new Error("SESSION_SECRET is not configured");
  return { sessionId: sessionId, cookieHeader: sessionCookieHeader(signed, env) };
}

export async function destroySession(db, request, env) {
  var cookies = parseCookies(request);
  var sessionId = await parseSignedSessionCookie(cookies[SESSION_COOKIE_NAME], env);
  if (sessionId) {
    await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
  }
  return clearSessionCookieHeader(env);
}

/**
 * @returns {Promise<{ user_id: number, username: string } | null>}
 */
export async function getSessionUser(request, env) {
  var secret = sessionSecret(env);
  if (!secret) return null;
  var cookies = parseCookies(request);
  var sessionId = await parseSignedSessionCookie(cookies[SESSION_COOKIE_NAME], env);
  if (!sessionId) return null;
  var now = new Date().toISOString();
  var row = await env.cubewizard_db
    .prepare(
      "SELECT u.user_id, u.username FROM sessions s " +
        "INNER JOIN users u ON u.user_id = s.user_id " +
        "WHERE s.id = ? AND s.expires_at >= ?",
    )
    .bind(sessionId, now)
    .first();
  if (!row) return null;
  return { user_id: Number(row.user_id), username: String(row.username) };
}

export function authRateLimitConfig(env) {
  var limit = parseInt(String(env.AUTH_RATE_LIMIT_PER_MINUTE || "20"), 10);
  var windowSeconds = parseInt(String(env.AUTH_RATE_LIMIT_WINDOW_SECONDS || "60"), 10);
  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : 20,
    windowSeconds: Number.isFinite(windowSeconds) && windowSeconds > 0 ? windowSeconds : 60,
  };
}

/**
 * Deck edit permission: unclaimed decks are open; claimed decks are owner-only.
 */
export function deckCanEdit(ownerUserId, sessionUser) {
  if (ownerUserId == null || ownerUserId === "") return true;
  var owner = Number(ownerUserId);
  if (!Number.isFinite(owner)) return true;
  if (!sessionUser) return false;
  return Number(sessionUser.user_id) === owner;
}

export function deckCanClaim(ownerUserId, sessionUser) {
  if (ownerUserId != null && ownerUserId !== "") return false;
  return Boolean(sessionUser);
}

/** Delete / re-process: claimed decks only, owner session required. */
export function deckCanManage(ownerUserId, sessionUser) {
  if (!sessionUser) return false;
  if (ownerUserId == null || ownerUserId === "") return false;
  var owner = Number(ownerUserId);
  if (!Number.isFinite(owner)) return false;
  return Number(sessionUser.user_id) === owner;
}
