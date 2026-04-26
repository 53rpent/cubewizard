from __future__ import annotations

import base64
import hmac
import hashlib
import json
import os
from typing import Any, Dict, Optional

from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field

from google.cloud import firestore
from google.cloud import tasks_v2


app = FastAPI(title="cubewizard-enqueue")


class EnqueueRequest(BaseModel):
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


def _verify_shared_secret(x_shared_secret: Optional[str]) -> None:
    expected = _required_env("ENQUEUE_SHARED_SECRET")
    if not x_shared_secret or not hmac.compare_digest(x_shared_secret, expected):
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/healthz")
def healthz() -> Dict[str, str]:
    return {"ok": "true"}


@app.post("/enqueue")
async def enqueue(
    req: EnqueueRequest,
    request: Request,
    x_shared_secret: Optional[str] = Header(default=None, convert_underscores=False),
) -> Dict[str, Any]:
    _verify_shared_secret(x_shared_secret)

    project = _required_env("GCP_PROJECT_ID")
    location = _required_env("GCP_LOCATION")  # us-east1
    queue = _required_env("CLOUD_TASKS_QUEUE")
    worker_url = _required_env("WORKER_URL")  # https://<worker-service>/tasks/eval
    oidc_sa = _required_env("TASK_OIDC_SERVICE_ACCOUNT")

    jobs_collection = os.environ.get("FIRESTORE_COLLECTION", "jobs")

    # Upsert Firestore status to queued (but don't overwrite done).
    fs = firestore.Client()
    job_ref = fs.collection(jobs_collection).document(req.upload_id)

    def _txn(tx: firestore.Transaction) -> None:
        snap = job_ref.get(transaction=tx)
        if snap.exists:
            d = snap.to_dict() or {}
            if d.get("status") == "done":
                return
        tx.set(
            job_ref,
            {
                "status": "queued",
                "r2_bucket": req.r2_bucket,
                "r2_prefix": req.r2_prefix,
                "submitted_at": req.submitted_at,
                "schema_version": req.schema_version,
                "created_at": firestore.SERVER_TIMESTAMP,
                "attempt_count": firestore.Increment(0),
            },
            merge=True,
        )

    fs.transaction()( _txn )  # type: ignore[misc]

    # Enqueue Cloud Task (HTTP target).
    client = tasks_v2.CloudTasksClient()
    parent = client.queue_path(project, location, queue)

    payload = req.model_dump()
    body = json.dumps(payload).encode("utf-8")

    task = {
        "http_request": {
            "http_method": tasks_v2.HttpMethod.POST,
            "url": worker_url,
            "headers": {"Content-Type": "application/json"},
            "body": body,
            "oidc_token": {
                "service_account_email": oidc_sa,
                # Cloud Run generally accepts audience as the target URL.
                "audience": worker_url,
            },
        }
    }

    created = client.create_task(request={"parent": parent, "task": task})

    return {"enqueued": True, "task_name": created.name, "upload_id": req.upload_id}

