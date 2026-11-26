"""Activities: listing, creating, editing and deleting them, file uploads and
imports, and an activity's laps, route, per-second streams, detail and friends."""

import json
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Form, HTTPException, Query, UploadFile
from loguru import logger
from pydantic import BaseModel
from sqlalchemy import func
from sqlmodel import col, select

from app import fit_files, garmin_sync, strava, streams
from app.database import engine, require_id
from app.errors import public_message
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
from app.queries import multisport_parent_sports
from app.race_efforts import effort_fields, race_efforts
from app.routes.common import (
    activity_dump,
    dump,
    fetch_activity,
    in_year,
    run_in_thread,
    sport_filter,
)
from app.routes.races import race_result_dump

router = APIRouter()


MAX_FIT_BYTES = 50 * 1024 * 1024

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


# ── Activities ────────────────────────────────────────────────────────────────


def _activities_query(
    sport: Optional[str],
    year: Optional[int],
    friend: Optional[int],
    since: Optional[date] = None,
    until: Optional[date] = None,
):
    """The activities a list shows: without a sport filter only top-level activities (a
    multisport event stands for its legs); with one, the legs of that sport on their own.
    ``since`` and ``until`` keep the activities from and to those days, both included."""
    stmt = select(Activity)
    if since is not None:
        stmt = stmt.where(col(Activity.date) >= datetime.combine(since, time.min))
    if until is not None:
        end = datetime.combine(until + timedelta(days=1), time.min)
        stmt = stmt.where(col(Activity.date) < end)
    if friend is not None:
        stmt = stmt.where(
            col(Activity.id).in_(
                select(ActivityFriend.activity_id).where(ActivityFriend.friend_id == friend)
            )
        )
    sport_types = sport_filter(sport)
    if sport_types:
        stmt = stmt.where(col(Activity.sport).in_(sport_types))
    else:
        stmt = stmt.where(col(Activity.parent_id).is_(None))
    return in_year(stmt, Activity.date, year)


def _parse_cursor(before: str) -> tuple[datetime, int]:
    """``before`` is "<date>,<id>" of the last activity of the previous page."""
    try:
        when, activity_id = before.rsplit(",", 1)
        return datetime.fromisoformat(when), int(activity_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid 'before' cursor") from None


@router.get("/activities")
def list_activities(
    sport: Optional[str] = None,
    year: Optional[int] = None,
    friend: Optional[int] = None,
    since: Optional[date] = None,
    until: Optional[date] = None,
    limit: Optional[int] = Query(default=None, ge=1, le=500),
    before: Optional[str] = None,
) -> list[dict]:
    """Activities, newest first.

    Without a sport filter only top-level activities are listed (a multisport event stands
    for its legs); with a filter, legs of that sport are listed on their own. ``friend``
    keeps the activities that friend is tagged on, ``since`` and ``until`` those from and to
    a day (both included).

    Without ``limit`` every activity is listed. With it, a page of at most ``limit``; the next
    page starts after the last one: pass its date and id as ``before="<date>,<id>"``.
    """
    with Session(engine) as session:
        stmt = _activities_query(sport, year, friend, since, until)
        if before is not None:
            when, activity_id = _parse_cursor(before)
            stmt = stmt.where(
                (col(Activity.date) < when)
                | ((col(Activity.date) == when) & (col(Activity.id) < activity_id))
            )
        stmt = stmt.order_by(col(Activity.date).desc(), col(Activity.id).desc())
        if limit is not None:
            stmt = stmt.limit(limit)
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
            data = activity_dump(activity)
            data["has_race_result"] = activity.id in with_result
            data["parent_sport"] = parents.get(activity.parent_id) if activity.parent_id else None
            rows.append(data)
        return rows


@router.get("/activities/totals")
def activity_totals(
    sport: Optional[str] = None,
    year: Optional[int] = None,
    friend: Optional[int] = None,
    since: Optional[date] = None,
    until: Optional[date] = None,
) -> dict:
    """Count, distance, time and climbing of the activities ``/activities`` lists with the same
    filters, so a paged list can show the totals of all of them. A multisport leg counts only
    when its event is not listed as well."""
    with Session(engine) as session:
        listed = _activities_query(sport, year, friend, since, until).subquery()
        row = session.exec(
            select(
                func.count(listed.c.id),
                func.coalesce(func.sum(listed.c.distance_meters), 0),
                func.coalesce(func.sum(listed.c.duration_seconds), 0),
                func.coalesce(func.sum(listed.c.elevation_gain_meters), 0),
            ).where(
                listed.c.parent_id.is_(None)
                | listed.c.parent_id.not_in(select(listed.c.id).scalar_subquery())
            )
        ).one()
    count, meters, seconds, climb = row
    return {
        "count": count,
        "meters": float(meters),
        "seconds": float(seconds),
        "climb": float(climb),
    }


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
        return activity_dump(activity)


@router.get("/activities/{activity_id}")
def get_activity(activity_id: int) -> dict:
    with Session(engine) as session:
        return activity_dump(fetch_activity(session, activity_id))


@router.patch("/activities/{activity_id}")
def update_activity(activity_id: int, data: ActivityUpdate) -> dict:
    with Session(engine) as session:
        activity = fetch_activity(session, activity_id)
        for key, value in data.model_dump(exclude_unset=True, exclude={"friend_ids"}).items():
            setattr(activity, key, value)
        activity.updated_at = datetime.now(timezone.utc)
        session.add(activity)
        if data.friend_ids is not None:
            _set_activity_friends(session, activity_id, data.friend_ids)
        session.commit()
        session.refresh(activity)
        return activity_dump(activity)


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
    """Delete an activity with its multisport legs, and its FIT file (with the cached streams)
    unless another activity still uses that file, like the event of a deleted leg."""
    with Session(engine) as session:
        activity = fetch_activity(session, activity_id)
        children = session.exec(select(Activity).where(Activity.parent_id == activity_id)).all()
        files = [
            path
            for a in [activity, *children]
            if (path := streams.fit_path_for(a.fit_file_path)) is not None
        ]
        for child in children:
            _delete_activity_rows(session, child)
        session.flush()
        _delete_activity_rows(session, activity)
        session.commit()
    fit_files.remove_unreferenced(files)


@router.post("/activities/upload-fit", status_code=201)
async def upload_fit(file: UploadFile) -> dict:
    if not file.filename or not file.filename.lower().endswith(".fit"):
        raise HTTPException(status_code=400, detail="Only .fit files are accepted")
    content = await file.read(MAX_FIT_BYTES + 1)
    if len(content) > MAX_FIT_BYTES:
        raise HTTPException(status_code=413, detail="File is too large")
    try:
        activity_id = await run_in_thread(garmin_sync.import_fit_bytes, content)
    except Exception as exc:
        message = public_message(exc, "it is not a readable FIT activity", "FIT upload failed")
        raise HTTPException(status_code=400, detail=f"Could not import file: {message}") from None
    return get_activity(activity_id)


@router.post("/activities/import-file")
async def import_activity_file(
    file: UploadFile,
    name: Optional[str] = Form(None),
    activity_type: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    since: Optional[str] = Form(None),
    until: Optional[str] = Form(None),
) -> dict:
    """One activity file from a Strava export (or any .fit/.gpx/.tcx, optionally gzipped).

    The name, type and description come from the export's activities.csv. Returns
    ``{"status": "imported", "activity": {...}}`` or ``{"status": "skipped"}`` when an
    activity of the same sport already starts within a minute of it, or when it starts
    before ``since`` or at/after ``until`` (ISO 8601 moments, both optional).
    """
    filename = file.filename or ""
    try:
        window = (strava.parse_moment(since), strava.parse_moment(until))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid since/until date") from None
    content = await file.read(strava.MAX_FILE_BYTES + 1)
    if len(content) > strava.MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File is too large")
    try:
        result = await run_in_thread(
            strava.import_file, filename, content, name, activity_type, description, window
        )
    except Exception as exc:
        message = public_message(exc, "it is not a readable activity", "File import failed")
        raise HTTPException(status_code=400, detail=f"Could not import file: {message}") from None
    if result["status"] == "skipped":
        return {"status": "skipped"}
    return {"status": "imported", "activity": get_activity(result["id"])}


@router.get("/activities/{activity_id}/laps")
def get_laps(activity_id: int) -> list[dict]:
    with Session(engine) as session:
        laps = session.exec(
            select(Lap).where(Lap.activity_id == activity_id).order_by(col(Lap.lap_number))
        ).all()
        return [dump(lap) for lap in laps]


@router.get("/activities/{activity_id}/route")
def get_route(activity_id: int) -> dict:
    with Session(engine) as session:
        activity = fetch_activity(session, activity_id)
        coords = json.loads(activity.route_json) if activity.route_json else []
    return {"coords": coords}


@router.get("/activities/{activity_id}/streams")
async def get_streams(activity_id: int) -> dict:
    """Per-second data of the activity from its FIT file, with zones, climbs and a summary.

    ``available`` is false when the FIT file is no longer on disk (for example activities
    added by hand); the page then shows only the charts built from laps.
    """
    with Session(engine) as session:
        activity = fetch_activity(session, activity_id)
        # Fallback for files without watch settings: the highest heart rate on the account
        account_max_hr = session.exec(select(func.max(Activity.max_heart_rate))).one()
    path = streams.fit_path_for(activity.fit_file_path)
    if path is None:
        return {"available": False}
    leg = activity.parent_id is not None
    try:
        data = await run_in_thread(
            streams.cached_read_streams,
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
        activity = fetch_activity(session, activity_id)
        laps = session.exec(
            select(Lap).where(Lap.activity_id == activity_id).order_by(col(Lap.lap_number))
        ).all()
        efforts = [
            (effort, activity)
            for effort in session.exec(
                select(BestEffort).where(BestEffort.activity_id == activity_id)
            ).all()
        ]
        # A race measured just short of a distance counts for it, like on the best efforts
        # pages, and races of other activities count when ranking (see app/race_efforts.py)
        efforts += race_efforts(session, activity_id=activity_id)
        efforts.sort(key=lambda row: row[0].distance_meters)
        races = [effort for effort, _ in race_efforts(session)] if efforts else []
        ranked = []
        for effort, owner in efforts:
            faster = session.exec(
                select(func.count(BestEffort.id)).where(
                    BestEffort.sport == effort.sport,
                    BestEffort.distance_meters == effort.distance_meters,
                    BestEffort.duration_seconds < effort.duration_seconds,
                )
            ).one() + sum(
                1
                for race in races
                if race.sport == effort.sport
                and race.distance_meters == effort.distance_meters
                and race.duration_seconds < effort.duration_seconds
            )
            ranked.append(
                {**dump(effort), **effort_fields(effort, owner), "rank": faster + 1}
            )

        children: list[dict] = []
        parent: Optional[dict] = None
        if activity.parent_id is None:
            children = [
                activity_dump(c)
                for c in session.exec(
                    select(Activity)
                    .where(Activity.parent_id == activity_id)
                    .order_by(col(Activity.date))
                ).all()
            ]
        else:
            parent_activity = session.get(Activity, activity.parent_id)
            if parent_activity:
                parent = activity_dump(parent_activity)

        return {
            "activity": activity_dump(activity),
            "laps": [dump(lap) for lap in laps],
            "best_efforts": ranked,
            "children": children,
            "parent": parent,
            "race_result": race_result_dump(session, activity_id),
            "friends": _activity_friends(session, activity_id),
        }


# ── Activity friends ──────────────────────────────────────────────────────────


@router.get("/activities/{activity_id}/friends")
def list_activity_friends(activity_id: int) -> list[dict]:
    with Session(engine) as session:
        fetch_activity(session, activity_id)
        return _activity_friends(session, activity_id)


@router.put("/activities/{activity_id}/friends/{friend_id}", status_code=204)
def add_activity_friend(activity_id: int, friend_id: int) -> None:
    with Session(engine) as session:
        fetch_activity(session, activity_id)
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
