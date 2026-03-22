/**
 * CubeWizard Cloudflare Worker
 * 
 * Handles deck image uploads and stores them in R2.
 * Static assets (dashboard, submit form) are served by the ASSETS binding.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle upload API endpoint
    if (url.pathname === "/api/upload" && request.method === "POST") {
      return handleUpload(request, env);
    }

    // Validate a CubeCobra cube ID (proxy to avoid CORS)
    if (url.pathname === "/api/validate-cube" && request.method === "GET") {
      return handleValidateCube(url, env);
    }

    // Submit a new cube request
    if (url.pathname === "/api/add-cube" && request.method === "POST") {
      return handleAddCube(request, env);
    }

    // Everything else is served by the static assets binding
    return env.ASSETS.fetch(request);
  },
};

/**
 * Handle a deck image upload.
 * Expects a multipart form with fields: cube_id, pilot_name, wins, losses, draws, image
 * Stores the image and a metadata.json sidecar in R2.
 */
async function handleUpload(request, env) {
  try {
    const formData = await request.formData();

    // --- Validate required fields ---
    const cubeId = formData.get("cube_id")?.trim();
    const pilotName = formData.get("pilot_name")?.trim();
    const winsRaw = formData.get("wins");
    const lossesRaw = formData.get("losses");
    const drawsRaw = formData.get("draws") || "0";
    const imageFile = formData.get("image");

    const errors = [];
    if (!cubeId) errors.push("cube_id is required");
    if (!pilotName) errors.push("pilot_name is required");
    if (winsRaw === null || winsRaw === "") errors.push("wins is required");
    if (lossesRaw === null || lossesRaw === "") errors.push("losses is required");
    if (!imageFile || !(imageFile instanceof File) || imageFile.size === 0) {
      errors.push("image file is required");
    }

    if (errors.length > 0) {
      return jsonResponse({ success: false, errors }, 400);
    }

    const wins = parseInt(winsRaw, 10);
    const losses = parseInt(lossesRaw, 10);
    const draws = parseInt(drawsRaw, 10);

    if (isNaN(wins) || wins < 0) errors.push("wins must be a non-negative integer");
    if (isNaN(losses) || losses < 0) errors.push("losses must be a non-negative integer");
    if (isNaN(draws) || draws < 0) errors.push("draws must be a non-negative integer");

    if (errors.length > 0) {
      return jsonResponse({ success: false, errors }, 400);
    }

    // --- Validate image type and size ---
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    if (!allowedTypes.includes(imageFile.type)) {
      return jsonResponse(
        { success: false, errors: [`Invalid image type: ${imageFile.type}. Allowed: JPEG, PNG, WebP, HEIC`] },
        400
      );
    }

    const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
    if (imageFile.size > MAX_SIZE) {
      return jsonResponse(
        { success: false, errors: ["Image file must be under 10 MB"] },
        400
      );
    }

    // --- Build R2 key ---
    // Format: cubeId/YYYY-MM-DDTHH-MM-SS_pilotName/
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    const safePilot = pilotName.replace(/[^a-zA-Z0-9_\- ]/g, "");
    const prefix = `${cubeId}/${timestamp}_${safePilot}`;

    // Determine file extension from content type
    const extMap = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/heic": "heic",
      "image/heif": "heif",
    };
    const ext = extMap[imageFile.type] || "jpg";

    // --- Write image to R2 ---
    const imageKey = `${prefix}/image.${ext}`;
    await env.BUCKET.put(imageKey, imageFile.stream(), {
      httpMetadata: { contentType: imageFile.type },
      customMetadata: { pilotName, cubeId },
    });

    // --- Write metadata sidecar to R2 ---
    const winRate = (wins + losses) > 0 ? wins / (wins + losses) : 0;
    const metadata = {
      cube_id: cubeId,
      pilot_name: pilotName,
      match_wins: wins,
      match_losses: losses,
      match_draws: draws,
      win_rate: winRate,
      record_logged: now.toISOString(),
      image_key: imageKey,
      original_filename: imageFile.name,
    };

    const metadataKey = `${prefix}/metadata.json`;
    await env.BUCKET.put(metadataKey, JSON.stringify(metadata, null, 2), {
      httpMetadata: { contentType: "application/json" },
    });

    return jsonResponse({
      success: true,
      message: "Deck uploaded successfully!",
      key: prefix,
    });
  } catch (err) {
    console.error("Upload error:", err);
    return jsonResponse(
      { success: false, errors: ["Internal server error. Please try again."] },
      500
    );
  }
}

/**
 * Validate a CubeCobra cube ID by proxying the request (avoids CORS issues).
 * GET /api/validate-cube?cube_id=proxybacon
 */
async function handleValidateCube(url, env) {
  const cubeId = url.searchParams.get("cube_id")?.trim();
  if (!cubeId) {
    return jsonResponse({ valid: false, error: "cube_id parameter is required" }, 400);
  }

  try {
    const apiUrl = `https://cubecobra.com/cube/api/cubeJSON/${encodeURIComponent(cubeId)}`;
    const resp = await fetch(apiUrl, {
      headers: { "User-Agent": "CubeWizard/1.0" },
    });

    if (!resp.ok) {
      return jsonResponse({ valid: false, error: "Cube not found on CubeCobra." });
    }

    const data = await resp.json();

    // Extract cube name and card count
    const name = data.name || cubeId;
    let cardCount = 0;
    if (data.cards && Array.isArray(data.cards.mainboard)) {
      cardCount = data.cards.mainboard.length;
    }

    return jsonResponse({ valid: true, name, card_count: cardCount });
  } catch (err) {
    console.error("CubeCobra validation error:", err);
    return jsonResponse({ valid: false, error: "Failed to reach CubeCobra. Try again later." }, 502);
  }
}

/**
 * Handle a new-cube submission.
 * Stores the request as a JSON file in R2 under _cube_requests/ for later processing.
 */
async function handleAddCube(request, env) {
  try {
    const body = await request.json();

    const cubeId = body.cube_id?.trim();
    const cubeName = body.cube_name?.trim();
    const description = body.description?.trim() || "";

    const errors = [];
    if (!cubeId) errors.push("cube_id is required");
    if (!cubeName) errors.push("cube_name is required");
    if (errors.length > 0) {
      return jsonResponse({ success: false, errors }, 400);
    }

    // Store request in R2 so the scheduled pull can pick it up
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    const key = `_cube_requests/${timestamp}_${cubeId}.json`;

    const payload = {
      cube_id: cubeId,
      cube_name: cubeName,
      description,
      requested_at: now.toISOString(),
    };

    await env.BUCKET.put(key, JSON.stringify(payload, null, 2), {
      httpMetadata: { contentType: "application/json" },
    });

    return jsonResponse({
      success: true,
      message: "Cube registered! It will appear in the dropdown once the next data sync runs.",
    });
  } catch (err) {
    console.error("Add cube error:", err);
    return jsonResponse(
      { success: false, errors: ["Internal server error. Please try again."] },
      500
    );
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
