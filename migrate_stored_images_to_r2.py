#!/usr/bin/env python3
"""
One-time (resumable) migration: upload files from output/stored_images to the
oriented R2 blob bucket, set decks.oriented_image_r2_key, and upload a WebP
thumbnail (oriented_thumb_r2_key) per deck.

Skips rows that already have oriented_image_r2_key set unless --force.

Usage:
    python migrate_stored_images_to_r2.py --dry-run
    python migrate_stored_images_to_r2.py
    python migrate_stored_images_to_r2.py --output-root path/to/output
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

import d1_writer
import oriented_r2


def _list_decks_needing_migration():
    """Return deck rows with stored_image_path and missing oriented key."""
    from d1_writer import _execute_single  # noqa: PLC0415

    rows = _execute_single(
        "SELECT deck_id, cube_id, image_id, stored_image_path, oriented_image_r2_key "
        "FROM decks WHERE stored_image_path IS NOT NULL AND TRIM(stored_image_path) != '' "
        "ORDER BY deck_id;"
    )
    return rows or []


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate local stored_images to R2 blob bucket")
    parser.add_argument(
        "--output-root",
        default=None,
        help="Path to output directory containing stored_images/ (default: config output dir)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print actions without uploading")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-upload and overwrite even if oriented_image_r2_key is already set",
    )
    args = parser.parse_args()

    if args.output_root:
        base = Path(args.output_root)
    else:
        from config_manager import config  # noqa: PLC0415

        base = Path(config.get_output_directory())

    stored_root = base / "stored_images"
    if not stored_root.is_dir():
        print(f"ERROR: Not a directory: {stored_root}")
        return 1

    try:
        rows = _list_decks_needing_migration()
    except Exception as exc:
        print(f"ERROR: D1 query failed: {exc}")
        return 1

    uploaded = 0
    skipped = 0
    failed = 0

    for row in rows:
        deck_id = row["deck_id"]
        cube_id = row["cube_id"]
        image_id = row["image_id"]
        raw_rel = (row.get("stored_image_path") or "").strip()
        rel = d1_writer.normalize_stored_image_path_relative_to_output(raw_rel)
        existing = (row.get("oriented_image_r2_key") or "").strip()

        if existing and not args.force:
            skipped += 1
            continue

        if not rel or not image_id:
            print(f"  [SKIP] deck_id={deck_id} missing stored_image_path or image_id")
            skipped += 1
            continue

        if rel != raw_rel:
            if args.dry_run:
                print(f"  [DRY] deck_id={deck_id} would normalize stored_image_path: {raw_rel!r} -> {rel!r}")
            else:
                print(f"  [FIX] deck_id={deck_id} normalize stored_image_path: {raw_rel!r} -> {rel!r}")
                d1_writer.update_stored_image_path(deck_id, rel)

        local_path = base / rel
        if not local_path.is_file():
            print(f"  [FAIL] deck_id={deck_id} file not found: {local_path}")
            failed += 1
            continue

        key = oriented_r2.oriented_object_key(cube_id, image_id, local_path.suffix)
        print(f"  deck_id={deck_id} {local_path.name} -> {key}")

        if args.dry_run:
            uploaded += 1
            continue

        ok = oriented_r2.upload_oriented_image(local_path, cube_id, image_id)
        if ok:
            if not d1_writer.update_oriented_image_r2_key(deck_id, ok):
                failed += 1
                continue
            thumb_key = oriented_r2.upload_oriented_thumb(local_path, cube_id, image_id)
            if thumb_key:
                d1_writer.update_oriented_thumb_r2_key(deck_id, thumb_key)
            uploaded += 1
        else:
            failed += 1

    print(
        f"\nDone. uploaded={uploaded} skipped_already_set={skipped} failed={failed} dry_run={args.dry_run}"
    )
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
