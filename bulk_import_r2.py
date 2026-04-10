#!/usr/bin/env python3
"""
Bulk-import deck images (and optional CSVs) to Cloudflare R2 in the same layout
as the web upload worker:

    {cube_id}/{timestamp}_{pilot}/image.{ext}
    {cube_id}/{timestamp}_{pilot}/metadata.json
    {cube_id}/{timestamp}_{pilot}/*.csv   (optional, any CSVs in the record folder)

Directory layout (one level of record folders under the cube root):

    <cube_cobra_id>/
        <Wins>-<Losses>-<Draws>/
            deck.png          (all images: jpg/jpeg/png/webp/heic/heif — one R2 submission each)
            cards.csv         (optional; uploaded once with the first image only)

- The *basename* of the top-level directory must be the CubeCobra cube ID.
- Each immediate subfolder name must be exactly ``W-L-D`` (non-negative integers).
- Pilot is always stored as ``unknown`` in metadata.
- The cube ID must already exist in D1 ``cubes`` (register the cube first); otherwise
  the script exits with an error before uploading anything.

Multiple photos in one ``W-L-D`` folder each get their own R2 prefix (separate submissions).
The pull/processing pipeline will treat each as its own deck with the same match record unless
you dedupe manually. CSV files are only stored alongside the **first** image’s submission.

Environment (same as ``pull_from_r2.py`` / R2 API):

    R2_ENDPOINT_URL
    R2_ACCESS_KEY_ID
    R2_SECRET_ACCESS_KEY
    R2_BUCKET_NAME   (default: decklist-uploads)

D1 check uses ``d1_writer.cube_id_registered`` (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN,
CLOUDFLARE_D1_DATABASE_ID).

Usage:
    python bulk_import_r2.py path/to/my_cube_id_folder
    python bulk_import_r2.py path/to/my_cube_id_folder --dry-run
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Tuple
from uuid import uuid4

from botocore.config import Config as BotoConfig
import boto3
from dotenv import load_dotenv

from d1_writer import cube_id_registered

load_dotenv()

RECORD_DIR_RE = re.compile(r"^(\d+)-(\d+)-(\d+)$")

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}

MIME_BY_EXT = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
}


def _r2_client():
    import os

    endpoint = os.environ.get("R2_ENDPOINT_URL", "")
    key_id = os.environ.get("R2_ACCESS_KEY_ID", "")
    secret = os.environ.get("R2_SECRET_ACCESS_KEY", "")
    if not all([endpoint, key_id, secret]):
        raise ValueError(
            "R2 credentials missing. Set R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, "
            "R2_SECRET_ACCESS_KEY in .env"
        )
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=key_id,
        aws_secret_access_key=secret,
        config=BotoConfig(
            signature_version="s3v4",
            connect_timeout=10,
            read_timeout=120,
            retries={"max_attempts": 3},
        ),
        region_name="auto",
    )


def _bucket_name() -> str:
    import os

    return os.environ.get("R2_BUCKET_NAME", "decklist-uploads")


def _submission_second_segment() -> str:
    """Match worker pattern: {timestamp}_{safePilot} with pilot 'unknown'."""
    now = datetime.now(timezone.utc)
    core = now.strftime("%Y-%m-%dT%H-%M-%S-%f")[:-3] + "Z"
    uniq = uuid4().hex[:8]
    # Unique per upload; worker uses ISO with :/. replaced — we avoid : in core via strftime.
    return f"{core}-{uniq}_unknown"


def _list_images(record_dir: Path) -> List[Path]:
    """All image files in the folder, sorted by name (stable order)."""
    candidates: List[Path] = []
    for p in record_dir.iterdir():
        if not p.is_file():
            continue
        if p.suffix.lower() in IMAGE_EXTS:
            candidates.append(p)
    candidates.sort(key=lambda x: x.name.lower())
    return candidates


def _list_csvs(record_dir: Path) -> List[Path]:
    out = [p for p in record_dir.iterdir() if p.is_file() and p.suffix.lower() == ".csv"]
    out.sort(key=lambda x: x.name.lower())
    return out


def _safe_extra_filename(name: str) -> str:
    """Only allow simple filenames for extra objects (e.g. CSV)."""
    base = Path(name).name
    if not base or base != name or "/" in name or "\\" in name:
        raise ValueError(f"Unsafe filename: {name!r}")
    for ch in base:
        if ch not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-":
            raise ValueError(f"Filename has disallowed character: {base!r}")
    return base


def _parse_record_dir(name: str) -> Optional[Tuple[int, int, int]]:
    m = RECORD_DIR_RE.match(name.strip())
    if not m:
        return None
    return int(m.group(1)), int(m.group(2)), int(m.group(3))


def import_record_folder(
    s3,
    bucket: str,
    cube_id: str,
    record_dir: Path,
    wins: int,
    losses: int,
    draws: int,
    dry_run: bool,
) -> bool:
    """
    Upload every image in *record_dir* as its own R2 submission (same W-L-D metadata).
    CSVs attach only to the first submission to avoid duplicate copies.
    """
    image_paths = _list_images(record_dir)
    if not image_paths:
        print(f"  SKIP {record_dir.name}: no image file ({', '.join(sorted(IMAGE_EXTS))})")
        return False

    csv_paths = _list_csvs(record_dir)
    win_rate = (wins + losses) > 0 and (wins / (wins + losses)) or 0.0
    now_iso = datetime.now(timezone.utc).isoformat()

    any_ok = False
    for idx, image_path in enumerate(image_paths):
        ext = image_path.suffix.lower()
        mime = MIME_BY_EXT.get(ext) or mimetypes.guess_type(str(image_path))[0] or "application/octet-stream"

        seg = _submission_second_segment()
        prefix = f"{cube_id}/{seg}"
        image_key = f"{prefix}/image{ext}"

        metadata = {
            "cube_id": cube_id,
            "pilot_name": "unknown",
            "match_wins": wins,
            "match_losses": losses,
            "match_draws": draws,
            "win_rate": win_rate,
            "record_logged": now_iso,
            "image_key": image_key,
            "original_filename": image_path.name,
            "bulk_import": True,
            "bulk_import_image_index": idx + 1,
            "bulk_import_image_total": len(image_paths),
        }

        print(f"  {record_dir.name} [{idx + 1}/{len(image_paths)}] -> {prefix}/")
        print(f"    image: {image_path.name} -> {image_key}")

        if dry_run:
            if idx == 0:
                for c in csv_paths:
                    safe = _safe_extra_filename(c.name)
                    print(f"    csv:   {c.name} -> {prefix}/{safe}")
                print(f"    metadata.json (pilot unknown, W-L-D {wins}-{losses}-{draws})")
            else:
                print(f"    metadata.json (same record; CSVs only on first image)")
            any_ok = True
            continue

        with open(image_path, "rb") as f:
            s3.put_object(
                Bucket=bucket,
                Key=image_key,
                Body=f.read(),
                ContentType=mime,
            )

        if idx == 0:
            for c in csv_paths:
                safe_name = _safe_extra_filename(c.name)
                ck = f"{prefix}/{safe_name}"
                with open(c, "rb") as f:
                    body = f.read()
                s3.put_object(
                    Bucket=bucket,
                    Key=ck,
                    Body=body,
                    ContentType="text/csv; charset=utf-8",
                )
                print(f"    uploaded csv: {ck}")

        meta_key = f"{prefix}/metadata.json"
        s3.put_object(
            Bucket=bucket,
            Key=meta_key,
            Body=json.dumps(metadata, indent=2).encode("utf-8"),
            ContentType="application/json; charset=utf-8",
        )
        print(f"    uploaded metadata: {meta_key}")
        any_ok = True

    return any_ok


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Bulk-import images (+ optional CSVs) to R2 for CubeWizard."
    )
    parser.add_argument(
        "directory",
        type=Path,
        help="Top-level folder whose name is the CubeCobra cube ID; contains W-L-D subfolders",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned uploads without writing to R2",
    )
    args = parser.parse_args()

    root: Path = args.directory.expanduser().resolve()
    if not root.is_dir():
        print(f"Error: not a directory: {root}", file=sys.stderr)
        return 1

    cube_id = root.name
    if not cube_id or cube_id in (".", ".."):
        print("Error: could not derive cube ID from directory name.", file=sys.stderr)
        return 1

    try:
        if not cube_id_registered(cube_id):
            print(
                f"Error: cube_id {cube_id!r} is not registered in D1 (cubes table). "
                "Add the cube via the site first.",
                file=sys.stderr,
            )
            return 1
    except Exception as e:
        print(f"Error checking D1: {e}", file=sys.stderr)
        return 1

    subdirs = sorted([p for p in root.iterdir() if p.is_dir()], key=lambda p: p.name)
    if not subdirs:
        print(f"No subfolders found under {root}", file=sys.stderr)
        return 1

    print(f"Cube ID: {cube_id}")
    print(f"R2 bucket: {_bucket_name()}")
    if args.dry_run:
        print("(dry-run: no objects will be written)\n")
    else:
        print()

    s3 = None
    if not args.dry_run:
        try:
            s3 = _r2_client()
        except Exception as e:
            print(f"Error connecting to R2: {e}", file=sys.stderr)
            return 1

    bucket = _bucket_name()
    ok = 0
    skipped = 0

    for d in subdirs:
        parsed = _parse_record_dir(d.name)
        if not parsed:
            print(f"SKIP (name not W-L-D): {d.name}")
            skipped += 1
            continue
        w, l, dr = parsed
        try:
            if import_record_folder(s3, bucket, cube_id, d, w, l, dr, args.dry_run):
                ok += 1
            else:
                skipped += 1
        except Exception as e:
            print(f"  ERROR {d.name}: {e}", file=sys.stderr)
            skipped += 1

    print(f"\nDone. Uploaded: {ok}, skipped/errors: {skipped}")
    if ok == 0:
        print("No records were imported.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
