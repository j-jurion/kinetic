"""Connecting a Garmin account and syncing activities from Garmin Connect."""

import json
import queue
import threading
import time
from contextvars import copy_context
from datetime import date, timedelta
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import col, select

from app import garmin_sync
from app.database import engine
from app.errors import public_message
from app.models import (
    Activity,
)
from app.ownership import UserSession as Session
from app.routes.common import (
    current_owner_id,
)

router = APIRouter()


# ── Garmin sync ───────────────────────────────────────────────────────────────


class GarminLogin(BaseModel):
    email: str
    password: str


class GarminMfa(BaseModel):
    code: str


class GarminSyncRequest(BaseModel):
    since: date
    until: Optional[date] = None
    email: str = ""
    password: str = ""


_MFA_SECONDS = 10 * 60
# Logins waiting for an MFA code, per account: (client, state, email, started)
_pending_mfa: dict[str, tuple[Any, Any, str, float]] = {}
_pending_lock = threading.Lock()


@router.get("/garmin/status")
def garmin_status() -> dict:
    with Session(engine) as session:
        latest = session.exec(select(Activity.date).order_by(col(Activity.date).desc())).first()
    default_since = (
        (latest.date() - timedelta(days=1)) if latest else (date.today() - timedelta(days=90))
    )
    return {
        "authenticated": garmin_sync.tokens_exist(),
        "email": garmin_sync.saved_email(),
        "default_since": default_since.isoformat(),
    }


def forget_pending_mfa(owner_id: str) -> None:
    with _pending_lock:
        _pending_mfa.pop(owner_id, None)


@router.post("/garmin/login")
def garmin_login(data: GarminLogin) -> dict:
    email = data.email.strip()
    if not email or not data.password:
        raise HTTPException(status_code=400, detail="Email and password are required")
    try:
        result = garmin_sync.attempt_login(email, data.password)
    except Exception as exc:
        message = public_message(exc, "Could not sign in to Garmin Connect", "Garmin login failed")
        raise HTTPException(status_code=400, detail=message) from None
    if result.get("needs_mfa"):
        with _pending_lock:
            pending = (result["_client"], result["_state"], email, time.time())
            _pending_mfa[current_owner_id()] = pending
        return {"needs_mfa": True}
    garmin_sync.save_email(email)
    return {"needs_mfa": False}


@router.post("/garmin/mfa")
def garmin_mfa(data: GarminMfa) -> dict:
    with _pending_lock:
        pending = _pending_mfa.pop(current_owner_id(), None)
    if not pending or time.time() - pending[3] > _MFA_SECONDS:
        raise HTTPException(status_code=400, detail="No login is waiting for a code; sign in again")
    client, state, email, _ = pending
    try:
        garmin_sync.complete_mfa(client, state, data.code.strip())
    except Exception as exc:
        message = public_message(exc, "the code was not accepted", "Garmin MFA failed")
        raise HTTPException(status_code=400, detail=f"MFA failed: {message}") from None
    garmin_sync.save_email(email)
    return {"ok": True}


@router.post("/garmin/logout", status_code=204)
def garmin_logout() -> None:
    garmin_sync.logout()


@router.post("/garmin/sync")
def garmin_sync_activities(data: GarminSyncRequest) -> StreamingResponse:
    """Run a sync and stream its progress as newline-delimited JSON messages."""
    if garmin_sync.tokens_exist():
        email, password = garmin_sync.saved_email(), ""
    else:
        email, password = data.email.strip(), data.password
        if not email or not password:
            raise HTTPException(
                status_code=400,
                detail="No cached tokens — authenticate first or enter credentials",
            )

    messages: "queue.Queue[Optional[dict]]" = queue.Queue()

    def work() -> None:
        try:
            result = garmin_sync.sync_garmin_activities(
                data.since,
                data.until,
                email,
                password,
                lambda msg: messages.put({"type": "progress", "message": msg}),
            )
            messages.put({"type": "result", **result})
        except Exception as exc:
            message = public_message(exc, "The Garmin sync failed", "Garmin sync failed")
            messages.put({"type": "error", "message": message})
        finally:
            messages.put(None)

    context = copy_context()
    threading.Thread(target=context.run, args=(work,), daemon=True).start()

    def stream():
        while (message := messages.get()) is not None:
            yield json.dumps(message) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")
