"""JSON API used by the React web app.

Every query goes through the account-scoped ``UserSession``, so a request only ever sees the
records of the account that made it. Values are returned raw (metres, seconds, ISO dates);
the web app formats them.
"""

import json
import queue
import threading
import time
from contextvars import copy_context
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel
from sqlalchemy import func
from sqlmodel import col, select

from app import apple_health, auth, garmin_sync, metrics, strava, streams
from app.database import engine, require_id
from app.formatting import SPORTS, resolve_sports
from app.friends import friend_rows
from app.models import (
    Activity,
    ActivityFriend,
    ActivityKind,
    ActivityMetrics,
    BestEffort,
    Friend,
    Lap,
    RaceResult,
    RaceResultSplit,
    SportType,
)
from app.ownership import UserSession as Session
from app.ownership import current_owner
from app.queries import multisport_parent_sports, multisport_parents

router = APIRouter()

MAX_FIT_BYTES = 50 * 1024 * 1024


# ── Helpers ───────────────────────────────────────────────────────────────────


def _sport_types(sport: Optional[str]) -> Optional[list[SportType]]:
    """Resolve a sport filter (sport, group or umbrella) into concrete sport types."""
    try:
        sports = resolve_sports(sport)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Unknown sport: {sport}") from None
    return [SportType(s) for s in sports] if sports else None


def _in_year(stmt, column, year: Optional[int]):
    if year:
        stmt = stmt.where(col(column) >= datetime(year, 1, 1))
        stmt = stmt.where(col(column) < datetime(year + 1, 1, 1))
    return stmt


def _dump(model) -> dict:
    return model.model_dump(mode="json")


def _activity_dump(activity: Activity) -> dict:
    """An activity without its (large) GPS route."""
    data = _dump(activity)
    data.pop("route_json", None)
    data["has_route"] = bool(activity.route_json)
    return data


def _get_activity(session, activity_id: int) -> Activity:
    activity = session.get(Activity, activity_id)
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    return activity


# ── Request bodies ────────────────────────────────────────────────────────────


class ActivityCreate(BaseModel):
    name: str
    sport: SportType = SportType.running
    kind: ActivityKind = ActivityKind.training
    date: datetime
    duration_seconds: float
    distance_meters: Optional[float] = None
    elevation_gain_meters: Optional[float] = None
    avg_heart_rate: Optional[int] = None
    max_heart_rate: Optional[int] = None
    avg_speed_ms: Optional[float] = None
    max_speed_ms: Optional[float] = None
    avg_cadence: Optional[int] = None
    avg_power: Optional[int] = None
    calories: Optional[int] = None
    notes: Optional[str] = None
    friend_ids: Optional[list[int]] = None


class ActivityUpdate(BaseModel):
    name: Optional[str] = None
    sport: Optional[SportType] = None
    kind: Optional[ActivityKind] = None
    date: Optional[datetime] = None
    duration_seconds: Optional[float] = None
    distance_meters: Optional[float] = None
    elevation_gain_meters: Optional[float] = None
    avg_heart_rate: Optional[int] = None
    max_heart_rate: Optional[int] = None
    avg_speed_ms: Optional[float] = None
    max_speed_ms: Optional[float] = None
    avg_cadence: Optional[int] = None
    avg_power: Optional[int] = None
    calories: Optional[int] = None
    notes: Optional[str] = None
    friend_ids: Optional[list[int]] = None


class RaceSplitIn(BaseModel):
    label: str
    duration_seconds: Optional[float] = None
    rank: Optional[int] = None


class RaceResultIn(BaseModel):
    official_time_seconds: Optional[float] = None
    bib_number: Optional[str] = None
    age_group: Optional[str] = None
    overall_rank: Optional[int] = None
    overall_total: Optional[int] = None
    gender_rank: Optional[int] = None
    gender_total: Optional[int] = None
    age_group_rank: Optional[int] = None
    age_group_total: Optional[int] = None
    results_url: Optional[str] = None
    notes: Optional[str] = None
    splits: list[RaceSplitIn] = []


# ── Activities ────────────────────────────────────────────────────────────────


@router.get("/activities")
def list_activities(
    sport: Optional[str] = None, year: Optional[int] = None, friend: Optional[int] = None
) -> list[dict]:
    """Activities, newest first.

    Without a sport filter only top-level activities are listed (a multisport event stands
    for its legs); with a filter, legs of that sport are listed on their own. ``friend``
    keeps the activities that friend is tagged on.
    """
    with Session(engine) as session:
        stmt = select(Activity)
        if friend is not None:
            stmt = stmt.where(
                col(Activity.id).in_(
                    select(ActivityFriend.activity_id).where(ActivityFriend.friend_id == friend)
                )
            )
        sport_types = _sport_types(sport)
        if sport_types:
            stmt = stmt.where(col(Activity.sport).in_(sport_types))
        else:
            stmt = stmt.where(col(Activity.parent_id).is_(None))
        stmt = _in_year(stmt, Activity.date, year).order_by(col(Activity.date).desc())
        activities = session.exec(stmt).all()

        ids = [a.id for a in activities]
        with_result: set[int] = set()
        if ids:
            with_result = set(
                session.exec(
                    select(RaceResult.activity_id).where(col(RaceResult.activity_id).in_(ids))
                ).all()
            )
        parents = multisport_parent_sports(session, (a.parent_id for a in activities))
        rows = []
        for activity in activities:
            data = _activity_dump(activity)
            data["has_race_result"] = activity.id in with_result
            data["parent_sport"] = parents.get(activity.parent_id) if activity.parent_id else None
            rows.append(data)
        return rows


def _set_activity_friends(session, activity_id: int, friend_ids: list[int]) -> None:
    """Replace the friends of an activity and of its multisport legs."""
    owned = {f.id for f in session.exec(select(Friend)).all()}
    unknown = set(friend_ids) - owned
    if unknown:
        raise HTTPException(status_code=400, detail="Unknown friend")
    child_ids = session.exec(select(Activity.id).where(Activity.parent_id == activity_id)).all()
    for target_id in [activity_id, *child_ids]:
        for link in session.exec(
            select(ActivityFriend).where(ActivityFriend.activity_id == target_id)
        ).all():
            session.delete(link)
        session.flush()
        for friend_id in dict.fromkeys(friend_ids):
            session.add(ActivityFriend(activity_id=target_id, friend_id=friend_id))


@router.post("/activities", status_code=201)
def create_activity(data: ActivityCreate) -> dict:
    with Session(engine) as session:
        activity = Activity(**data.model_dump(exclude={"friend_ids"}))
        session.add(activity)
        session.commit()
        session.refresh(activity)
        if data.friend_ids is not None:
            _set_activity_friends(session, require_id(activity.id), data.friend_ids)
            session.commit()
            session.refresh(activity)
        return _activity_dump(activity)


@router.get("/activities/{activity_id}")
def get_activity(activity_id: int) -> dict:
    with Session(engine) as session:
        return _activity_dump(_get_activity(session, activity_id))


@router.patch("/activities/{activity_id}")
def update_activity(activity_id: int, data: ActivityUpdate) -> dict:
    with Session(engine) as session:
        activity = _get_activity(session, activity_id)
        for key, value in data.model_dump(exclude_unset=True, exclude={"friend_ids"}).items():
            setattr(activity, key, value)
        activity.updated_at = datetime.now(timezone.utc)
        session.add(activity)
        if data.friend_ids is not None:
            _set_activity_friends(session, activity_id, data.friend_ids)
        session.commit()
        session.refresh(activity)
        return _activity_dump(activity)


def _delete_activity_rows(session, activity: Activity) -> None:
    activity_id = activity.id
    for model in (Lap, BestEffort, ActivityFriend, ActivityMetrics):
        for row in session.exec(select(model).where(model.activity_id == activity_id)).all():
            session.delete(row)
    result = session.exec(select(RaceResult).where(RaceResult.activity_id == activity_id)).first()
    if result:
        for split in session.exec(
            select(RaceResultSplit).where(RaceResultSplit.race_result_id == result.id)
        ).all():
            session.delete(split)
        session.delete(result)
    session.delete(activity)


@router.delete("/activities/{activity_id}", status_code=204)
def delete_activity(activity_id: int) -> None:
    with Session(engine) as session:
        activity = _get_activity(session, activity_id)
        for child in session.exec(select(Activity).where(Activity.parent_id == activity_id)).all():
            _delete_activity_rows(session, child)
        session.flush()
        _delete_activity_rows(session, activity)
        session.commit()


@router.post("/activities/upload-fit", status_code=201)
async def upload_fit(file: UploadFile) -> dict:
    if not file.filename or not file.filename.lower().endswith(".fit"):
        raise HTTPException(status_code=400, detail="Only .fit files are accepted")
    content = await file.read(MAX_FIT_BYTES + 1)
    if len(content) > MAX_FIT_BYTES:
        raise HTTPException(status_code=413, detail="File is too large")
    try:
        activity_id = await _run_in_thread(garmin_sync.import_fit_bytes, content)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not import file: {exc}") from None
    return get_activity(activity_id)


@router.post("/activities/import-file")
async def import_activity_file(
    file: UploadFile,
    name: Optional[str] = Form(None),
    activity_type: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
) -> dict:
    """One activity file from a Strava export (or any .fit/.gpx/.tcx, optionally gzipped).

    The name, type and description come from the export's activities.csv. Returns
    ``{"status": "imported", "activity": {...}}`` or ``{"status": "skipped"}`` when an
    activity of the same sport already starts within a minute of it.
    """
    filename = file.filename or ""
    content = await file.read(strava.MAX_FILE_BYTES + 1)
    if len(content) > strava.MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File is too large")
    try:
        result = await _run_in_thread(
            strava.import_file, filename, content, name, activity_type, description
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not import file: {exc}") from None
    if result["status"] == "skipped":
        return {"status": "skipped"}
    return {"status": "imported", "activity": get_activity(result["id"])}


async def _run_in_thread(fn, *args):
    """Run blocking work in a thread while keeping the account context."""
    from starlette.concurrency import run_in_threadpool

    context = copy_context()
    return await run_in_threadpool(context.run, fn, *args)


@router.get("/activities/{activity_id}/laps")
def get_laps(activity_id: int) -> list[dict]:
    with Session(engine) as session:
        laps = session.exec(
            select(Lap).where(Lap.activity_id == activity_id).order_by(col(Lap.lap_number))
        ).all()
        return [_dump(lap) for lap in laps]


@router.get("/activities/{activity_id}/route")
def get_route(activity_id: int) -> dict:
    with Session(engine) as session:
        activity = _get_activity(session, activity_id)
        coords = json.loads(activity.route_json) if activity.route_json else []
    return {"coords": coords}


@router.get("/activities/{activity_id}/streams")
async def get_streams(activity_id: int) -> dict:
    """Per-second data of the activity from its FIT file, with zones, climbs and a summary.

    ``available`` is false when the FIT file is no longer on disk (for example activities
    added by hand); the page then shows only the charts built from laps.
    """
    with Session(engine) as session:
        activity = _get_activity(session, activity_id)
        # Fallback for files without watch settings: the highest heart rate on the account
        account_max_hr = session.exec(select(func.max(Activity.max_heart_rate))).one()
    path = streams.fit_path_for(activity.fit_file_path)
    if path is None:
        return {"available": False}
    leg = activity.parent_id is not None
    try:
        data = await _run_in_thread(
            streams.read_streams,
            path,
            activity.sport.value,
            activity.date if leg else None,
            activity.duration_seconds if leg else None,
            account_max_hr,
        )
    except Exception:
        logger.exception("Could not read the FIT file of activity {}", activity_id)
        return {"available": False}
    return {"available": bool(data["points"]["t"]), **data}


def _race_result(session, activity_id: int) -> Optional[dict]:
    result = session.exec(select(RaceResult).where(RaceResult.activity_id == activity_id)).first()
    if not result:
        return None
    splits = session.exec(
        select(RaceResultSplit)
        .where(RaceResultSplit.race_result_id == result.id)
        .order_by(col(RaceResultSplit.order))
    ).all()
    return {**_dump(result), "splits": [_dump(s) for s in splits]}


def _activity_friends(session, activity_id: int) -> list[dict]:
    friends = session.exec(
        select(Friend)
        .join(ActivityFriend, col(ActivityFriend.friend_id) == col(Friend.id))
        .where(ActivityFriend.activity_id == activity_id)
    ).all()
    return friend_rows(list(friends))


@router.get("/activities/{activity_id}/detail")
def get_activity_detail(activity_id: int) -> dict:
    with Session(engine) as session:
        activity = _get_activity(session, activity_id)
        laps = session.exec(
            select(Lap).where(Lap.activity_id == activity_id).order_by(col(Lap.lap_number))
        ).all()
        efforts = session.exec(
            select(BestEffort)
            .where(BestEffort.activity_id == activity_id)
            .order_by(col(BestEffort.distance_meters))
        ).all()
        ranked = []
        for effort in efforts:
            faster = session.exec(
                select(func.count(BestEffort.id)).where(
                    BestEffort.sport == effort.sport,
                    BestEffort.distance_meters == effort.distance_meters,
                    BestEffort.duration_seconds < effort.duration_seconds,
                )
            ).one()
            ranked.append({**_dump(effort), "rank": faster + 1})

        children: list[dict] = []
        parent: Optional[dict] = None
        if activity.parent_id is None:
            children = [
                _activity_dump(c)
                for c in session.exec(
                    select(Activity)
                    .where(Activity.parent_id == activity_id)
                    .order_by(col(Activity.date))
                ).all()
            ]
        else:
            parent_activity = session.get(Activity, activity.parent_id)
            if parent_activity:
                parent = _activity_dump(parent_activity)

        return {
            "activity": _activity_dump(activity),
            "laps": [_dump(lap) for lap in laps],
            "best_efforts": ranked,
            "children": children,
            "parent": parent,
            "race_result": _race_result(session, activity_id),
            "friends": _activity_friends(session, activity_id),
        }


# ── Activity friends ──────────────────────────────────────────────────────────


@router.get("/activities/{activity_id}/friends")
def list_activity_friends(activity_id: int) -> list[dict]:
    with Session(engine) as session:
        _get_activity(session, activity_id)
        return _activity_friends(session, activity_id)


@router.put("/activities/{activity_id}/friends/{friend_id}", status_code=204)
def add_activity_friend(activity_id: int, friend_id: int) -> None:
    with Session(engine) as session:
        _get_activity(session, activity_id)
        if not session.get(Friend, friend_id):
            raise HTTPException(status_code=404, detail="Friend not found")
        if not session.get(ActivityFriend, (activity_id, friend_id)):
            session.add(ActivityFriend(activity_id=activity_id, friend_id=friend_id))
            session.commit()


@router.delete("/activities/{activity_id}/friends/{friend_id}", status_code=204)
def remove_activity_friend(activity_id: int, friend_id: int) -> None:
    with Session(engine) as session:
        link = session.get(ActivityFriend, (activity_id, friend_id))
        if link:
            session.delete(link)
            session.commit()


# ── Race results ──────────────────────────────────────────────────────────────


@router.put("/activities/{activity_id}/race-result")
def save_race_result(activity_id: int, data: RaceResultIn) -> dict:
    with Session(engine) as session:
        _get_activity(session, activity_id)
        fields = data.model_dump(exclude={"splits"})
        result = session.exec(
            select(RaceResult).where(RaceResult.activity_id == activity_id)
        ).first()
        if result:
            for key, value in fields.items():
                setattr(result, key, value)
        else:
            result = RaceResult(activity_id=activity_id, **fields)
        session.add(result)
        session.commit()
        session.refresh(result)
        result_id = require_id(result.id)
        for split in session.exec(
            select(RaceResultSplit).where(RaceResultSplit.race_result_id == result_id)
        ).all():
            session.delete(split)
        for order, split in enumerate(s for s in data.splits if s.label.strip()):
            session.add(
                RaceResultSplit(
                    race_result_id=result_id,
                    label=split.label.strip(),
                    order=order,
                    duration_seconds=split.duration_seconds,
                    rank=split.rank,
                )
            )
        session.commit()
        return _race_result(session, activity_id) or {}


@router.delete("/activities/{activity_id}/race-result", status_code=204)
def delete_race_result(activity_id: int) -> None:
    with Session(engine) as session:
        result = session.exec(
            select(RaceResult).where(RaceResult.activity_id == activity_id)
        ).first()
        if result:
            for split in session.exec(
                select(RaceResultSplit).where(RaceResultSplit.race_result_id == result.id)
            ).all():
                session.delete(split)
            session.delete(result)
            session.commit()


# Gaps between legs shorter than this are clock jitter, not a transition
_MIN_TRANSITION_SECONDS = 5
_LEG_LABELS = {"swimming": "Swim", "cycling": "Bike", "running": "Run", "trail_running": "Run"}
_LEG_KINDS = {"Swim": "swim", "Bike": "bike", "Run": "run"}


def _leg_segments(legs: list[Activity]) -> list[dict]:
    """Legs of a multisport event in order, with the transitions between them.

    A transition is the time from the end of one leg to the start of the next. Repeated
    disciplines are numbered (a duathlon's Run 1 and Run 2), transitions as T1, T2, …
    """
    labels = [_LEG_LABELS.get(leg.sport.value, leg.sport.value.replace("_", " ").title())
              for leg in legs]
    repeated = {label for label in labels if labels.count(label) > 1}
    seen: dict[str, int] = {}
    segments: list[dict] = []
    transitions = 0
    for i, (leg, label) in enumerate(zip(legs, labels)):
        if i > 0:
            previous = legs[i - 1]
            gap = (leg.date - previous.date).total_seconds() - (previous.duration_seconds or 0)
            if gap >= _MIN_TRANSITION_SECONDS:
                transitions += 1
                segments.append({"label": f"T{transitions}", "kind": f"t{transitions}",
                                 "seconds": round(gap, 1), "distance_meters": None,
                                 "activity_id": None})
        seen[label] = seen.get(label, 0) + 1
        segments.append(
            {
                "label": f"{label} {seen[label]}" if label in repeated else label,
                "kind": _LEG_KINDS.get(label, "other"),
                "seconds": leg.duration_seconds,
                "distance_meters": leg.distance_meters,
                "activity_id": leg.id,
            }
        )
    return segments


@router.get("/multisport")
def list_multisport() -> list[dict]:
    """Triathlons, duathlons and other multisport events with their legs and transitions,
    newest first, from the legs recorded in the FIT file (no splits need to be typed in)."""
    parent_sports = [SportType.triathlon, SportType.duathlon, SportType.multisport]
    with Session(engine) as session:
        parents = session.exec(
            select(Activity)
            .where(col(Activity.sport).in_(parent_sports), col(Activity.parent_id).is_(None))
            .order_by(col(Activity.date).desc())
        ).all()
        ids = [p.id for p in parents]
        legs_by_parent: dict[int, list[Activity]] = {}
        if ids:
            for leg in session.exec(
                select(Activity).where(col(Activity.parent_id).in_(ids)).order_by(col(Activity.date))
            ).all():
                legs_by_parent.setdefault(leg.parent_id, []).append(leg)
        raced = set(session.exec(select(RaceResult.activity_id)).all())
    return [
        {
            "id": parent.id,
            "name": parent.name,
            "date": parent.date.isoformat(),
            "sport": parent.sport.value,
            "is_race": parent.kind == ActivityKind.race or parent.id in raced,
            "duration_seconds": parent.duration_seconds,
            "segments": _leg_segments(legs_by_parent.get(parent.id, [])),
        }
        for parent in parents
        if len(legs_by_parent.get(parent.id, [])) >= 2
    ]


@router.get("/races")
def list_races() -> list[dict]:
    with Session(engine) as session:
        results = session.exec(
            select(RaceResult, Activity)
            .join(Activity, col(RaceResult.activity_id) == col(Activity.id))
            .order_by(col(Activity.date).desc(), col(Activity.id).desc())
        ).all()
        parents = multisport_parent_sports(session, (a.parent_id for _, a in results))
        result_ids = [r.id for r, _ in results if r.id is not None]
        splits_by_result: dict[int, list[dict]] = {}
        if result_ids:
            for split in session.exec(
                select(RaceResultSplit)
                .where(col(RaceResultSplit.race_result_id).in_(result_ids))
                .order_by(col(RaceResultSplit.order))
            ).all():
                splits_by_result.setdefault(split.race_result_id, []).append(_dump(split))
        return [
            {
                **_dump(result),
                "activity": _activity_dump(activity),
                "parent_sport": parents.get(activity.parent_id) if activity.parent_id else None,
                "splits": splits_by_result.get(result.id or -1, []),
            }
            for result, activity in results
        ]


# ── Best efforts ──────────────────────────────────────────────────────────────

# Stored distances come from a fixed set of targets that are far apart, so a small
# tolerance safely absorbs float rounding from the URL round-trip.
_DISTANCE_TOLERANCE = 0.5

TOP_METRIC_FIELDS = {"elevation": "elevation_gain_meters", "distance": "distance_meters"}


def _best_effort_rows(
    sport: Optional[str], year: Optional[int], distance: Optional[float] = None
) -> list[dict]:
    with Session(engine) as session:
        stmt = select(BestEffort, Activity).join(
            Activity, col(BestEffort.activity_id) == col(Activity.id)
        )
        if distance is not None:
            stmt = stmt.where(col(BestEffort.distance_meters) >= distance - _DISTANCE_TOLERANCE)
            stmt = stmt.where(col(BestEffort.distance_meters) <= distance + _DISTANCE_TOLERANCE)
        sport_types = _sport_types(sport)
        if sport_types:
            stmt = stmt.where(col(BestEffort.sport).in_(sport_types))
        if year:
            stmt = stmt.where(BestEffort.year == year)
        stmt = stmt.order_by(col(BestEffort.distance_meters), col(BestEffort.duration_seconds))
        results = session.exec(stmt).all()
        parents = multisport_parents(session, (a.parent_id for _, a in results))
        raced = set(session.exec(select(RaceResult.activity_id)).all())

        def parent_of(activity: Activity) -> Optional[Activity]:
            return parents.get(activity.parent_id) if activity.parent_id else None

        return [
            {
                **_dump(effort),
                # A multisport leg is named after its event, e.g. the triathlon it belongs to
                "activity_name": (parent_of(activity) or activity).name,
                "kind": activity.kind.value,
                # A race is an activity marked as one or with an official result entered
                "is_race": activity.kind == ActivityKind.race or activity.id in raced,
                # Climb of the whole activity, not just the best-effort segment
                "elevation_gain_meters": activity.elevation_gain_meters,
                "parent_sport": parent.sport.value if (parent := parent_of(activity)) else None,
            }
            for effort, activity in results
        ]


def _top_activities(
    metric: str, sport: Optional[str], year: Optional[int], limit: Optional[int] = None
) -> list[dict]:
    """Activities ranked by the metric, best first; multisport legs count per sport."""
    if metric not in TOP_METRIC_FIELDS:
        raise HTTPException(status_code=404, detail=f"Unknown ranking '{metric}'")
    ranked = col(getattr(Activity, TOP_METRIC_FIELDS[metric]))
    with Session(engine) as session:
        stmt = select(Activity).where(ranked.is_not(None)).where(ranked > 0)
        sport_types = _sport_types(sport)
        if sport_types:
            stmt = stmt.where(col(Activity.sport).in_(sport_types))
        else:
            # Without a sport filter a multisport parent already covers its legs
            stmt = stmt.where(col(Activity.parent_id).is_(None))
        stmt = _in_year(stmt, Activity.date, year).order_by(ranked.desc())
        if limit:
            stmt = stmt.limit(limit)
        activities = session.exec(stmt).all()
        parents = multisport_parent_sports(session, (a.parent_id for a in activities))
        rows = []
        for activity in activities:
            data = _activity_dump(activity)
            data["parent_sport"] = parents.get(activity.parent_id) if activity.parent_id else None
            rows.append(data)
        return rows


@router.get("/best-efforts")
def list_best_efforts(sport: Optional[str] = None, year: Optional[int] = None) -> list[dict]:
    return _best_effort_rows(sport, year)


@router.get("/best-efforts/overview")
def best_efforts_overview(sport: Optional[str] = None, year: Optional[int] = None) -> dict:
    """Everything the trophy case shows: the record per distance, standouts and totals."""
    records: dict[float, dict] = {}
    for effort in _best_effort_rows(sport, year):
        records.setdefault(effort["distance_meters"], effort)

    with Session(engine) as session:
        stmt = select(Activity)
        sport_types = _sport_types(sport)
        if sport_types:
            stmt = stmt.where(col(Activity.sport).in_(sport_types))
        activities = session.exec(_in_year(stmt, Activity.date, year)).all()

    standouts = {}
    for metric in TOP_METRIC_FIELDS:
        top = _top_activities(metric, sport, year, limit=1)
        if top:
            standouts[metric] = top[0]

    return {
        "records": [records[d] for d in sorted(records)],
        "standouts": standouts,
        "summary": {
            "count": len(activities),
            "distance_meters": sum(a.distance_meters or 0 for a in activities),
            "duration_seconds": sum(a.duration_seconds for a in activities),
        },
    }


@router.get("/best-efforts/attempts")
def best_effort_attempts(
    distance: float, sport: Optional[str] = None, year: Optional[int] = None
) -> list[dict]:
    rows = _best_effort_rows(sport, year, distance)
    return sorted(rows, key=lambda r: r["duration_seconds"])


@router.get("/top-activities/{metric}")
def top_activities(
    metric: str,
    sport: Optional[str] = None,
    year: Optional[int] = None,
    limit: Optional[int] = None,
) -> list[dict]:
    return _top_activities(metric, sport, year, limit)


# ── Stats for charts ──────────────────────────────────────────────────────────


@router.get("/stats/graphs")
def graph_stats(sport: Optional[str] = None) -> dict:
    """One compact row per activity of the sport, oldest first, for the Graphs page.

    The page aggregates these in the browser (weekly/monthly/yearly volume, breakdowns,
    year-over-year progress, pace trend), so changing the year filter needs no new request.
    """
    with Session(engine) as session:
        stmt = select(Activity)
        sport_types = _sport_types(sport)
        if sport_types:
            stmt = stmt.where(col(Activity.sport).in_(sport_types))
        activities = session.exec(stmt.order_by(col(Activity.date))).all()

    return {
        "activities": [
            {
                "id": a.id,
                "name": a.name,
                "date": a.date.isoformat(),
                "sport": a.sport.value,
                "kind": a.kind.value,
                "distance_meters": a.distance_meters,
                "duration_seconds": a.duration_seconds,
                "elevation_meters": a.elevation_gain_meters,
                "avg_heart_rate": a.avg_heart_rate,
            }
            for a in activities
        ],
    }


# ── Map ───────────────────────────────────────────────────────────────────────

_MAX_POINTS_PER_ROUTE = 250


def _simplify(coords: list[list[float]]) -> list[list[float]]:
    """Evenly decimate a route so the combined map stays responsive."""
    if len(coords) <= _MAX_POINTS_PER_ROUTE:
        simplified = coords
    else:
        step = len(coords) / _MAX_POINTS_PER_ROUTE
        simplified = [coords[int(i * step)] for i in range(_MAX_POINTS_PER_ROUTE)]
        simplified.append(coords[-1])
    return [[round(float(c[0]), 5), round(float(c[1]), 5)] for c in simplified]


@router.get("/map")
def map_routes(sports: Optional[str] = None) -> dict:
    """Every activity with GPS data, for the all-activities map.

    ``sports`` is an optional comma-separated list of sports; by default every sport that has
    a route is drawn. A multisport leg is dropped when its parent is drawn as well, since
    both share the same GPS track.
    """
    with Session(engine) as session:
        present = {
            s.value
            for s in session.exec(
                select(Activity.sport).where(col(Activity.route_json).is_not(None)).distinct()
            ).all()
        }
        available = [s for s in SPORTS if s in present]
        wanted = (
            [s.strip() for s in sports.split(",") if s.strip()] if sports is not None else available
        )
        if any(s not in SPORTS for s in wanted):
            raise HTTPException(status_code=400, detail="Unknown sport")
        candidates = (
            session.exec(
                select(Activity)
                .where(col(Activity.sport).in_([SportType(s) for s in wanted]))
                .order_by(col(Activity.date).desc())
            ).all()
            if wanted
            else []
        )

    ids = {a.id for a in candidates}
    candidates = [a for a in candidates if a.parent_id not in ids]
    routes = []
    for activity in candidates:
        if not activity.route_json:
            continue
        try:
            raw = json.loads(activity.route_json)
        except (ValueError, TypeError):
            continue
        coords = [c for c in raw if c and len(c) >= 2 and c[0] is not None and c[1] is not None]
        if len(coords) < 2:
            continue
        data = _activity_dump(activity)
        data["coords"] = _simplify(coords)
        routes.append(data)

    return {
        "available": available,
        "routes": routes,
        "counts": {
            "drawn": len(routes),
            "total": len(candidates),
            "without_gps": sum(1 for a in candidates if not a.route_json),
        },
    }


# ── Training ──────────────────────────────────────────────────────────────────


@router.get("/training")
def training_overview() -> dict:
    """Every activity with its training load, zones and stored metrics, plus the heart rate,
    power and weight values the charts use. ``pending`` counts activities still to analyse."""
    return metrics.overview()


@router.post("/training/analyse")
def analyse_activities() -> StreamingResponse:
    """Compute the missing metrics of the account, streaming progress as JSON lines."""
    messages: "queue.Queue[Optional[dict]]" = queue.Queue()

    def work() -> None:
        try:
            result = metrics.backfill(
                lambda done, total, name: messages.put(
                    {"type": "progress", "done": done, "total": total, "name": name}
                )
            )
            messages.put({"type": "result", **result})
        except Exception as exc:
            logger.exception("Analysing activities failed")
            messages.put({"type": "error", "message": str(exc)})
        finally:
            messages.put(None)

    context = copy_context()
    threading.Thread(target=context.run, args=(work,), daemon=True).start()

    def stream():
        while (message := messages.get()) is not None:
            yield json.dumps(message) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")


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


def _owner() -> str:
    owner_id = current_owner.get()
    if not owner_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return owner_id


@router.get("/garmin/status")
def garmin_status() -> dict:
    with Session(engine) as session:
        latest = session.exec(select(Activity.date).order_by(col(Activity.date).desc())).first()
    default_since = (latest.date() - timedelta(days=1)) if latest else (
        date.today() - timedelta(days=90)
    )
    return {
        "authenticated": garmin_sync.tokens_exist(),
        "email": garmin_sync.saved_email(),
        "default_since": default_since.isoformat(),
    }


@router.post("/garmin/login")
def garmin_login(data: GarminLogin) -> dict:
    email = data.email.strip()
    if not email or not data.password:
        raise HTTPException(status_code=400, detail="Email and password are required")
    try:
        result = garmin_sync.attempt_login(email, data.password)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    if result.get("needs_mfa"):
        with _pending_lock:
            _pending_mfa[_owner()] = (result["_client"], result["_state"], email, time.time())
        return {"needs_mfa": True}
    garmin_sync.save_email(email)
    return {"needs_mfa": False}


@router.post("/garmin/mfa")
def garmin_mfa(data: GarminMfa) -> dict:
    with _pending_lock:
        pending = _pending_mfa.pop(_owner(), None)
    if not pending or time.time() - pending[3] > _MFA_SECONDS:
        raise HTTPException(status_code=400, detail="No login is waiting for a code; sign in again")
    client, state, email, _ = pending
    try:
        garmin_sync.complete_mfa(client, state, data.code.strip())
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"MFA failed: {exc}") from None
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
            messages.put({"type": "error", "message": str(exc)})
        finally:
            messages.put(None)

    context = copy_context()
    threading.Thread(target=context.run, args=(work,), daemon=True).start()

    def stream():
        while (message := messages.get()) is not None:
            yield json.dumps(message) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")



# ── Apple Health ──────────────────────────────────────────────────────────────

MAX_APPLE_HEALTH_BYTES = 25 * 1024 * 1024


async def _json_body(request: Request, limit: int) -> Any:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise HTTPException(status_code=413, detail="Request is too large")
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > limit:
            raise HTTPException(status_code=413, detail="Request is too large")
    try:
        return json.loads(body)
    except ValueError:
        raise HTTPException(status_code=400, detail="Body is not valid JSON") from None


async def _import_apple_workouts(request: Request) -> dict:
    payload = await _json_body(request, MAX_APPLE_HEALTH_BYTES)
    try:
        workouts = apple_health.workouts_from_payload(payload)
        result = await _run_in_thread(apple_health.import_workouts, workouts)
    except apple_health.WorkoutError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    logger.info(
        "Apple Health: {} imported, {} skipped, {} failed",
        len(result["imported"]), result["skipped"], len(result["errors"]),
    )
    return result


@router.get("/integrations/apple-health")
def apple_health_status() -> dict:
    return {"token": auth.integration_token_info(_owner(), auth.APPLE_HEALTH)}


@router.post("/integrations/apple-health/token")
def apple_health_create_token() -> dict:
    """Create (or replace) the token Health Auto Export sends; it is only shown this once."""
    token = auth.create_integration_token(_owner(), auth.APPLE_HEALTH)
    return {"token": token, "webhook_path": "/api/integrations/apple-health/webhook"}


@router.delete("/integrations/apple-health/token", status_code=204)
def apple_health_revoke_token() -> None:
    auth.revoke_integration_token(_owner(), auth.APPLE_HEALTH)


@router.post("/integrations/apple-health/webhook")
async def apple_health_webhook(request: Request) -> dict:
    """Health Auto Export "REST API" automation target; authenticated by its bearer token."""
    return await _import_apple_workouts(request)


@router.post("/integrations/apple-health/import")
async def apple_health_import(request: Request) -> dict:
    """Workouts the web app read from an Apple Health export.zip, in the same JSON format."""
    return await _import_apple_workouts(request)
