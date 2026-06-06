/**
 * Cloudflare Turnstile verification helpers.
 */

function isCwwLocalEnv(env) {
  var cwEnv = typeof env.CWW_ENV === "string" ? env.CWW_ENV.trim().toLowerCase() : "";
  return cwEnv === "local";
}

function turnstileTokenFromBody(body) {
  if (!body || typeof body !== "object") return null;
  var token = body["cf-turnstile-response"];
  return token ? String(token) : null;
}

function clientIpFromTurnstileRequest(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || "";
}

/**
 * Verify a Cloudflare Turnstile token server-side.
 * When `CWW_ENV` is `local`, always returns true.
 */
export async function verifyTurnstile(token, ip, env) {
  if (isCwwLocalEnv(env)) return true;
  if (!token) return false;
  var secret = env.TURNSTILE_SECRET;
  if (!secret) {
    console.error("TURNSTILE_SECRET is not configured");
    return false;
  }

  try {
    var resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: secret,
        response: String(token),
        remoteip: ip || "",
      }),
    });
    var result = await resp.json();
    return result.success === true;
  } catch (err) {
    console.error("Turnstile verification error:", err);
    return false;
  }
}

async function turnstileTokenFromJsonRequest(request) {
  try {
    var clone = request.clone();
    var body = await clone.json();
    return turnstileTokenFromBody(body);
  } catch (_e) {
    return null;
  }
}

async function turnstileTokenFromFormRequest(request) {
  try {
    var formClone = request.clone();
    var formData = await formClone.formData();
    var formToken = formData.get("cf-turnstile-response");
    return formToken ? String(formToken) : null;
  } catch (_e2) {
    return null;
  }
}

/**
 * Extract Turnstile token from header, JSON body, or FormData field.
 * @param {Request} request
 * @param {object} [parsedBody] Already-parsed JSON body when available
 */
export async function verifyTurnstileFromRequest(request, env, parsedBody) {
  if (isCwwLocalEnv(env)) return true;

  var clientIp = clientIpFromTurnstileRequest(request);

  var headerToken = request.headers.get("Cf-Turnstile-Response");
  if (headerToken) {
    return verifyTurnstile(headerToken, clientIp, env);
  }

  var bodyToken = turnstileTokenFromBody(parsedBody);
  if (bodyToken) {
    return verifyTurnstile(bodyToken, clientIp, env);
  }

  var contentType = request.headers.get("Content-Type") || "";
  if (contentType.indexOf("application/json") >= 0) {
    var jsonToken = await turnstileTokenFromJsonRequest(request);
    if (jsonToken) {
      return verifyTurnstile(jsonToken, clientIp, env);
    }
  }

  if (
    contentType.indexOf("multipart/form-data") >= 0 ||
    contentType.indexOf("application/x-www-form-urlencoded") >= 0
  ) {
    var formToken = await turnstileTokenFromFormRequest(request);
    if (formToken) {
      return verifyTurnstile(formToken, clientIp, env);
    }
  }

  return false;
}
