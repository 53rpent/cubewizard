from __future__ import annotations

import os
import tempfile
import base64
import csv
import json
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import boto3
from botocore.config import Config as BotoConfig
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from google.cloud import firestore

from main import CubeWizard


load_dotenv()

app = FastAPI(title="cubewizard-worker")


class TaskRequest(BaseModel):
    upload_id: str = Field(..., min_length=1)
    r2_bucket: str = Field(..., min_length=1)
    r2_prefix: str = Field(..., min_length=1)
    cube_id: Optional[str] = None
    pilot_name: Optional[str] = None
    submitted_at: Optional[str] = None
    schema_version: int = 1


def _required_env(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        raise RuntimeError(f"Missing required env var: {name}")
    return v


def _r2_client():
    endpoint = _required_env("R2_ENDPOINT_URL")
    key_id = _required_env("R2_ACCESS_KEY_ID")
    secret = _required_env("R2_SECRET_ACCESS_KEY")
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=key_id,
        aws_secret_access_key=secret,
        config=BotoConfig(
            signature_version="s3v4",
            connect_timeout=10,
            read_timeout=300,
            retries={"max_attempts": 3},
        ),
        region_name="auto",
    )


def _download_prefix_to_dir(s3, bucket: str, prefix: str, dest: Path) -> Dict[str, str]:
    """
    Download objects under prefix into dest. Returns a mapping of key->local path.
    """
    dest.mkdir(parents=True, exist_ok=True)
    out: Dict[str, str] = {}
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            rel = key[len(prefix):].lstrip("/")
            local = dest / rel
            local.parent.mkdir(parents=True, exist_ok=True)
            s3.download_file(bucket, key, str(local))
            out[key] = str(local)
    return out


def _firestore_client() -> firestore.Client:
    database = os.environ.get("FIRESTORE_DATABASE_ID") or "(default)"
    return firestore.Client(database=database)

def _job_doc_id(upload_id: str) -> str:
    raw = (upload_id or "").encode("utf-8")
    token = base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")
    return f"u_{token}"

def _materialize_submission_csv_and_image(submission_folder: Path) -> None:
    """
    Convert the R2 upload format (metadata.json + image.*) into the local folder
    structure that CubeWizard.process_submissions expects (pilot_data.csv + deck_image.*).
    """
    meta_path = submission_folder / "metadata.json"
    if not meta_path.is_file():
        # Sometimes the R2 prefix sent to the worker is too broad (e.g. only cube_id),
        # causing downloaded files to land in subfolders under submission_folder.
        # Find the first metadata.json under this submission and use it.
        meta_candidates = sorted(submission_folder.rglob("metadata.json"))
        if not meta_candidates:
            raise FileNotFoundError(f"metadata.json not found in {submission_folder}")
        meta_path = meta_candidates[0]

    with open(meta_path, "r", encoding="utf-8") as f:
        metadata = json.load(f)

    # Write pilot_data.csv in the format main.py expects.
    csv_path = submission_folder / "pilot_data.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "pilot_name",
                "match_wins",
                "match_losses",
                "match_draws",
                "cube_id",
            ],
        )
        writer.writeheader()
        writer.writerow(
            {
                "pilot_name": metadata.get("pilot_name", "Unknown"),
                "match_wins": metadata.get("match_wins", metadata.get("wins", 0)),
                "match_losses": metadata.get("match_losses", metadata.get("losses", 0)),
                "match_draws": metadata.get("match_draws", metadata.get("draws", 0)),
                "cube_id": metadata.get("cube_id", ""),
            }
        )

    # Ensure the image is named deck_image.<ext> for process_submissions().
    image_files = sorted(
        [p for p in submission_folder.rglob("image.*") if p.is_file()],
        key=lambda p: str(p).lower(),
    )
    if not image_files:
        raise FileNotFoundError(f"No image.* found in {submission_folder}")
    src = image_files[0]
    ext = src.suffix or ".jpg"
    dest = submission_folder / f"deck_image{ext}"
    if src == dest:
        pass
    else:
        # Ensure only one image is present for process_submissions().
        # Put the canonical image at the submission root and delete any other image.* files.
        if dest.exists():
            try:
                dest.unlink()
            except Exception:
                pass

        # If the source is already in the submission root, rename/move it.
        if src.parent == submission_folder:
            src.rename(dest)
        else:
            dest.write_bytes(src.read_bytes())

        # Remove other image.* files to avoid double-processing.
        for p in image_files:
            if p == src:
                continue
            try:
                p.unlink()
            except Exception:
                pass

        # If we copied from a nested folder, also delete that source file.
        if src.parent != submission_folder:
            try:
                src.unlink()
            except Exception:
                pass

    # If the download prefix was too broad, artifacts may exist in nested directories.
    # To ensure process_submissions doesn't double-process, remove any subdirectories
    # under the submission root now that we've materialized the canonical files.
    for child in list(submission_folder.iterdir()):
        if child.is_dir():
            try:
                shutil.rmtree(child)
            except Exception:
                pass

    # Also remove any stray image files at the submission root besides deck_image.*.
    image_exts = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".bmp", ".tiff"}
    for child in list(submission_folder.iterdir()):
        if not child.is_file():
            continue
        if child.suffix.lower() in image_exts and not child.name.lower().startswith("deck_image."):
            try:
                child.unlink()
            except Exception:
                pass

    # Also ensure metadata.json exists at submission root for debugging/inspection.
    if meta_path.parent != submission_folder:
        root_meta = submission_folder / "metadata.json"
        if not root_meta.exists():
            try:
                root_meta.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
            except Exception:
                pass


@app.get("/healthz")
def healthz() -> Dict[str, str]:
    return {"ok": "true"}


@app.post("/tasks/eval")
async def run_task(req: TaskRequest) -> Dict[str, Any]:
    jobs_collection = os.environ.get("FIRESTORE_COLLECTION", "jobs")
    fs = _firestore_client()
    job_ref = fs.collection(jobs_collection).document(_job_doc_id(req.upload_id))

    lease_minutes = int(os.environ.get("JOB_LEASE_MINUTES", "45"))

    # Idempotency / claim
    @firestore.transactional
    def _claim(tx: firestore.Transaction) -> Dict[str, Any]:
        snap = job_ref.get(transaction=tx)
        if snap.exists:
            d = snap.to_dict() or {}
            if d.get("status") == "done":
                return {"already_done": True}
            if d.get("status") == "running":
                lease_expires = d.get("lease_expires_at")
                # If lease is missing or expired, allow reclaim.
                if isinstance(lease_expires, datetime):
                    if lease_expires.tzinfo is None:
                        lease_expires = lease_expires.replace(tzinfo=timezone.utc)
                    if lease_expires > datetime.now(timezone.utc):
                        return {"already_running": True}
        lease_until = datetime.now(timezone.utc) + timedelta(minutes=lease_minutes)
        fields: Dict[str, Any] = {
            "upload_id": req.upload_id,
            "status": "running",
            "started_at": firestore.SERVER_TIMESTAMP,
            "attempt_count": firestore.Increment(1),
            "lease_expires_at": lease_until,
            "r2_bucket": req.r2_bucket,
            "r2_prefix": req.r2_prefix,
            "schema_version": req.schema_version,
        }
        if req.cube_id is not None:
            fields["cube_id"] = req.cube_id
        if req.pilot_name is not None:
            fields["pilot_name"] = req.pilot_name

        tx.set(job_ref, fields, merge=True)
        return {"claimed": True}

    claim = _claim(fs.transaction())
    if claim.get("already_done"):
        return {"ok": True, "upload_id": req.upload_id, "status": "done"}
    if claim.get("already_running"):
        # Cloud Tasks retries on non-2xx. Since processing is already in progress,
        # acknowledge the task to avoid duplicate attempts.
        return {"ok": True, "upload_id": req.upload_id, "status": "running"}

    # Do work in a temp dir (Cloud Run writable).
    try:
        s3 = _r2_client()
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            submissions_dir = base / "submissions"
            submissions_dir.mkdir(parents=True, exist_ok=True)

            # Download staged upload into a single submission folder.
            safe_upload_id = str(req.upload_id).replace("/", "_").replace("\\", "_").replace(" ", "_")
            submission_folder = submissions_dir / f"submission_{safe_upload_id}"
            downloaded = _download_prefix_to_dir(s3, req.r2_bucket, req.r2_prefix, submission_folder)
            _materialize_submission_csv_and_image(submission_folder)

            # Run existing pipeline: process_submissions expects a directory of submission folders.
            wizard = CubeWizard()
            result = wizard.process_submissions(str(submissions_dir))

            job_ref.set(
                {
                    "status": "done",
                    "finished_at": firestore.SERVER_TIMESTAMP,
                    "result": result,
                    "downloaded_count": len(downloaded),
                },
                merge=True,
            )

            return {"ok": True, "upload_id": req.upload_id, "result": result}

    except Exception as e:
        job_ref.set(
            {
                "status": "failed",
                "finished_at": firestore.SERVER_TIMESTAMP,
                "error": str(e),
            },
            merge=True,
        )
        raise

