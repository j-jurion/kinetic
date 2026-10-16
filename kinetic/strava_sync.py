"""Strava OAuth and activity imports. Credentials remain on the server."""

import json
import os
import re
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from datetime import time as day_time
from threading import Lock
from typing import Any
from urllib.parse import urlencode

import httpx
import polyline
from sqlmodel import Session, col, select

from kinetic.database import engine, require_id
from kinetic.models import Activity, Lap, SportType

API_URL = "https://www.strava.com/api/v3"
TOKEN_URL = "https://www.strava.com/oauth/token"


@dataclass
class StravaSession:
    tokens: dict[str, Any] = field(default_factory=dict, repr=False)
    state: str = field(default="", repr=False)
    state_created: float = 0
    lock: Any = field(default_factory=Lock, repr=False)

    @property
    def connected(self) -> bool:
        return bool(self.tokens.get("refresh_token"))


_sessions: dict[str, StravaSession] = {}


def session_for(identifier: str) -> StravaSession:
    return _sessions.setdefault(identifier, StravaSession())


def configured() -> bool:
    return bool(
        os.environ.get("STRAVA_CLIENT_ID", "").isdigit() and os.environ.get("STRAVA_CLIENT_SECRET")
    )


def _credentials() -> dict[str, str]:
    if not configured():
        raise ValueError("Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET on the server first.")
    return {
        "client_id": os.environ["STRAVA_CLIENT_ID"],
        "client_secret": os.environ["STRAVA_CLIENT_SECRET"],
    }


def authorization_url(session: StravaSession, redirect_uri: str) -> str:
    credentials = _credentials()
    session.state = secrets.token_urlsafe(32)
    session.state_created = time.time()
    return "https://www.strava.com/oauth/authorize?" + urlencode(
        {
            "client_id": credentials["client_id"],
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "approval_prompt": "force",
            "scope": "activity:read_all",
            "state": session.state,
        }
    )


def _request(client: httpx.Client, method: str, url: str, **kwargs) -> Any:
    try:
        response = client.request(method, url, **kwargs)
    except httpx.RequestError:
        raise RuntimeError("Could not reach Strava. Please try again.") from None
    if response.status_code in (401, 403):
        raise RuntimeError("Strava authorization failed. Connect to Strava again.")
    if response.status_code == 429:
        raise RuntimeError("Strava rate limit reached. Please sync again later.")
    if response.is_error:
        raise RuntimeError(f"Strava request failed (HTTP {response.status_code}).")
    return response.json()


def complete_login(
    session: StravaSession, state: str, code: str, scope: str, error: str = ""
) -> None:
    if (
        not state
        or not session.state
        or not secrets.compare_digest(state, session.state)
        or time.time() - session.state_created > 600
    ):
        raise ValueError("Strava sign-in expired or is invalid. Please connect again.")
    session.state = ""
    if error or not code:
        raise ValueError("Strava sign-in was cancelled. Please connect again.")
    if "activity:read_all" not in scope.replace(",", " ").split():
        raise ValueError(
            "Strava activity access was not granted. Connect and allow activity access."
        )
    with session.lock, httpx.Client(timeout=30) as client:
        tokens = _request(
            client,
            "POST",
            TOKEN_URL,
            data={
                **_credentials(),
                "grant_type": "authorization_code",
                "code": code,
            },
        )
        if not tokens.get("access_token") or not tokens.get("refresh_token"):
            raise RuntimeError("Strava did not return usable credentials. Please connect again.")
        session.tokens = tokens


def logout(session: StravaSession) -> None:
    if not session.lock.acquire(blocking=False):
        raise RuntimeError("Wait for the Strava sync to finish before logging out.")
    try:
        session.tokens.clear()
        session.state = ""
    finally:
        session.lock.release()


def _access_token(session: StravaSession, client: httpx.Client) -> str:
    if not session.connected:
        raise RuntimeError("Connect to Strava first.")
    if session.tokens.get("expires_at", 0) <= time.time() + 60:
        refreshed = _request(
            client,
            "POST",
            TOKEN_URL,
            data={
                **_credentials(),
                "grant_type": "refresh_token",
                "refresh_token": session.tokens["refresh_token"],
            },
        )
        session.tokens.update(refreshed)
    return session.tokens["access_token"]


def latest_activity_date() -> date | None:
    with Session(engine) as db:
        latest = db.exec(
            select(Activity.date)
            .where(col(Activity.strava_activity_id).is_not(None))
            .order_by(col(Activity.date).desc())
        ).first()
        return latest.date() if latest else None


def _sport(payload: dict) -> SportType:
    sports = {
        "Run": SportType.running,
        "VirtualRun": SportType.running,
        "TrailRun": SportType.trail_running,
        "Ride": SportType.cycling,
        "VirtualRide": SportType.cycling,
        "MountainBikeRide": SportType.cycling,
        "GravelRide": SportType.cycling,
        "EBikeRide": SportType.cycling,
        "EMountainBikeRide": SportType.cycling,
        "Swim": SportType.swimming,
        "Hike": SportType.hiking,
        "Walk": SportType.walking,
        "WeightTraining": SportType.strength,
        "Yoga": SportType.yoga,
    }
    return sports.get(payload.get("sport_type") or payload.get("type"), SportType.other)


def _optional_int(payload: dict, key: str) -> int | None:
    value = payload.get(key)
    return round(value) if value is not None else None


def _existing_activity(db: Session, summary: dict) -> bool:
    if db.exec(select(Activity).where(Activity.strava_activity_id == summary["id"])).first():
        return True
    match = re.fullmatch(r"garmin_push_(\d+)", summary.get("external_id") or "")
    if match:
        existing = db.exec(
            select(Activity).where(Activity.garmin_activity_id == int(match.group(1)))
        ).first()
        if existing and existing.strava_activity_id is None:
            existing.strava_activity_id = summary["id"]
            db.add(existing)
            db.commit()
            return True
    return False


def _import_activity(db: Session, payload: dict) -> None:
    encoded_route = (payload.get("map") or {}).get("polyline") or (payload.get("map") or {}).get(
        "summary_polyline"
    )
    activity = Activity(
        name=payload.get("name") or f"Strava activity {payload['id']}",
        strava_activity_id=payload["id"],
        sport=_sport(payload),
        date=datetime.fromisoformat(payload["start_date"]),
        duration_seconds=payload.get("moving_time") or payload["elapsed_time"],
        distance_meters=payload.get("distance"),
        elevation_gain_meters=payload.get("total_elevation_gain"),
        avg_speed_ms=payload.get("average_speed"),
        max_speed_ms=payload.get("max_speed"),
        avg_heart_rate=_optional_int(payload, "average_heartrate"),
        max_heart_rate=_optional_int(payload, "max_heartrate"),
        avg_cadence=_optional_int(payload, "average_cadence"),
        avg_power=_optional_int(payload, "average_watts"),
        calories=_optional_int(payload, "calories"),
        notes=payload.get("description"),
        route_json=json.dumps(polyline.decode(encoded_route)) if encoded_route else None,
    )
    db.add(activity)
    db.flush()
    for index, lap in enumerate(payload.get("laps") or [], start=1):
        db.add(
            Lap(
                activity_id=require_id(activity.id),
                lap_number=index,
                start_time=datetime.fromisoformat(lap["start_date"])
                if lap.get("start_date")
                else None,
                duration_seconds=lap.get("moving_time") or lap.get("elapsed_time"),
                distance_meters=lap.get("distance"),
                avg_speed_ms=lap.get("average_speed"),
                avg_heart_rate=_optional_int(lap, "average_heartrate"),
                elevation_gain=lap.get("total_elevation_gain"),
            )
        )
    db.commit()


def sync_activities(
    session: StravaSession,
    since: date,
    until: date | None = None,
    progress_cb: Callable[[str], None] | None = None,
) -> dict:
    until = until or date.today()
    if since > until:
        raise ValueError("The end date must be on or after the start date.")
    if not session.lock.acquire(blocking=False):
        raise RuntimeError("Strava sync is already in progress.")
    result = {"imported": 0, "skipped": 0, "errors": []}
    try:
        with httpx.Client(base_url=API_URL + "/", timeout=30) as client, Session(engine) as db:
            client.headers["Authorization"] = f"Bearer {_access_token(session, client)}"
            page = 1
            while True:
                summaries = _request(
                    client,
                    "GET",
                    "athlete/activities",
                    params={
                        "after": int(
                            datetime.combine(since, day_time.min, timezone.utc).timestamp()
                        )
                        - 1,
                        "before": int(
                            datetime.combine(
                                until + timedelta(days=1), day_time.min, timezone.utc
                            ).timestamp()
                        ),
                        "page": page,
                        "per_page": 100,
                    },
                )
                if not summaries:
                    break
                if progress_cb:
                    progress_cb(f"Importing Strava page {page}...")
                for summary in summaries:
                    try:
                        if _existing_activity(db, summary):
                            result["skipped"] += 1
                            continue
                        detail = _request(client, "GET", f"activities/{summary['id']}")
                        _import_activity(db, detail)
                        result["imported"] += 1
                    except RuntimeError:
                        db.rollback()
                        raise
                    except Exception:
                        db.rollback()
                        result["errors"].append(f"Could not import activity {summary['id']}.")
                page += 1
            return result
    finally:
        session.lock.release()
