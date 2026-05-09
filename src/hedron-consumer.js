/**
 * Cloudflare Queue consumer for Hedron deck jobs.
 *
 * The main Worker only parses Hedron JSON and publishes compact queue messages.
 * This Worker does the slower image download, stages the existing R2 upload
 * package shape, and asks the GCP enqueue service to process that R2 prefix.
 */

var HEDRON_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
var HEDRON_RETRY_BASE_DELAY_SECONDS = 30;

export default {
  async queue(batch, env) {
    for (var i = 0; i < batch.messages.length; i++) {
      var message = batch.messages[i];
      try {
        await processHedronMessage(message.body, env);
        message.ack();
      } catch (e) {
        if (e && e.permanent) {
          console.error("hedron consumer permanent failure", {
            message_id: message.id,
            error: e.message || String(e),
          });
          message.ack();
          continue;
        }

        var delay = Math.min(
          300,
          HEDRON_RETRY_BASE_DELAY_SECONDS * Math.max(1, message.attempts || 1)
        );
        console.error("hedron consumer retry", {
          message_id: message.id,
          attempts: message.attempts,
          delay_seconds: delay,
          error: e && e.message ? e.message : String(e),
        });
        message.retry({ delaySeconds: delay });
      }
    }
  },
};

function PermanentError(message) {
  var e = new Error(message);
  e.permanent = true;
  return e;
}

function requiredString(obj, key) {
  var v = obj && obj[key];
  if (typeof v !== "string" || !v.trim()) {
    throw PermanentError("missing required field: " + key);
  }
  return v.trim();
}

function optionalInt(obj, key) {
  var v = obj && obj[key];
  if (v == null || v === "") return 0;
  if (typeof v === "number" && isFinite(v)) return Math.trunc(v);
  var parsed = parseInt(String(v), 10);
  return isFinite(parsed) ? parsed : 0;
}

function normalizePrefix(prefix, deckImageUuid) {
  var p = String(prefix || "").trim();
  if (!p) {
    p = "hedron/" + String(deckImageUuid || "").replace(/[^a-zA-Z0-9_\-:.]/g, "_");
  }
  return p.replace(/^\/+/, "").replace(/\/+$/, "");
}

function contentTypeToExt(contentType) {
  var ct = String(contentType || "").split(";")[0].trim().toLowerCase();
  var extMap = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
  };
  return extMap[ct] || "jpg";
}

function gcpEnqueueUrl(env) {
  var baseUrl = String(env.GCP_ENQUEUE_URL || env.ENQUEUE_URL || "").trim();
  if (!baseUrl) throw new Error("missing env.GCP_ENQUEUE_URL");
  var trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.toLowerCase().endsWith("/enqueue") ? trimmed : trimmed + "/enqueue";
}

async function fetchImageStream(imageUrl) {
  var controller = new AbortController();
  var timer = setTimeout(function () {
    controller.abort();
  }, 120000);

  try {
    var resp = await fetch(imageUrl, {
      headers: {
        Accept: "image/*,*/*;q=0.8",
        "User-Agent": "CubeWizard-Hedron-Consumer/1.0",
      },
      signal: controller.signal,
    });

    if (!resp.ok) {
      if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) {
        throw PermanentError("hedron image fetch failed with status " + resp.status);
      }
      throw new Error("hedron image fetch failed with status " + resp.status);
    }

    var contentLength = parseInt(resp.headers.get("Content-Length") || "0", 10);
    if (contentLength > HEDRON_MAX_IMAGE_BYTES) {
      throw PermanentError("hedron image exceeds max size from content-length");
    }

    var contentType = resp.headers.get("Content-Type") || "image/jpeg";
    if (!resp.body) throw new Error("hedron image response has no body");

    if (contentLength > 0) {
      return {
        body: resp.body,
        byteCount: Promise.resolve(contentLength),
        contentType: contentType,
        ext: contentTypeToExt(contentType),
      };
    }

    // R2 requires a known-length stream. If Hedron omits Content-Length, buffer
    // this single queue message with the same 20 MB guard before writing to R2.
    var arr = await resp.arrayBuffer();
    if (arr.byteLength <= 0) throw PermanentError("hedron image is empty");
    if (arr.byteLength > HEDRON_MAX_IMAGE_BYTES) {
      throw PermanentError("hedron image exceeds max size");
    }

    return {
      body: new Blob([arr], { type: contentType }),
      byteCount: Promise.resolve(arr.byteLength),
      contentType: contentType,
      ext: contentTypeToExt(contentType),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function enqueueGcpR2Job(env, body) {
  var secret = String(env.ENQUEUE_SHARED_SECRET || "").trim();
  if (!secret) throw new Error("missing env.ENQUEUE_SHARED_SECRET");

  var controller = new AbortController();
  var timer = setTimeout(function () {
    controller.abort();
  }, 15000);

  try {
    var resp = await fetch(gcpEnqueueUrl(env), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shared-Secret": secret,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      var text = "";
      try {
        text = (await resp.text()).slice(0, 500);
      } catch (e) {}
      throw new Error("GCP enqueue failed: " + resp.status + (text ? " " + text : ""));
    }
  } finally {
    clearTimeout(timer);
  }
}

async function processHedronMessage(raw, env) {
  var job = raw && typeof raw === "object" ? raw : null;
  if (!job) throw PermanentError("queue body must be an object");

  var deckImageUuid = requiredString(job, "deck_image_uuid");
  var cubeId = requiredString(job, "cube_id");
  var uploadId = requiredString(job, "upload_id");
  var imageUrl = requiredString(job, "image_url");
  var prefix = normalizePrefix(job.r2_prefix, deckImageUuid);
  var submittedAt = job.submitted_at ? String(job.submitted_at) : new Date().toISOString();
  var pilotName = job.pilot_name ? String(job.pilot_name) : "Unknown";
  var wins = optionalInt(job, "match_wins");
  var losses = optionalInt(job, "match_losses");
  var draws = optionalInt(job, "match_draws");
  var winRate = wins + losses > 0 ? wins / (wins + losses) : 0;

  var image = await fetchImageStream(imageUrl);
  var imageKey = prefix + "/image." + image.ext;
  await env.BUCKET.put(imageKey, image.body, {
    httpMetadata: { contentType: image.contentType },
    customMetadata: { pilotName: pilotName, cubeId: cubeId, source: "hedron" },
  });
  var downloadedBytes = await image.byteCount;

  var metadata = {
    cube_id: cubeId,
    pilot_name: pilotName,
    match_wins: wins,
    match_losses: losses,
    match_draws: draws,
    win_rate: winRate,
    record_logged: submittedAt,
    image_key: imageKey,
    original_filename: deckImageUuid + "." + image.ext,
    image_url: imageUrl,
    image_source: job.image_source ? String(job.image_source) : "hedron",
    upload_id: uploadId,
    draft_id: job.draft_id ? String(job.draft_id) : "",
    player_id: job.player_id ? String(job.player_id) : "",
    downloaded_bytes: downloadedBytes,
  };
  await env.BUCKET.put(prefix + "/metadata.json", JSON.stringify(metadata, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });

  await enqueueGcpR2Job(env, {
    upload_id: uploadId,
    cube_id: cubeId,
    pilot_name: pilotName,
    submitted_at: submittedAt,
    schema_version: 1,
    r2_bucket: String(env.R2_STAGING_BUCKET_NAME || "decklist-uploads").trim(),
    r2_prefix: prefix + "/",
    match_wins: wins,
    match_losses: losses,
    match_draws: draws,
  });

  console.log("hedron_consumer", {
    event: "job_staged_and_enqueued",
    cube_id: cubeId,
    deck_image_uuid: deckImageUuid,
    upload_id: uploadId,
    r2_prefix: prefix + "/",
    image_key: imageKey,
    downloaded_bytes: downloadedBytes,
  });
}
