from __future__ import annotations

import os
import tempfile
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


@app.get("/healthz")
def healthz() -> Dict[str, str]:
    return {"ok": "true"}


@app.post("/tasks/eval")
async def run_task(req: TaskRequest) -> Dict[str, Any]:
    jobs_collection = os.environ.get("FIRESTORE_COLLECTION", "jobs")
    fs = _firestore_client()
    job_ref = fs.collection(jobs_collection).document(req.upload_id)

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
        tx.set(
            job_ref,
            {
                "status": "running",
                "started_at": firestore.SERVER_TIMESTAMP,
                "attempt_count": firestore.Increment(1),
                "lease_expires_at": lease_until,
                "r2_bucket": req.r2_bucket,
                "r2_prefix": req.r2_prefix,
                "schema_version": req.schema_version,
            },
            merge=True,
        )
        return {"claimed": True}

    claim = _claim(fs.transaction())
    if claim.get("already_done"):
        return {"ok": True, "upload_id": req.upload_id, "status": "done"}
    if claim.get("already_running"):
        raise HTTPException(status_code=409, detail="job already running")

    # Do work in a temp dir (Cloud Run writable).
    try:
        s3 = _r2_client()
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            submissions_dir = base / "submissions"
            submissions_dir.mkdir(parents=True, exist_ok=True)

            # Download staged upload into a single submission folder.
            submission_folder = submissions_dir / f"submission_{req.upload_id}"
            downloaded = _download_prefix_to_dir(s3, req.r2_bucket, req.r2_prefix, submission_folder)

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

