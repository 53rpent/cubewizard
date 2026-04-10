"""
D1 Writer for CubeWizard.
Primary storage backend — writes deck data directly to Cloudflare D1
via the D1 REST API.  No local SQLite or wrangler CLI needed.

Requires these environment variables (in .env):
    CLOUDFLARE_ACCOUNT_ID
    CLOUDFLARE_API_TOKEN       (needs Account / D1 / Edit permission)
    CLOUDFLARE_D1_DATABASE_ID
"""

import hashlib
import json
import os
from typing import Dict, Any, Callable, List, Optional, Tuple

import requests
from dotenv import load_dotenv

load_dotenv()

# Cloudflare credentials from .env
_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
_DATABASE_ID = os.environ.get("CLOUDFLARE_D1_DATABASE_ID", "")

_D1_QUERY_URL = (
    f"https://api.cloudflare.com/client/v4/accounts/{_ACCOUNT_ID}"
    f"/d1/database/{_DATABASE_ID}/query"
)


def _check_config() -> None:
    """Raise if required env vars are missing."""
    missing = []
    if not _ACCOUNT_ID:
        missing.append("CLOUDFLARE_ACCOUNT_ID")
    if not _API_TOKEN:
        missing.append("CLOUDFLARE_API_TOKEN")
    if not _DATABASE_ID:
        missing.append("CLOUDFLARE_D1_DATABASE_ID")
    if missing:
        raise ValueError(
            f"Missing environment variables: {', '.join(missing)}. "
            "Add them to your .env file."
        )


# ---------------------------------------------------------------------------
# Low-level D1 REST helpers
# ---------------------------------------------------------------------------

def _d1_request(payload: dict) -> dict:
    """
    POST to the D1 /query endpoint and return the JSON response.
    Raises on HTTP or API-level errors.
    """
    _check_config()
    resp = requests.post(
        _D1_QUERY_URL,
        headers={
            "Authorization": f"Bearer {_API_TOKEN}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def _execute_batch(statements: List[Dict[str, Any]]) -> list:
    """
    Execute a batch of parameterized statements atomically via the D1 API.

    Each element in *statements* is {"sql": "...", "params": [...]}.
    Returns the list of per-statement result objects.
    """
    data = _d1_request({"batch": statements})
    if not data.get("success"):
        errors = data.get("errors", [])
        raise RuntimeError(f"D1 batch failed: {errors}")
    return data.get("result", [])


def _execute_single(sql: str, params: list | None = None) -> list:
    """
    Execute a single parameterized query and return result rows.
    """
    payload: dict = {"sql": sql}
    if params:
        payload["params"] = params
    data = _d1_request(payload)
    if not data.get("success"):
        errors = data.get("errors", [])
        raise RuntimeError(f"D1 query failed: {errors}")
    results = data.get("result", [])
    if results and isinstance(results, list):
        return results[0].get("results", [])
    return []


def cube_id_registered(cube_id: str) -> bool:
    """Return True if *cube_id* exists in the D1 ``cubes`` table."""
    rows = _execute_single(
        "SELECT cube_id FROM cubes WHERE cube_id = ? LIMIT 1",
        [cube_id],
    )
    return len(rows) > 0


# ---------------------------------------------------------------------------
# Statement builders  (return {"sql": ..., "params": [...]} dicts)
# ---------------------------------------------------------------------------

def _stmt(sql: str, params: list | None = None) -> dict:
    """Convenience: build a statement dict."""
    s: dict = {"sql": sql}
    if params is not None:
        s["params"] = params
    return s


def _build_batch(cube_id: str, deck_data: Dict[str, Any]) -> Tuple[List[dict], dict, Callable[[int], List[dict]]]:
    """
    Build a list of parameterized statement dicts for inserting one
    deck (metadata + cards + stats) into D1.

    The batch:
      1. INSERT OR IGNORE into cubes
      2. INSERT into decks
      3. SELECT last deck_id (via processing_timestamp + pilot_name)
         — done client-side after the first two execute
    So we split into two batches:
      Batch A: cube upsert + deck insert
      Batch B: deck_stats + all deck_cards + cube counter update
              (needs the deck_id from batch A)
    """
    metadata = deck_data["deck"]["metadata"]
    cards_data = deck_data["deck"]["cards"]
    now = metadata.get("record_logged", "")

    # Generate a deterministic image_id for deduplication.
    # The decks table has a UNIQUE constraint on image_id, so
    # INSERT OR IGNORE will silently skip duplicate submissions.
    id_source = f"{cube_id}|{metadata['pilot_name']}|{metadata['processing_timestamp']}"
    image_id = hashlib.sha256(id_source.encode()).hexdigest()[:16]

    # ---- Batch A: cube + deck ----
    batch_a = [
        _stmt(
            "INSERT OR IGNORE INTO cubes (cube_id, created, last_updated, total_decks) "
            "VALUES (?, ?, ?, 0);",
            [cube_id, now, now],
        ),
        _stmt(
            "INSERT OR IGNORE INTO decks "
            "(cube_id, pilot_name, match_wins, match_losses, match_draws, win_rate, "
            "record_logged, image_source, image_id, processing_timestamp, total_cards) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
            [
                cube_id,
                metadata["pilot_name"],
                metadata["match_wins"],
                metadata["match_losses"],
                metadata.get("match_draws", 0),
                metadata["win_rate"],
                metadata["record_logged"],
                metadata.get("image_source", ""),
                image_id,
                metadata["processing_timestamp"],
                metadata["total_cards"],
            ],
        ),
    ]

    # ---- Lookup query to get the new deck_id ----
    lookup_stmt = _stmt(
        "SELECT deck_id FROM decks "
        "WHERE cube_id = ? AND processing_timestamp = ? AND pilot_name = ? "
        "ORDER BY deck_id DESC LIMIT 1;",
        [cube_id, metadata["processing_timestamp"], metadata["pilot_name"]],
    )

    # ---- Batch B builder (called after we know deck_id) ----
    def build_batch_b(deck_id: int) -> List[dict]:
        stmts: List[dict] = []

        # deck_stats
        not_found = cards_data.get("not_found", []) or []
        total_not_found = cards_data.get("total_not_found")
        if total_not_found is None:
            total_not_found = len(not_found)

        processing_notes = {
            "total_requested": cards_data.get("total_requested"),
            "total_found": cards_data.get("total_found"),
            "total_not_found": total_not_found,
            "not_found": not_found,
            "success_rate": cards_data.get("success_rate"),
        }
        stmts.append(_stmt(
            "INSERT INTO deck_stats (deck_id, total_found, total_not_found, processing_notes) "
            "VALUES (?, ?, ?, ?);",
            [
                deck_id,
                cards_data.get("total_found", 0),
                total_not_found,
                json.dumps(processing_notes),
            ],
        ))

        # deck_cards
        for card in cards_data.get("cards", []):
            stmts.append(_stmt(
                "INSERT INTO deck_cards "
                "(deck_id, name, mana_cost, cmc, type_line, colors, color_identity, "
                "rarity, set_code, set_name, collector_number, power, toughness, "
                "oracle_text, scryfall_uri, image_uris, prices) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
                [
                    deck_id,
                    card.get("name"),
                    card.get("mana_cost"),
                    card.get("cmc"),
                    card.get("type_line"),
                    json.dumps(card.get("colors", [])),
                    json.dumps(card.get("color_identity", [])),
                    card.get("rarity"),
                    card.get("set"),
                    card.get("set_name"),
                    card.get("collector_number"),
                    card.get("power"),
                    card.get("toughness"),
                    card.get("oracle_text"),
                    card.get("scryfall_uri"),
                    json.dumps(card.get("image_uris", {})),
                    json.dumps(card.get("prices", {})),
                ],
            ))

        # update cube counters
        stmts.append(_stmt(
            "UPDATE cubes SET "
            "total_decks = (SELECT COUNT(*) FROM decks WHERE cube_id = ?), "
            "last_updated = ? "
            "WHERE cube_id = ?;",
            [cube_id, now, cube_id],
        ))

        return stmts

    return batch_a, lookup_stmt, build_batch_b


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def add_deck(cube_id: str, deck_data: Dict[str, Any],
             env: Optional[str] = None) -> Dict[str, Any]:
    """
    Write a deck (metadata + cards + stats) to Cloudflare D1 via REST API.

    Uses two atomic batches:
      Batch A: Insert cube (if new) + insert deck row
      Then:    Look up the new deck_id
      Batch B: Insert deck_stats + all deck_cards + update cube counters

    Args:
        cube_id:   CubeCobra cube identifier.
        deck_data: Deck data dict built by CubeWizard.process_single_image().
        env:       Unused (kept for API compatibility). REST API uses
                   CLOUDFLARE_D1_DATABASE_ID from .env directly.

    Returns:
        Dict with keys: success (bool), image_id (str|None), deck_id (int|None),
        duplicate (bool).
    """
    result = {"success": False, "image_id": None, "deck_id": None, "duplicate": False}
    try:
        batch_a, lookup_stmt, build_batch_b = _build_batch(cube_id, deck_data)

        print("\n  Writing to D1 (REST API)...")

        # Extract the image_id that _build_batch generated
        result["image_id"] = batch_a[1]["params"][8]  # image_id position in INSERT params

        # Step 1: insert cube + deck
        batch_a_results = _execute_batch(batch_a)

        # Check if the deck INSERT was a no-op (duplicate image_id).
        # batch_a[0] = cube upsert, batch_a[1] = deck INSERT OR IGNORE.
        # D1 returns a "meta" object per statement with a "changes" count.
        deck_insert_meta = (
            batch_a_results[1].get("meta", {}) if len(batch_a_results) > 1 else {}
        )
        if deck_insert_meta.get("changes", 1) == 0:
            print("  [SKIP] Duplicate deck — already ingested (image_id match)")
            result["success"] = True
            result["duplicate"] = True
            return result

        # Step 2: get the new deck_id
        rows = _execute_single(lookup_stmt["sql"], lookup_stmt.get("params"))
        if not rows:
            print("  [FAIL] Could not retrieve new deck_id after insert")
            return result
        deck_id = rows[0]["deck_id"]
        result["deck_id"] = deck_id

        # Step 3: insert stats + cards + update counters
        batch_b = build_batch_b(deck_id)
        _execute_batch(batch_b)

        print("  [OK] D1 write successful")
        result["success"] = True
        return result

    except requests.exceptions.HTTPError as exc:
        print(f"  [FAIL] D1 HTTP error: {exc}")
        if exc.response is not None:
            try:
                body = exc.response.json()
                for err in body.get("errors", []):
                    print(f"    {err.get('message', err)}")
            except Exception:
                print(f"    {exc.response.text[:500]}")
        return result
    except Exception as exc:
        print(f"  [FAIL] D1 write failed: {exc}")
        return result


def update_stored_image_path(deck_id: int, stored_image_path: str) -> bool:
    """
    Update the stored_image_path for an existing deck record.

    Args:
        deck_id: The deck's primary key in D1.
        stored_image_path: Relative path to the stored image file.

    Returns:
        True on success, False on failure.
    """
    try:
        _execute_single(
            "UPDATE decks SET stored_image_path = ? WHERE deck_id = ?;",
            [stored_image_path, deck_id],
        )
        return True
    except Exception as exc:
        print(f"  [FAIL] Could not update stored_image_path: {exc}")
        return False


def get_cube_id_by_name(cube_name: str, env: Optional[str] = None) -> Optional[str]:
    """
    Look up a cube_id from the cube_mapping table by human-readable name.

    Args:
        cube_name: Human-readable cube name (e.g. "The Bacon Vintage Cube").
        env:       Unused (kept for API compatibility).

    Returns:
        The cube_id string if found, None otherwise.
    """
    try:
        rows = _execute_single(
            "SELECT cube_id FROM cube_mapping WHERE cube_name = ? LIMIT 1;",
            [cube_name],
        )
        if rows and len(rows) > 0:
            return rows[0].get("cube_id")
    except Exception:
        pass
    return None
