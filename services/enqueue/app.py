from __future__ import annotations

import base64
import hmac
import json
import os
from typing import Any, Dict, Optional

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from google.cloud import firestore
from google.cloud import tasks_v2
from google.api_core import exceptions as gcp_exceptions
import logging


app = FastAPI(title="cubewizard-enqueue")
log = logging.getLogger("cubewizard.enqueue")


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    # Ensure callers always get a JSON body rather than plain-text 500s.
    log.exception("Unhandled exception: %s", exc)
    return JSONResponse(
        status_code=500,
        content={"detail": f"internal error: {type(exc).__name__}: {str(exc)}"},
    )


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

def _firestore_client() -> firestore.Client:
    # Firestore supports multiple databases. If you created a non-default database,
    # set FIRESTORE_DATABASE_ID to that database name (e.g. "cw-upload-status").
    database = os.environ.get("FIRESTORE_DATABASE_ID") or "(default)"
    return firestore.Client(database=database)


@app.get("/healthz")
def healthz() -> Dict[str, str]:
    return {"ok": "true"}


@app.post("/enqueue")
async def enqueue(
    req: EnqueueRequest,
    request: Request,
    x_shared_secret: Optional[str] = Header(default=None, alias="X-Shared-Secret"),
) -> Dict[str, Any]:
    _verify_shared_secret(x_shared_secret)

    project = _required_env("GCP_PROJECT_ID")
    location = _required_env("GCP_LOCATION")  # us-east1
    queue = _required_env("CLOUD_TASKS_QUEUE")
    worker_url = _required_env("WORKER_URL")  # https://<worker-service>/tasks/eval
    oidc_sa = _required_env("TASK_OIDC_SERVICE_ACCOUNT")

    jobs_collection = os.environ.get("FIRESTORE_COLLECTION", "jobs")

    # Upsert Firestore status to queued (but don't overwrite done).
    fs = _firestore_client()
    job_ref = fs.collection(jobs_collection).document(req.upload_id)

    snap = job_ref.get()
    if snap.exists:
        d = snap.to_dict() or {}
        if d.get("status") == "done":
            # Idempotency: if already completed, don't regress status.
            pass
        else:
            job_ref.set(
                {
                    "status": "queued",
                    "r2_bucket": req.r2_bucket,
                    "r2_prefix": req.r2_prefix,
                    "submitted_at": req.submitted_at,
                    "schema_version": req.schema_version,
                    "created_at": firestore.SERVER_TIMESTAMP,
                },
                merge=True,
            )
    else:
        job_ref.set(
            {
                "status": "queued",
                "r2_bucket": req.r2_bucket,
                "r2_prefix": req.r2_prefix,
                "submitted_at": req.submitted_at,
                "schema_version": req.schema_version,
                "created_at": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    # Enqueue Cloud Task (HTTP target).
    client = tasks_v2.CloudTasksClient()
    parent = client.queue_path(project, location, queue)

    payload = req.model_dump()
    body_bytes = json.dumps(payload).encode("utf-8")
    # Cloud Tasks requires the HTTP body to be base64-encoded.
    body_b64 = base64.b64encode(body_bytes).decode("utf-8")

    task = {
        "http_request": {
            "http_method": tasks_v2.HttpMethod.POST,
            "url": worker_url,
            "headers": {"Content-Type": "application/json"},
            "body": body_b64,
            "oidc_token": {
                "service_account_email": oidc_sa,
                # Cloud Run generally accepts audience as the target URL.
                "audience": worker_url,
            },
        }
    }

    try:
        created = client.create_task(request={"parent": parent, "task": task})
    except gcp_exceptions.GoogleAPICallError as exc:
        msg = getattr(exc, "message", None) or str(exc)
        log.exception("Cloud Tasks create_task failed (GoogleAPICallError): %s", msg)
        raise HTTPException(status_code=502, detail=f"cloudtasks create_task failed: {msg}") from exc
    except Exception as exc:
        # grpc._channel._InactiveRpcError sometimes bypasses GoogleAPICallError wrapping.
        msg = str(exc)
        log.exception("Cloud Tasks create_task failed (unknown exception): %s", msg)
        raise HTTPException(status_code=502, detail=f"cloudtasks create_task failed: {msg}") from exc

    return {"enqueued": True, "task_name": created.name, "upload_id": req.upload_id}

