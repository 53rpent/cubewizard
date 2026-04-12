"""
Upload oriented deck images to the dedicated R2 blob bucket (separate from staging uploads).

Key layout: {cube_id}/{image_id}{ext} — stable for URLs and migration.
"""

from __future__ import annotations

import os
import io
from pathlib import Path
from typing import Optional, Union

import boto3
from botocore.config import Config as BotoConfig
from dotenv import load_dotenv

load_dotenv()


def oriented_object_key(cube_id: str, image_id: str, ext: str) -> str:
    """Build R2 object key for an oriented deck image."""
    e = ext if ext.startswith(".") else f".{ext}"
    e = e.lower()
    return f"{cube_id}/{image_id}{e}"


def oriented_thumb_object_key(cube_id: str, image_id: str) -> str:
    """Fixed WebP thumbnail key for list views (long edge capped)."""
    return f"{cube_id}/{image_id}_thumb.webp"


# Longest edge for thumbnails (CSS display is ~52px; 256 covers retina).
THUMB_MAX_SIDE = 256
THUMB_WEBP_QUALITY = 82


def build_thumb_webp_bytes(source: Union[Path, bytes]) -> bytes:
    """Resize image to fit within THUMB_MAX_SIDE and encode as WebP."""
    try:
        from pillow_heif import register_heif_opener

        register_heif_opener()
    except ImportError:
        pass
    from PIL import Image

    if isinstance(source, Path):
        im = Image.open(source)
    else:
        im = Image.open(io.BytesIO(source))

    if im.mode == "P":
        im = im.convert("RGBA")
    elif im.mode == "L":
        im = im.convert("RGB")
    elif im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGB")

    im.thumbnail((THUMB_MAX_SIDE, THUMB_MAX_SIDE), Image.Resampling.LANCZOS)

    out = io.BytesIO()
    im.save(
        out,
        format="WEBP",
        quality=THUMB_WEBP_QUALITY,
        method=6,
    )
    return out.getvalue()


def _s3_client():
    endpoint = os.environ.get("R2_ENDPOINT_URL", "")
    key_id = os.environ.get("R2_ACCESS_KEY_ID", "")
    secret = os.environ.get("R2_SECRET_ACCESS_KEY", "")
    if not all([endpoint, key_id, secret]):
        raise ValueError(
            "R2 credentials missing for blob upload. Set R2_ENDPOINT_URL, "
            "R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in .env"
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


def _content_type_for_ext(ext: str) -> str:
    ext = ext.lower().lstrip(".")
    return {
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp",
        "heic": "image/heic",
        "heif": "image/heif",
    }.get(ext, "application/octet-stream")


def upload_oriented_image(
    local_file: Path,
    cube_id: str,
    image_id: str,
    *,
    bucket_name: Optional[str] = None,
) -> Optional[str]:
    """
    Upload a local oriented image file to the blob bucket.

    Returns the object key on success, or None on failure (logs reason).
    """
    bucket = bucket_name or os.environ.get("R2_ORIENTED_BUCKET_NAME", "cubewizard-deck-images")
    if not local_file.is_file():
        print(f"  [R2 blob] File not found: {local_file}")
        return None
    ext = local_file.suffix or ".jpg"
    key = oriented_object_key(cube_id, image_id, ext)
    try:
        client = _s3_client()
        extra = {"ContentType": _content_type_for_ext(ext)}
        client.upload_file(str(local_file), bucket, key, ExtraArgs=extra)
        print(f"  [R2 blob] Uploaded oriented image -> {bucket}/{key}")
        return key
    except Exception as exc:
        print(f"  [R2 blob] Upload failed: {exc}")
        return None


def upload_oriented_thumb(
    local_file: Path,
    cube_id: str,
    image_id: str,
    *,
    bucket_name: Optional[str] = None,
) -> Optional[str]:
    """
    Build a WebP thumbnail from a local oriented image and upload to the blob bucket.

    Returns the object key on success, or None on failure.
    """
    bucket = bucket_name or os.environ.get("R2_ORIENTED_BUCKET_NAME", "cubewizard-deck-images")
    if not local_file.is_file():
        print(f"  [R2 blob] Thumb: file not found: {local_file}")
        return None
    key = oriented_thumb_object_key(cube_id, image_id)
    try:
        data = build_thumb_webp_bytes(local_file)
        client = _s3_client()
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=data,
            ContentType="image/webp",
        )
        print(f"  [R2 blob] Uploaded thumb -> {bucket}/{key} ({len(data)} bytes)")
        return key
    except Exception as exc:
        print(f"  [R2 blob] Thumb upload failed: {exc}")
        return None


def download_object_bytes(bucket: str, key: str) -> Optional[bytes]:
    """Download an object from R2; return bytes or None on failure."""
    try:
        client = _s3_client()
        resp = client.get_object(Bucket=bucket, Key=key)
        return resp["Body"].read()
    except Exception as exc:
        print(f"  [R2 blob] Download failed {bucket}/{key}: {exc}")
        return None


def upload_thumb_webp_bytes(
    data: bytes,
    cube_id: str,
    image_id: str,
    *,
    bucket_name: Optional[str] = None,
) -> Optional[str]:
    """Upload pre-built WebP bytes to the standard thumb key."""
    bucket = bucket_name or os.environ.get("R2_ORIENTED_BUCKET_NAME", "cubewizard-deck-images")
    key = oriented_thumb_object_key(cube_id, image_id)
    try:
        client = _s3_client()
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=data,
            ContentType="image/webp",
        )
        print(f"  [R2 blob] Uploaded thumb -> {bucket}/{key} ({len(data)} bytes)")
        return key
    except Exception as exc:
        print(f"  [R2 blob] Thumb upload failed: {exc}")
        return None
