/**
 * Workers Cache API helpers for dashboard analytics responses.
 */

function parseEnvInt(env, key, fallback) {
  var raw = env?.[key];
  if (raw == null || raw === "") return fallback;
  var n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function dashboardCacheTtlSeconds(env) {
  return parseEnvInt(env, "DASHBOARD_CACHE_TTL_SECONDS", 900);
}

export function dashboardCacheRequest(origin, cubeId) {
  return new Request(new URL("/__dashboard_cache__/" + encodeURIComponent(cubeId), origin).toString(), {
    method: "GET",
  });
}

export async function getCachedDashboard(origin, cubeId) {
  var cache = caches.default;
  return cache.match(dashboardCacheRequest(origin, cubeId));
}

export async function putCachedDashboard(origin, cubeId, response, ttlSeconds) {
  var cache = caches.default;
  var headers = new Headers(response.headers);
  headers.set("Cache-Control", "public, max-age=" + String(ttlSeconds));
  headers.set("X-CW-Dashboard-Cache", "stored");
  var cached = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers,
  });
  await cache.put(dashboardCacheRequest(origin, cubeId), cached);
}

export async function invalidateDashboardCache(origin, cubeId) {
  var cache = caches.default;
  return cache.delete(dashboardCacheRequest(origin, cubeId));
}
