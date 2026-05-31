/**
 * Fixed-window rate limiting backed by Workers KV.
 */

var DEFAULT_WINDOW_SECONDS = 60;

function parseEnvInt(env, key, fallback) {
  var raw = env?.[key];
  if (raw == null || raw === "") return fallback;
  var n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * @param {KVNamespace | undefined} kv
 * @param {string} key Stable limiter key (e.g. `dashboard:1.2.3.4:my-cube`)
 * @param {number} limit Max requests per window
 * @param {number} [windowSeconds=60]
 * @returns {Promise<{ allowed: boolean, retryAfter?: number }>}
 */
export async function checkRateLimit(kv, key, limit, windowSeconds) {
  if (!kv || typeof kv.get !== "function") {
    return { allowed: true };
  }
  var windowSec = windowSeconds > 0 ? windowSeconds : DEFAULT_WINDOW_SECONDS;
  var now = Math.floor(Date.now() / 1000);
  var windowStart = now - (now % windowSec);
  var kvKey = "rl:" + key + ":" + String(windowStart);

  var currentRaw = await kv.get(kvKey);
  var current = currentRaw ? parseInt(String(currentRaw), 10) : 0;
  if (!Number.isFinite(current) || current < 0) current = 0;

  if (current >= limit) {
    return { allowed: false, retryAfter: windowSec - (now - windowStart) };
  }

  await kv.put(kvKey, String(current + 1), { expirationTtl: windowSec + 30 });
  return { allowed: true };
}

export function clientIpFromRequest(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export function dashboardRateLimitConfig(env) {
  return {
    limit: parseEnvInt(env, "DASHBOARD_RATE_LIMIT_PER_MINUTE", 30),
    windowSeconds: parseEnvInt(env, "DASHBOARD_RATE_LIMIT_WINDOW_SECONDS", 60),
  };
}

export function hedronSyncRateLimitConfig(env) {
  return {
    limit: parseEnvInt(env, "HEDRON_SYNC_RATE_LIMIT_PER_MINUTE", 5),
    windowSeconds: parseEnvInt(env, "HEDRON_SYNC_RATE_LIMIT_WINDOW_SECONDS", 60),
  };
}
