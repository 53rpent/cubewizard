/**
 * Normalize Cloudflare Queue message bodies (JSON object, string, ArrayBuffer, wrapped).
 * Shared by Hedron + eval consumers and site enqueue helpers.
 */

export function parseQueueJsonBody(raw) {
  if (raw == null) return null;

  if (typeof raw === "string" && raw.trim()) {
    try {
      var fromStr = JSON.parse(raw);
      if (fromStr && typeof fromStr === "object") return unwrapQueueBody(fromStr);
    } catch (_e) {
      return null;
    }
  }

  if (raw instanceof ArrayBuffer) {
    try {
      return parseQueueJsonBody(new TextDecoder().decode(raw));
    } catch (_e2) {
      return null;
    }
  }

  if (ArrayBuffer.isView(raw)) {
    try {
      return parseQueueJsonBody(new TextDecoder().decode(raw));
    } catch (_e3) {
      return null;
    }
  }

  if (typeof raw === "object") {
    return unwrapQueueBody(raw);
  }

  return null;
}

function unwrapQueueBody(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (obj.body && typeof obj.body === "object" && obj.upload_id == null && obj.deck_image_uuid == null) {
    return obj.body;
  }
  return obj;
}
