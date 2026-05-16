/**
 * Cloudflare Queue consumer for Hedron deck jobs.
 *
 * Stages R2 (image + metadata), upserts processing_jobs, enqueues eval on EVAL_QUEUE.
 * OpenAI / Scryfall / deck writes run on the **eval consumer** Worker — tail that separately.
 *
 * Queue: max_batch_size 1, max_concurrency 1.
 */

import { parseQueueJsonBody } from "./queueMessageBody.js";
import { upsertQueuedProcessingJob } from "./processingJobsD1.js";

var HEDRON_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
var HEDRON_RETRY_BASE_DELAY_SECONDS = 30;

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

function assertConsumerBindings(env) {
  if (!env.BUCKET || typeof env.BUCKET.put !== "function") {
    throw new Error("missing_bucket_binding");
  }
  if (!env.cubewizard_db || typeof env.cubewizard_db.prepare !== "function") {
    throw new Error("missing_cubewizard_db_binding");
  }
  if (!env.EVAL_QUEUE || typeof env.EVAL_QUEUE.send !== "function") {
    throw new Error("missing_eval_queue_binding");
  }
}

/** Always buffer so R2 gets known-length bytes (streaming puts can complete without real data). */
async function fetchImageBytes(imageUrl) {
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

    var contentType = resp.headers.get("Content-Type") || "image/jpeg";
    var arr = await resp.arrayBuffer();
    if (arr.byteLength <= 0) throw PermanentError("hedron image is empty");
    if (arr.byteLength > HEDRON_MAX_IMAGE_BYTES) {
      throw PermanentError("hedron image exceeds max size");
    }

    return {
      bytes: new Uint8Array(arr),
      byteLength: arr.byteLength,
      contentType: contentType,
      ext: contentTypeToExt(contentType),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function verifyR2Staging(env, metadataKey, imageKey, expectedImageBytes) {
  if (typeof env.BUCKET.head !== "function") {
    console.warn("hedron_r2_verify_skipped", { reason: "bucket_head_unavailable" });
    return;
  }
  var metaHead = await env.BUCKET.head(metadataKey);
  if (!metaHead) throw new Error("r2_metadata_missing_after_put");
  var imgHead = await env.BUCKET.head(imageKey);
  if (!imgHead) throw new Error("r2_image_missing_after_put");
  var stored =
    imgHead.size != null
      ? imgHead.size
      : imgHead.contentLength != null
        ? imgHead.contentLength
        : null;
  if (stored != null && stored <= 0) {
    throw new Error("r2_image_empty_after_put");
  }
  if (expectedImageBytes > 0 && stored != null && stored !== expectedImageBytes) {
    console.warn("hedron_r2_size_mismatch", {
      expected: expectedImageBytes,
      stored: stored,
      image_key: imageKey,
    });
  }
}

async function enqueueCfEvalJob(env, body) {
  await env.EVAL_QUEUE.send(body, { contentType: "json" });
}

async function processHedronMessage(raw, env, messageId) {
  var t0 = Date.now();
  assertConsumerBindings(env);

  var job = parseQueueJsonBody(raw);
  if (!job) throw PermanentError("queue body must be a JSON object");

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

  var image = await fetchImageBytes(imageUrl);
  var imageKey = prefix + "/image." + image.ext;
  var metadataKey = prefix + "/metadata.json";

  await env.BUCKET.put(imageKey, image.bytes, {
    httpMetadata: { contentType: image.contentType },
    customMetadata: { pilotName: pilotName, cubeId: cubeId, source: "hedron" },
  });

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
    downloaded_bytes: image.byteLength,
  };
  await env.BUCKET.put(metadataKey, JSON.stringify(metadata, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });

  await verifyR2Staging(env, metadataKey, imageKey, image.byteLength);

  var r2Bucket = String(env.R2_STAGING_BUCKET_NAME || "decklist-uploads").trim();
  var taskBody = {
    upload_id: uploadId,
    cube_id: cubeId,
    pilot_name: pilotName,
    submitted_at: submittedAt,
    schema_version: 1,
    r2_bucket: r2Bucket,
    r2_prefix: prefix + "/",
    image_source: metadata.image_source,
    match_wins: wins,
    match_losses: losses,
    match_draws: draws,
  };

  await upsertQueuedProcessingJob(env.cubewizard_db, taskBody);
  await enqueueCfEvalJob(env, taskBody);

  console.log("hedron_consumer_complete", {
    message_id: messageId || null,
    upload_id: uploadId,
    cube_id: cubeId,
    deck_image_uuid: deckImageUuid,
    r2_prefix: prefix + "/",
    image_key: imageKey,
    downloaded_bytes: image.byteLength,
    elapsed_ms: Date.now() - t0,
    eval_enqueued: true,
    eval_worker: "cubewizard-eval-consumer — tail separately for OpenAI/Scryfall",
  });
}

export default {
  async queue(batch, env) {
    if (!batch.messages || batch.messages.length === 0) return;

    if (batch.messages.length > 1) {
      console.warn("hedron_consumer_unexpected_batch_size", {
        size: batch.messages.length,
        queue: batch.queue,
      });
    }

    var message = batch.messages[0];
    try {
      await processHedronMessage(message.body, env, message.id);
      message.ack();
    } catch (e) {
      if (e && e.permanent) {
        console.error("hedron_consumer_poison", {
          message_id: message.id,
          error: e.message || String(e),
        });
        message.ack();
        return;
      }

      var delay = Math.min(
        300,
        HEDRON_RETRY_BASE_DELAY_SECONDS * Math.max(1, message.attempts || 1)
      );
      console.error("hedron_consumer_retry", {
        message_id: message.id,
        attempts: message.attempts,
        delay_seconds: delay,
        error: e && e.message ? e.message : String(e),
      });
      message.retry({ delaySeconds: delay });
    }
  },
};
