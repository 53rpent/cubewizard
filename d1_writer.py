"""
D1 Writer for CubeWizard.
Primary storage backend — writes deck data directly to Cloudflare D1
via `npx wrangler d1 execute`.  No local SQLite needed.
"""

import json
import subprocess
import tempfile
import os
from pathlib import Path
from typing import Dict, Any, Optional


# D1 database name from wrangler.jsonc
D1_DATABASE_NAME = "cubewizard-db"

# Default wrangler environment ("stg" or "prod")
D1_ENV = "prod"


# ---------------------------------------------------------------------------
# SQL helpers
# ---------------------------------------------------------------------------

def _escape_sql(value: str) -> str:
    """Escape a string for a SQL literal (single-quote doubling)."""
    if value is None:
        return "NULL"
    return value.replace("'", "''")


def _sql_value(value) -> str:
    """Convert a Python value to its SQL literal representation."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return f"'{_escape_sql(value)}'"
    if isinstance(value, (list, dict)):
        return f"'{_escape_sql(json.dumps(value))}'"
    return f"'{_escape_sql(str(value))}'"


# ---------------------------------------------------------------------------
# SQL builder
# ---------------------------------------------------------------------------

def _build_insert_sql(cube_id: str, deck_data: Dict[str, Any]) -> str:
    """
    Build a multi-statement SQL script that inserts one deck (with cards
    and stats) into D1.  Mirrors what database_manager.add_deck() did
    for local SQLite.

    The script:
      1. INSERT OR IGNORE into cubes
      2. INSERT into decks  (deck_id is AUTOINCREMENT)
      3. INSERT into deck_stats  (uses last_insert_rowid())
      4. INSERT into deck_cards  (uses a subquery for deck_id)
      5. UPDATE cubes total_decks / last_updated
    """
    metadata = deck_data["deck"]["metadata"]
    cards_data = deck_data["deck"]["cards"]

    now = metadata.get("record_logged", "")
    stmts: list[str] = []

    # 1 — cube
    stmts.append(
        f"INSERT OR IGNORE INTO cubes (cube_id, created, last_updated, total_decks) "
        f"VALUES ({_sql_value(cube_id)}, {_sql_value(now)}, {_sql_value(now)}, 0);"
    )

    # 2 — deck
    stmts.append(
        f"INSERT INTO decks "
        f"(cube_id, pilot_name, match_wins, match_losses, match_draws, win_rate, "
        f"record_logged, image_source, processing_timestamp, total_cards) "
        f"VALUES ("
        f"{_sql_value(cube_id)}, "
        f"{_sql_value(metadata['pilot_name'])}, "
        f"{_sql_value(metadata['match_wins'])}, "
        f"{_sql_value(metadata['match_losses'])}, "
        f"{_sql_value(metadata.get('match_draws', 0))}, "
        f"{_sql_value(metadata['win_rate'])}, "
        f"{_sql_value(metadata['record_logged'])}, "
        f"{_sql_value(metadata.get('image_source', ''))}, "
        f"{_sql_value(metadata['processing_timestamp'])}, "
        f"{_sql_value(metadata['total_cards'])}"
        f");"
    )

    # 3 — deck_stats  (last_insert_rowid() = new deck_id)
    stmts.append(
        f"INSERT INTO deck_stats (deck_id, total_found, total_not_found) "
        f"VALUES (last_insert_rowid(), "
        f"{_sql_value(cards_data.get('total_found', 0))}, "
        f"{_sql_value(cards_data.get('total_not_found', 0))});"
    )

    # 4 — deck_cards
    #     last_insert_rowid() changed after deck_stats, so look up by
    #     the unique (cube_id, processing_timestamp, pilot_name) triple.
    processing_ts = _escape_sql(metadata["processing_timestamp"])
    pilot = _escape_sql(metadata["pilot_name"])
    deck_id_sub = (
        f"(SELECT deck_id FROM decks "
        f"WHERE cube_id = {_sql_value(cube_id)} "
        f"AND processing_timestamp = '{processing_ts}' "
        f"AND pilot_name = '{pilot}' "
        f"ORDER BY deck_id DESC LIMIT 1)"
    )

    for card in cards_data.get("cards", []):
        stmts.append(
            f"INSERT INTO deck_cards "
            f"(deck_id, name, mana_cost, cmc, type_line, colors, color_identity, "
            f"rarity, set_code, set_name, collector_number, power, toughness, "
            f"oracle_text, scryfall_uri, image_uris, prices) "
            f"VALUES ("
            f"{deck_id_sub}, "
            f"{_sql_value(card.get('name'))}, "
            f"{_sql_value(card.get('mana_cost'))}, "
            f"{_sql_value(card.get('cmc'))}, "
            f"{_sql_value(card.get('type_line'))}, "
            f"{_sql_value(json.dumps(card.get('colors', [])))}, "
            f"{_sql_value(json.dumps(card.get('color_identity', [])))}, "
            f"{_sql_value(card.get('rarity'))}, "
            f"{_sql_value(card.get('set'))}, "
            f"{_sql_value(card.get('set_name'))}, "
            f"{_sql_value(card.get('collector_number'))}, "
            f"{_sql_value(card.get('power'))}, "
            f"{_sql_value(card.get('toughness'))}, "
            f"{_sql_value(card.get('oracle_text'))}, "
            f"{_sql_value(card.get('scryfall_uri'))}, "
            f"{_sql_value(json.dumps(card.get('image_uris', {})))}, "
            f"{_sql_value(json.dumps(card.get('prices', {})))}"
            f");"
        )

    # 5 — update cube counters
    stmts.append(
        f"UPDATE cubes SET "
        f"total_decks = (SELECT COUNT(*) FROM decks WHERE cube_id = {_sql_value(cube_id)}), "
        f"last_updated = {_sql_value(now)} "
        f"WHERE cube_id = {_sql_value(cube_id)};"
    )

    return "\n".join(stmts)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def add_deck(cube_id: str, deck_data: Dict[str, Any],
             env: Optional[str] = None) -> bool:
    """
    Write a deck (metadata + cards + stats) to Cloudflare D1.

    Args:
        cube_id:   CubeCobra cube identifier.
        deck_data: Deck data dict built by CubeWizard.process_single_image().
        env:       Wrangler environment override ("stg" / "prod").

    Returns:
        True on success, False on failure.
    """
    target_env = env if env is not None else D1_ENV
    sql_script = _build_insert_sql(cube_id, deck_data)

    tmp_path: Optional[str] = None
    try:
        # Write SQL to a temp file — safer than --command for large scripts
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".sql", delete=False, encoding="utf-8"
        ) as tmp:
            tmp.write(sql_script)
            tmp_path = tmp.name

        cmd = [
            "npx", "wrangler", "d1", "execute",
            D1_DATABASE_NAME,
            "--file", tmp_path,
            "--remote",
        ]
        if target_env:
            cmd.extend(["--env", target_env])

        print(f"\n  Writing to D1 ({target_env or 'default'})...")

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=str(Path(__file__).parent),
            timeout=120,
            shell=True,
            encoding="utf-8",
            errors="replace",
        )

        if result.returncode == 0:
            print("  [OK] D1 write successful")
            return True

        # --- failure diagnostics ---
        print("  [FAIL] D1 write failed:")
        for stream in (result.stderr, result.stdout):
            if not stream:
                continue
            for line in stream.strip().splitlines():
                line = line.strip()
                if line:
                    print(f"    {line}")
        return False

    except subprocess.TimeoutExpired:
        print("  [FAIL] D1 write timed out (120 s)")
        return False
    except FileNotFoundError:
        print("  [FAIL] D1 write failed: 'npx' not found -- is Node.js installed?")
        return False
    except Exception as exc:
        print(f"  [FAIL] D1 write failed: {exc}")
        return False
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


def _run_d1_query(sql: str, env: Optional[str] = None) -> Optional[list]:
    """
    Run a read-only SQL query against D1 and return parsed result rows.

    Returns a list of row dicts on success, None on failure.
    """
    target_env = env if env is not None else D1_ENV
    cmd = [
        "npx", "wrangler", "d1", "execute",
        D1_DATABASE_NAME,
        "--command", sql,
        "--remote",
        "--json",
    ]
    if target_env:
        cmd.extend(["--env", target_env])

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=str(Path(__file__).parent),
            timeout=30,
            shell=True,
            encoding="utf-8",
            errors="replace",
        )
        if result.returncode == 0 and result.stdout:
            data = json.loads(result.stdout)
            # wrangler --json returns [{ "results": [...], "success": true, ... }]
            if data and isinstance(data, list) and data[0].get("success"):
                return data[0].get("results", [])
        return None
    except Exception:
        return None


def get_cube_id_by_name(cube_name: str, env: Optional[str] = None) -> Optional[str]:
    """
    Look up a cube_id from the cube_mapping table by human-readable name.

    Args:
        cube_name: Human-readable cube name (e.g. "The Bacon Vintage Cube").
        env:       Wrangler environment override.

    Returns:
        The cube_id string if found, None otherwise.
    """
    safe_name = cube_name.replace("'", "''")
    sql = f"SELECT cube_id FROM cube_mapping WHERE cube_name = '{safe_name}' LIMIT 1;"
    rows = _run_d1_query(sql, env)
    if rows and len(rows) > 0:
        return rows[0].get("cube_id")
    return None
