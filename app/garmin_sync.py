"""Garmin Connect sync: auth helpers and activity download/import logic.

Garmin tokens and the Garmin email are stored per Kinetic account, encrypted (see
``app/token_crypto.py``), and all database access goes through the account-scoped session, so
accounts never share Garmin data.
"""

import io
import os
import threading
import time
import uuid
import zipfile
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import date
from pathlib import Path
from typing import Any

from loguru import logger
from sqlalchemy.exc import IntegrityError
from sqlmodel import col, select

from app.database import engine, require_id
from app.errors import UserError, public_message
from app.fit_parser import parse_fit_file
from app.formatting import format_date
from app.models import Activity
from app.ownership import UserSession as Session
from app.ownership import current_owner
from app.token_crypto import TokenKeyError, cipher, read_encrypted, write_encrypted

# Where imported FIT files are kept; the activity charts read them back from here
UPLOAD_DIR = Path(os.environ.get("KINETIC_UPLOAD_DIR", "uploads"))
TOKEN_ROOT = Path(os.environ.get("KINETIC_GARMIN_TOKEN_DIR", "garmin_tokens"))
_TOKEN_FILE = "garmin_tokens.enc"
_EMAIL_FILE = "garmin_email.enc"
# Unencrypted files written by earlier versions; encrypted and removed when first read
_LEGACY_TOKEN_FILE = "garmin_tokens.json"
_LEGACY_EMAIL_FILE = "garmin_email"

# Pause between downloads so a large sync does not trip Garmin's rate limit
DOWNLOAD_PAUSE_SECONDS = 1.0
# How long to back off once Garmin does rate limit us, before one retry
RATE_LIMIT_WAIT_SECONDS = 60.0

_running_syncs: set[str] = set()
_running_lock = threading.Lock()


class GarminError(UserError):
    """A Garmin sync or login problem, worded for the user."""


def _owner_id() -> str:
    owner_id = current_owner.get()
    if not owner_id:
        raise PermissionError("An authenticated account is required")
    return str(uuid.UUID(owner_id))  # rejects anything that is not a plain account id


def _token_dir() -> Path:
    path = TOKEN_ROOT / _owner_id()
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    return path


def _migrate_legacy(directory: Path) -> None:
    """Encrypt the plain-text token and email files of earlier versions, then delete them."""
    for legacy, current in ((_LEGACY_TOKEN_FILE, _TOKEN_FILE), (_LEGACY_EMAIL_FILE, _EMAIL_FILE)):
        old = directory / legacy
        if old.exists():
            if not (directory / current).exists():
                try:
                    write_encrypted(
                        directory / current, TOKEN_ROOT, old.read_text(encoding="utf-8")
                    )
                except TokenKeyError:
                    logger.warning("Plain-text Garmin {} kept: no encryption key is set", legacy)
                    continue
            old.unlink()
            logger.info("Encrypted the stored Garmin {}", "tokens" if current == _TOKEN_FILE
                        else "email")


def _account_dir() -> Path:
    directory = _token_dir()
    _migrate_legacy(directory)
    return directory


def tokens_exist() -> bool:
    """Return True if the current account has cached Garmin tokens."""
    directory = _token_dir()
    if (directory / _LEGACY_TOKEN_FILE).exists():
        _migrate_legacy(directory)
    return (directory / _TOKEN_FILE).exists() or (directory / _LEGACY_TOKEN_FILE).exists()


def load_tokens() -> str:
    """The current account's Garmin tokens as JSON (raises when there are none)."""
    cipher(TOKEN_ROOT)  # without a key, keep any plain-text tokens rather than drop them
    tokens = read_encrypted(_account_dir() / _TOKEN_FILE, TOKEN_ROOT)
    if not tokens:
        logger.warning("Stored Garmin tokens could not be decrypted; asking to sign in again")
        logout()
        raise GarminError("Garmin login expired, please sign in again")
    return tokens


def save_tokens(client) -> None:
    """Store the tokens of a signed-in Garmin client for the current account."""
    write_encrypted(_account_dir() / _TOKEN_FILE, TOKEN_ROOT, client.client.dumps())


def saved_email() -> str:
    directory = _token_dir()
    if (directory / _LEGACY_EMAIL_FILE).exists():
        _migrate_legacy(directory)
    try:
        return (read_encrypted(directory / _EMAIL_FILE, TOKEN_ROOT) or "").strip()
    except TokenKeyError:
        return ""


def save_email(email: str) -> None:
    write_encrypted(_account_dir() / _EMAIL_FILE, TOKEN_ROOT, email.strip())


def logout() -> None:
    """Remove the current account's cached Garmin tokens."""
    directory = _token_dir()
    for name in (_TOKEN_FILE, _LEGACY_TOKEN_FILE):
        (directory / name).unlink(missing_ok=True)


def forget_account(owner_id: str) -> None:
    """Delete every Garmin file of an account (its tokens and email)."""
    import shutil

    directory = TOKEN_ROOT / str(uuid.UUID(owner_id))
    shutil.rmtree(directory, ignore_errors=True)


def _existing_garmin_ids() -> set[int]:
    """Garmin activity ids already imported into the current account."""
    with Session(engine) as session:
        ids = session.exec(
            select(Activity.garmin_activity_id).where(
                col(Activity.garmin_activity_id).is_not(None)
            )
        ).all()
    return {int(garmin_id) for garmin_id in ids if garmin_id is not None}


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

    # One transaction for the activity, its multisport legs, laps and best efforts: a
    # failure part way leaves nothing behind, so the next sync simply tries again.
    try:
        with Session(engine) as session:
            activity.garmin_activity_id = garmin_activity_id
            session.add(activity)
            session.flush()

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
                session.flush()
                child_id = require_id(child.id)
                imported.append(child_id)
                for lap in child_laps:
                    lap.activity_id = child_id
                    session.add(lap)
                for be in child_bes:
                    be.activity_id = child_id
                    session.add(be)

            session.commit()
    except Exception:
        fit_path.unlink(missing_ok=True)
        raise

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

    client = Garmin(email=email, password=password, return_on_mfa=True)
    status, client_state = client.login()
    if status == "needs_mfa":
        return {"needs_mfa": True, "_client": client, "_state": client_state}
    save_tokens(client)
    return {"ok": True}


def complete_mfa(client_obj, client_state, mfa_code: str) -> None:
    """Finish a login that required MFA and persist the tokens."""
    client_obj.resume_login(client_state, mfa_code)
    save_tokens(client_obj)


def login_with_tokens() -> Any:
    """Return an authenticated Garmin client using cached tokens (raises on failure)."""
    from garminconnect import Garmin

    client = Garmin()
    client.login(load_tokens())  # inline JSON: the tokens never touch the disk unencrypted
    return client


def login_with_credentials(email: str, password: str) -> Any:
    """Return an authenticated Garmin client, refreshing tokens if needed."""
    from garminconnect import Garmin

    client = Garmin(email=email, password=password)
    client.login()
    save_tokens(client)
    return client


# ── Main sync ─────────────────────────────────────────────────────────────────


@contextmanager
def no_sync_running(owner_id: str) -> Iterator[None]:
    """Hold off syncs of an account while the block runs; raises if one is already running."""
    with _running_lock:
        if owner_id in _running_syncs:
            raise GarminError("A Garmin sync is running for this account; wait until it ends")
        _running_syncs.add(owner_id)
    try:
        yield
    finally:
        with _running_lock:
            _running_syncs.discard(owner_id)


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
            raise GarminError("A sync is already running for this account")
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

    def _expired(exc: Exception) -> GarminError:
        # Drop tokens Garmin no longer accepts, so the page asks the user to sign in again
        logger.warning("Garmin rejected the stored tokens: {}", exc)
        logout()
        return GarminError("Garmin login expired, please sign in again")

    # Authenticate
    using_tokens = tokens_exist()
    try:
        if using_tokens:
            _cb("Using cached Garmin tokens…")
            garmin = login_with_tokens()
        else:
            if not email or not password:
                raise GarminError("No cached tokens. Provide email and password to authenticate.")
            _cb("Logging in to Garmin Connect…")
            garmin = login_with_credentials(email, password)
    except GarminConnectAuthenticationError as exc:
        if using_tokens:
            raise _expired(exc) from exc
        logger.warning("Garmin authentication failed: {}", exc)
        raise GarminError("Garmin authentication failed; check your email and password") from exc
    except GarminConnectConnectionError as exc:
        logger.warning("Garmin connection error: {}", exc)
        raise GarminError("Could not reach Garmin Connect; try again later") from exc

    until_date = until or date.today()
    _cb(f"Fetching activity list {format_date(since)} → {format_date(until_date)}…")

    try:
        activities = garmin.get_activities_by_date(since.isoformat(), until_date.isoformat())
    except GarminConnectAuthenticationError as exc:
        raise _expired(exc) from exc
    except Exception as exc:
        logger.warning("Fetching the Garmin activity list failed: {}", exc)
        raise GarminError("Could not fetch the activity list from Garmin Connect") from exc

    total = len(activities)
    _cb(f"Found {total} activities on Garmin Connect.")

    def _download(garmin_id: int) -> bytes:
        """Download the original archive, backing off and retrying once if rate limited."""
        fmt = garmin.ActivityDownloadFormat.ORIGINAL
        try:
            return garmin.download_activity(garmin_id, dl_fmt=fmt)
        except GarminConnectTooManyRequestsError:
            _cb(f"Rate limited by Garmin – waiting {RATE_LIMIT_WAIT_SECONDS:.0f} s…")
            time.sleep(RATE_LIMIT_WAIT_SECONDS)
            return garmin.download_activity(garmin_id, dl_fmt=fmt)

    existing = _existing_garmin_ids()
    imported = 0
    skipped = 0
    errors: list[str] = []
    downloaded_any = False

    for i, act in enumerate(activities):
        garmin_id = int(act.get("activityId", 0))
        if not garmin_id:
            continue

        act_name = act.get("activityName") or str(garmin_id)
        _cb(f"({i + 1}/{total}) {act_name}")

        if garmin_id in existing:
            skipped += 1
            continue

        if downloaded_any:
            time.sleep(DOWNLOAD_PAUSE_SECONDS)
        downloaded_any = True

        try:
            zip_bytes = _download(garmin_id)
        except GarminConnectTooManyRequestsError:
            # Still rate limited after backing off: more requests would only make it worse
            left = total - i
            errors.append(
                f"Garmin is rate limiting requests; stopped with {left} "
                f"{'activity' if left == 1 else 'activities'} left. Sync again later."
            )
            break
        except GarminConnectAuthenticationError as exc:
            raise _expired(exc) from exc
        except Exception as exc:
            message = public_message(
                exc, "download failed", f"Failed to download garmin activity {garmin_id}"
            )
            errors.append(f"{act_name}: {message}")
            continue

        try:
            with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
                fit_names = [n for n in zf.namelist() if n.lower().endswith(".fit")]
                if not fit_names:
                    errors.append(f"{act_name}: archive contains no .fit file")
                    continue
                fit_bytes = zf.read(fit_names[0])

            import_fit_bytes(fit_bytes, garmin_activity_id=garmin_id, name=act_name)
            existing.add(garmin_id)
            imported += 1
        except IntegrityError as exc:
            if garmin_id in _existing_garmin_ids():
                # Imported meanwhile by another sync; the unique index kept it to one copy
                existing.add(garmin_id)
                skipped += 1
            else:
                logger.warning("Failed to import garmin activity {}: {}", garmin_id, exc)
                errors.append(f"{act_name}: could not be stored")
        except Exception as exc:
            message = public_message(
                exc, "could not be imported", f"Failed to import garmin activity {garmin_id}"
            )
            errors.append(f"{act_name}: {message}")

    # Garmin may have refreshed the tokens during the sync; keep the latest ones
    try:
        save_tokens(garmin)
    except Exception as exc:
        logger.warning("Could not store the refreshed Garmin tokens: {}", exc)

    _cb(f"Done. Imported {imported}, skipped {skipped}, errors {len(errors)}.")
    return {"imported": imported, "skipped": skipped, "errors": errors}
