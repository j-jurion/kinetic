"""Garmin Connect sync: auth helpers and activity download/import logic.

Garmin tokens and the Garmin email are stored per Kinetic account, and all database access
goes through the account-scoped session, so accounts never share Garmin data.
"""

import io
import os
import threading
import time
import uuid
import zipfile
from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any

from loguru import logger
from sqlmodel import select

from app.database import engine, require_id
from app.fit_parser import parse_fit_file
from app.formatting import format_date
from app.models import Activity
from app.ownership import UserSession as Session
from app.ownership import current_owner

# Where imported FIT files are kept; the activity charts read them back from here
UPLOAD_DIR = Path(os.environ.get("KINETIC_UPLOAD_DIR", "uploads"))
TOKEN_ROOT = Path(os.environ.get("KINETIC_GARMIN_TOKEN_DIR", "garmin_tokens"))
_TOKEN_FILE = "garmin_tokens.json"
_EMAIL_FILE = "garmin_email"

_running_syncs: set[str] = set()
_running_lock = threading.Lock()


def _owner_id() -> str:
    owner_id = current_owner.get()
    if not owner_id:
        raise PermissionError("An authenticated account is required")
    return str(uuid.UUID(owner_id))  # rejects anything that is not a plain account id


def _token_dir() -> Path:
    path = TOKEN_ROOT / _owner_id()
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    return path


def tokens_exist() -> bool:
    """Return True if the current account has cached Garmin tokens."""
    return (_token_dir() / _TOKEN_FILE).exists()


def saved_email() -> str:
    path = _token_dir() / _EMAIL_FILE
    return path.read_text(encoding="utf-8").strip() if path.exists() else ""


def save_email(email: str) -> None:
    (_token_dir() / _EMAIL_FILE).write_text(email.strip(), encoding="utf-8")


def logout() -> None:
    """Remove the current account's cached Garmin tokens."""
    (_token_dir() / _TOKEN_FILE).unlink(missing_ok=True)


def _garmin_id_exists(garmin_activity_id: int) -> bool:
    with Session(engine) as session:
        return (
            session.exec(
                select(Activity.id).where(Activity.garmin_activity_id == garmin_activity_id)
            ).first()
            is not None
        )


def _save_fit_and_import(
    garmin_activity_id: int, fit_bytes: bytes, garmin_name: str | None = None
) -> None:
    """Import an activity downloaded from Garmin Connect."""
    import_fit_bytes(fit_bytes, garmin_activity_id=garmin_activity_id, name=garmin_name)


def import_fit_bytes(
    fit_bytes: bytes, garmin_activity_id: int | None = None, name: str | None = None
) -> int:
    """Write FIT bytes to uploads/, import them with any multisport legs and return the id."""
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    fit_path = UPLOAD_DIR / f"{uuid.uuid4().hex}.fit"
    fit_path.write_bytes(fit_bytes)

    try:
        activity, laps, best_efforts, children = parse_fit_file(fit_path)
    except Exception:
        fit_path.unlink(missing_ok=True)
        raise

    if name:
        activity.name = name

    with Session(engine) as session:
        activity.garmin_activity_id = garmin_activity_id
        session.add(activity)
        session.commit()
        session.refresh(activity)

        parent_id = require_id(activity.id)
        for lap in laps:
            lap.activity_id = parent_id
            session.add(lap)
        for be in best_efforts:
            be.activity_id = parent_id
            session.add(be)

        imported = [parent_id]
        for child, child_laps, child_bes, *_ in children:
            child.parent_id = parent_id
            session.add(child)
            session.commit()
            session.refresh(child)
            child_id = require_id(child.id)
            imported.append(child_id)
            for lap in child_laps:
                lap.activity_id = child_id
                session.add(lap)
            for be in child_bes:
                be.activity_id = child_id
                session.add(be)

        session.commit()

    # Training metrics for the charts; imported here to avoid a circular import
    from app import metrics

    metrics.store_quietly(imported)
    return parent_id


# ── Auth helpers ──────────────────────────────────────────────────────────────


def attempt_login(email: str, password: str) -> dict[str, Any]:
    """
    Try to log in to Garmin Connect.

    Returns:
        {"ok": True}                                      – success
        {"needs_mfa": True, "_client": ..., "_state": ...} – MFA required
    """
    from garminconnect import Garmin

    token_store = str(_token_dir())
    client = Garmin(email=email, password=password, return_on_mfa=True)
    status, client_state = client.login(token_store)
    if status == "needs_mfa":
        return {"needs_mfa": True, "_client": client, "_state": client_state}
    client.client.dump(token_store)
    return {"ok": True}


def complete_mfa(client_obj, client_state, mfa_code: str) -> None:
    """Finish a login that required MFA and persist the tokens."""
    client_obj.resume_login(client_state, mfa_code)
    client_obj.client.dump(str(_token_dir()))


def login_with_tokens() -> Any:
    """Return an authenticated Garmin client using cached tokens (raises on failure)."""
    from garminconnect import Garmin

    client = Garmin()
    client.login(str(_token_dir()))
    return client


def login_with_credentials(email: str, password: str) -> Any:
    """Return an authenticated Garmin client, refreshing tokens if needed."""
    from garminconnect import Garmin

    client = Garmin(email=email, password=password)
    client.login(str(_token_dir()))
    return client


# ── Main sync ─────────────────────────────────────────────────────────────────


def sync_garmin_activities(
    since: date,
    until: date | None = None,
    email: str = "",
    password: str = "",
    progress_cb: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """
    Download and import Garmin activities in the given date range.

    Returns {"imported": int, "skipped": int, "errors": list[str]}.
    """
    owner_id = _owner_id()
    with _running_lock:
        if owner_id in _running_syncs:
            raise RuntimeError("A sync is already running for this account")
        _running_syncs.add(owner_id)
    try:
        return _sync(since, until, email, password, progress_cb)
    finally:
        with _running_lock:
            _running_syncs.discard(owner_id)


def _sync(
    since: date,
    until: date | None,
    email: str,
    password: str,
    progress_cb: Callable[[str], None] | None,
) -> dict[str, Any]:
    from garminconnect import (
        GarminConnectAuthenticationError,
        GarminConnectConnectionError,
        GarminConnectTooManyRequestsError,
    )

    def _cb(msg: str) -> None:
        logger.debug("garmin_sync: {}", msg)
        if progress_cb:
            progress_cb(msg)

    # Authenticate
    try:
        if tokens_exist():
            _cb("Using cached Garmin tokens…")
            garmin = login_with_tokens()
        else:
            if not email or not password:
                raise RuntimeError("No cached tokens. Provide email and password to authenticate.")
            _cb("Logging in to Garmin Connect…")
            garmin = login_with_credentials(email, password)
    except GarminConnectAuthenticationError as exc:
        raise RuntimeError(f"Garmin authentication failed: {exc}") from exc
    except GarminConnectConnectionError as exc:
        raise RuntimeError(f"Garmin connection error: {exc}") from exc

    until_date = until or date.today()
    _cb(f"Fetching activity list {format_date(since)} → {format_date(until_date)}…")

    try:
        activities = garmin.get_activities_by_date(since.isoformat(), until_date.isoformat())
    except Exception as exc:
        raise RuntimeError(f"Failed to fetch activity list: {exc}") from exc

    total = len(activities)
    _cb(f"Found {total} activities on Garmin Connect.")

    imported = 0
    skipped = 0
    errors: list[str] = []

    for i, act in enumerate(activities):
        garmin_id = int(act.get("activityId", 0))
        if not garmin_id:
            continue

        act_name = act.get("activityName") or str(garmin_id)
        _cb(f"({i + 1}/{total}) {act_name}")

        if _garmin_id_exists(garmin_id):
            skipped += 1
            continue

        try:
            zip_bytes = garmin.download_activity(
                garmin_id,
                dl_fmt=garmin.ActivityDownloadFormat.ORIGINAL,
            )
            with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
                fit_names = [n for n in zf.namelist() if n.lower().endswith(".fit")]
                if not fit_names:
                    errors.append(f"{act_name}: archive contains no .fit file")
                    continue
                fit_bytes = zf.read(fit_names[0])

            _save_fit_and_import(garmin_id, fit_bytes, act_name)
            imported += 1

        except GarminConnectTooManyRequestsError:
            _cb("Rate limited – waiting 60 s…")
            time.sleep(60)
            errors.append(f"{act_name}: rate limited, skipped")
        except Exception as exc:
            logger.warning("Failed to sync garmin activity {}: {}", garmin_id, exc)
            errors.append(f"{act_name}: {exc}")

    _cb(f"Done. Imported {imported}, skipped {skipped}, errors {len(errors)}.")
    return {"imported": imported, "skipped": skipped, "errors": errors}
