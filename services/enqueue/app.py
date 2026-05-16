from __future__ import annotations

import base64
import hmac
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, model_validator

from google.api_core.exceptions import NotFound
from google.api_core import exceptions as gcp_exceptions
from google.cloud import firestore
from google.cloud import tasks_v2

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
    cube_id: Optional[str] = None
    pilot_name: Optional[str] = None
    submitted_at: Optional[str] = None
    schema_version: int = 1

    # Browser-upload flow: staged objects under r2_prefix in r2_bucket
    r2_bucket: Optional[str] = None
    r2_prefix: Optional[str] = None

    # URL-source flow (e.g. Hedron): worker downloads image from this URL
    image_url: Optional[str] = None
    image_source: Optional[str] = None
    match_wins: Optional[int] = None
    match_losses: Optional[int] = None
    match_draws: Optional[int] = None

    @model_validator(mode="after")
    def _need_one_source(self) -> "EnqueueRequest":
        has_r2 = bool(self.r2_bucket and self.r2_prefix)
        has_url = bool(self.image_url)
        if not (has_r2 or has_url):
            raise ValueError("must include r2_bucket and r2_prefix, or image_url")
        return self


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

def _job_doc_id(upload_id: str) -> str:
    # Firestore document IDs cannot contain "/" (it is treated as a path separator).
    # Encode the upload_id into a URL-safe token so it can be used as a doc id.
    raw = (upload_id or "").encode("utf-8")
    token = base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")
    return f"u_{token}"


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
    job_ref = fs.collection(jobs_collection).document(_job_doc_id(req.upload_id))

    snap = job_ref.get()
    fields: Dict[str, Any] = {
        "upload_id": req.upload_id,
        "status": "queued",
        "submitted_at": req.submitted_at,
        "schema_version": req.schema_version,
        "created_at": firestore.SERVER_TIMESTAMP,
    }
    if req.r2_bucket is not None:
        fields["r2_bucket"] = req.r2_bucket
    if req.r2_prefix is not None:
        fields["r2_prefix"] = req.r2_prefix
    if req.image_url is not None:
        fields["image_url"] = req.image_url
    if req.image_source is not None:
        fields["image_source"] = req.image_source
    if req.match_wins is not None:
        fields["match_wins"] = req.match_wins
    if req.match_losses is not None:
        fields["match_losses"] = req.match_losses
    if req.match_draws is not None:
        fields["match_draws"] = req.match_draws
    if req.cube_id is not None:
        fields["cube_id"] = req.cube_id
    if req.pilot_name is not None:
        fields["pilot_name"] = req.pilot_name

    if snap.exists:
        d = snap.to_dict() or {}
        if d.get("status") == "done":
            # Idempotency: if already completed, don't regress status.
            pass
        else:
            job_ref.set(fields, merge=True)
    else:
        job_ref.set(fields, merge=True)

    # Enqueue Cloud Task (HTTP target).
    client = tasks_v2.CloudTasksClient()
    parent = client.queue_path(project, location, queue)

    payload = req.model_dump(mode="json", exclude_none=True)
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

    task_name_to_store: Optional[str] = None
    try:
        created = client.create_task(request={"parent": parent, "task": task})
        task_name_to_store = created.name
    except gcp_exceptions.GoogleAPICallError as exc:
        msg = getattr(exc, "message", None) or str(exc)
        log.exception("Cloud Tasks create_task failed (GoogleAPICallError): %s", msg)
        raise HTTPException(status_code=502, detail=f"cloudtasks create_task failed: {msg}") from exc
    except Exception as exc:
        # grpc._channel._InactiveRpcError sometimes bypasses GoogleAPICallError wrapping.
        msg = str(exc)
        log.exception("Cloud Tasks create_task failed (unknown exception): %s", msg)
        raise HTTPException(status_code=502, detail=f"cloudtasks create_task failed: {msg}") from exc

    if task_name_to_store:
        try:
            job_ref.set({"cloud_task_name": task_name_to_store}, merge=True)
        except Exception as exc:
            log.exception(
                "Failed to persist cloud_task_name on job upload_id=%s: %s",
                req.upload_id,
                exc,
            )

    return {"enqueued": True, "task_name": task_name_to_store, "upload_id": req.upload_id}


def _hedron_deck_image_uuid(upload_id: str) -> Optional[str]:
    uid = (upload_id or "").strip()
    if not uid.startswith("hedron:"):
        return None
    rest = uid[len("hedron:") :].strip()
    return rest or None


def _cleanup_verify_task_gone(client: tasks_v2.CloudTasksClient, task_name: Optional[str]) -> bool:
    """
    Returns True if no Cloud Task remains for this name (completed, exhausted, or deleted).
    Returns False if the task still exists (delivery or retries in flight).
    If task_name is missing (legacy jobs), returns True only when caller uses legacy mode.
    """
    if not task_name:
        return False
    try:
        client.get_task(name=task_name)
        return False
    except NotFound:
        return True
    except Exception as exc:
        log.warning("cleanup: get_task failed for %s: %s — skipping doc", task_name, exc)
        return False


def _release_hedron_dedupe_via_worker(deck_uuid: str) -> bool:
    """
    Previously cleared ``hedron_synced_decks`` on D1 via the site Worker's internal API.
    That route was removed; cleanup skips D1 release and leaves the Firestore doc until
    D1 is cleared manually or a replacement path exists.
    """
    log.warning(
        "cleanup: D1 hedron_synced_decks release via Worker is disabled (deck_uuid=%s); "
        "not deleting Firestore job doc",
        deck_uuid,
    )
    return False


@app.post("/cleanup/stale-hedron-jobs")
async def cleanup_stale_hedron_jobs(
    x_shared_secret: Optional[str] = Header(default=None, alias="X-Shared-Secret"),
) -> Dict[str, Any]:
    """
    For Hedron pipeline jobs stuck in Firestore as ``running`` with an expired lease:
    if the Cloud Task is no longer in the queue, delete the Firestore job doc and
    remove the deck from ``hedron_synced_decks`` (D1) so the next Hedron sync can retry.

    Invoke periodically (e.g. Cloud Scheduler) with the same ``X-Shared-Secret`` as /enqueue.

    Requires Firestore composite index: ``status`` (ASC) + ``lease_expires_at`` (ASC).

    Env:
      - CLEANUP_MAX_JOBS_PER_RUN — default 50
      - CLEANUP_LEGACY_WITHOUT_TASK_NAME — if ``1``/``true``, treat running+expired Hedron jobs
        without ``cloud_task_name`` as orphans (risky if a task still exists; prefer index backfill).
    """
    _verify_shared_secret(x_shared_secret)

    jobs_collection = os.environ.get("FIRESTORE_COLLECTION", "jobs")
    max_jobs = int(os.environ.get("CLEANUP_MAX_JOBS_PER_RUN", "50"))
    legacy_no_task = (os.environ.get("CLEANUP_LEGACY_WITHOUT_TASK_NAME") or "").strip().lower() in (
        "1",
        "true",
        "yes",
    )

    now = datetime.now(timezone.utc)
    fs = _firestore_client()
    tasks_client = tasks_v2.CloudTasksClient()

    coll = fs.collection(jobs_collection)
    q = coll.where("status", "==", "running").where("lease_expires_at", "<", now)

    released: list[str] = []
    skipped_task_alive: list[str] = []
    skipped_not_hedron: list[str] = []

    for doc in q.stream():
        if len(released) >= max_jobs:
            break
        d = doc.to_dict() or {}
        upload_id = str(d.get("upload_id") or "")
        deck_uuid = _hedron_deck_image_uuid(upload_id)
        if not deck_uuid:
            if len(skipped_not_hedron) < 50:
                skipped_not_hedron.append(doc.id)
            continue

        task_name = d.get("cloud_task_name")
        if isinstance(task_name, str):
            task_name = task_name.strip() or None
        else:
            task_name = None

        if task_name:
            if not _cleanup_verify_task_gone(tasks_client, task_name):
                skipped_task_alive.append(upload_id)
                continue
        elif not legacy_no_task:
            log.info(
                "cleanup: skip legacy job without cloud_task_name upload_id=%s (set CLEANUP_LEGACY_WITHOUT_TASK_NAME=1 to purge)",
                upload_id,
            )
            continue

        if not _release_hedron_dedupe_via_worker(deck_uuid):
            log.warning("cleanup: D1 release failed for upload_id=%s; leaving Firestore doc", upload_id)
            continue

        try:
            doc.reference.delete()
            released.append(upload_id)
            log.info(
                "cleanup: removed stale hedron job upload_id=%s deck_uuid=%s",
                upload_id,
                deck_uuid,
            )
        except Exception as exc:
            log.exception(
                "cleanup: Firestore delete failed after D1 release upload_id=%s: %s",
                upload_id,
                exc,
            )

    return {
        "ok": True,
        "released_count": len(released),
        "released_upload_ids": released,
        "skipped_task_still_in_queue": skipped_task_alive,
        "skipped_non_hedron_doc_ids": skipped_not_hedron[:20],
    }

