import json
from datetime import datetime, timezone
from typing import Optional

import aiofiles
import folium
from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlmodel import Session, col, select

from kinetic.database import engine, require_id
from kinetic.fit_parser import parse_fit_file
from kinetic.garmin_sync import UPLOAD_DIR
from kinetic.models import Activity, ActivityKind, BestEffort, Friend, Lap, SportType

router = APIRouter()

UPLOAD_DIR.mkdir(exist_ok=True)


# ── Route map endpoint ────────────────────────────────────────────────────────


@router.get("/activity/{activity_id}/map", response_class=HTMLResponse)
def get_activity_map(activity_id: int) -> HTMLResponse:
    with Session(engine) as session:
        activity = session.get(Activity, activity_id)
    if not activity or not activity.route_json:
        raise HTTPException(status_code=404, detail="No route data for this activity")

    coords: list[list[float]] = json.loads(activity.route_json)
    lats = [c[0] for c in coords]
    lons = [c[1] for c in coords]
    bounds = [[min(lats), min(lons)], [max(lats), max(lons)]]
    # CARTO basemaps now require an API key; OpenStreetMap tiles stay key-free.
    m = folium.Map(tiles="OpenStreetMap")
    m.fit_bounds(bounds, padding=(20, 20))
    folium.PolyLine(coords, color="#3b82f6", weight=3, opacity=0.85).add_to(m)
    folium.Marker(coords[0], tooltip="Start", icon=folium.Icon(color="green", icon="play")).add_to(
        m
    )
    folium.Marker(coords[-1], tooltip="Finish", icon=folium.Icon(color="red", icon="stop")).add_to(
        m
    )
    return HTMLResponse(content=m.get_root().render())


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


class FriendCreate(BaseModel):
    name: str
    email: Optional[str] = None


# ── Activities ────────────────────────────────────────────────────────────────


@router.get("/activities")
def list_activities(
    sport: Optional[SportType] = None,
    kind: Optional[ActivityKind] = None,
    year: Optional[int] = None,
) -> list[Activity]:
    with Session(engine) as session:
        stmt = select(Activity)
        if sport:
            stmt = stmt.where(Activity.sport == sport)
        if kind:
            stmt = stmt.where(Activity.kind == kind)
        if year:
            stmt = stmt.where(col(Activity.date) >= datetime(year, 1, 1))
            stmt = stmt.where(col(Activity.date) < datetime(year + 1, 1, 1))
        stmt = stmt.order_by(col(Activity.date).desc())
        return list(session.exec(stmt).all())


@router.post("/activities", status_code=201)
def create_activity(data: ActivityCreate) -> Activity:
    with Session(engine) as session:
        activity = Activity(**data.model_dump())
        session.add(activity)
        session.commit()
        session.refresh(activity)
        return activity


@router.get("/activities/{activity_id}")
def get_activity(activity_id: int) -> Activity:
    with Session(engine) as session:
        activity = session.get(Activity, activity_id)
        if not activity:
            raise HTTPException(status_code=404, detail="Activity not found")
        return activity


@router.patch("/activities/{activity_id}")
def update_activity(activity_id: int, data: ActivityUpdate) -> Activity:
    with Session(engine) as session:
        activity = session.get(Activity, activity_id)
        if not activity:
            raise HTTPException(status_code=404, detail="Activity not found")
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(activity, key, value)
        activity.updated_at = datetime.now(timezone.utc)
        session.add(activity)
        session.commit()
        session.refresh(activity)
        return activity


@router.delete("/activities/{activity_id}", status_code=204)
def delete_activity(activity_id: int) -> None:
    with Session(engine) as session:
        activity = session.get(Activity, activity_id)
        if not activity:
            raise HTTPException(status_code=404, detail="Activity not found")
        # Delete related laps and best efforts
        for lap in session.exec(select(Lap).where(Lap.activity_id == activity_id)).all():
            session.delete(lap)
        for be in session.exec(
            select(BestEffort).where(BestEffort.activity_id == activity_id)
        ).all():
            session.delete(be)
        session.delete(activity)
        session.commit()


# ── FIT upload ────────────────────────────────────────────────────────────────


@router.post("/activities/upload-fit", status_code=201)
async def upload_fit(file: UploadFile) -> Activity:
    if not file.filename or not file.filename.endswith(".fit"):
        raise HTTPException(status_code=400, detail="Only .fit files are accepted")

    dest = UPLOAD_DIR / file.filename
    async with aiofiles.open(dest, "wb") as f:
        await f.write(await file.read())

    activity, laps, best_efforts, _children = parse_fit_file(dest)

    with Session(engine) as session:
        session.add(activity)
        session.commit()
        session.refresh(activity)

        new_activity_id = require_id(activity.id)
        for lap in laps:
            lap.activity_id = new_activity_id
            session.add(lap)

        for be in best_efforts:
            be.activity_id = new_activity_id
            session.add(be)

        session.commit()
        session.refresh(activity)
        return activity


# ── Laps ──────────────────────────────────────────────────────────────────────


@router.get("/activities/{activity_id}/laps")
def get_laps(activity_id: int) -> list[Lap]:
    with Session(engine) as session:
        return list(session.exec(select(Lap).where(Lap.activity_id == activity_id)).all())


# ── Best Efforts ──────────────────────────────────────────────────────────────


@router.get("/best-efforts")
def list_best_efforts(
    sport: Optional[SportType] = None,
    year: Optional[int] = None,
) -> list[BestEffort]:
    with Session(engine) as session:
        stmt = select(BestEffort)
        if sport:
            stmt = stmt.where(BestEffort.sport == sport)
        if year:
            stmt = stmt.where(BestEffort.year == year)
        stmt = stmt.order_by(col(BestEffort.distance_meters), col(BestEffort.duration_seconds))
        return list(session.exec(stmt).all())


# ── Friends ───────────────────────────────────────────────────────────────────


@router.get("/friends")
def list_friends() -> list[Friend]:
    with Session(engine) as session:
        return list(session.exec(select(Friend)).all())


@router.post("/friends", status_code=201)
def create_friend(data: FriendCreate) -> Friend:
    with Session(engine) as session:
        friend = Friend(**data.model_dump())
        session.add(friend)
        session.commit()
        session.refresh(friend)
        return friend


@router.delete("/friends/{friend_id}", status_code=204)
def delete_friend(friend_id: int) -> None:
    with Session(engine) as session:
        friend = session.get(Friend, friend_id)
        if not friend:
            raise HTTPException(status_code=404, detail="Friend not found")
        session.delete(friend)
        session.commit()


# ── Stats for charts ──────────────────────────────────────────────────────────


@router.get("/stats/monthly")
def monthly_stats(sport: Optional[SportType] = None, year: Optional[int] = None) -> list[dict]:
    """Returns aggregated distance/duration per month."""
    with Session(engine) as session:
        stmt = select(Activity)
        if sport:
            stmt = stmt.where(Activity.sport == sport)
        if year:
            stmt = stmt.where(col(Activity.date) >= datetime(year, 1, 1))
            stmt = stmt.where(col(Activity.date) < datetime(year + 1, 1, 1))
        activities = session.exec(stmt).all()

    monthly: dict[tuple[int, int], dict] = {}
    for a in activities:
        key = (a.date.year, a.date.month)
        if key not in monthly:
            monthly[key] = {
                "year": key[0],
                "month": key[1],
                "count": 0,
                "distance_km": 0.0,
                "duration_hours": 0.0,
            }
        monthly[key]["count"] += 1
        monthly[key]["distance_km"] += (a.distance_meters or 0) / 1000
        monthly[key]["duration_hours"] += a.duration_seconds / 3600

    return sorted(monthly.values(), key=lambda x: (x["year"], x["month"]))


@router.get("/stats/yearly")
def yearly_stats(sport: Optional[SportType] = None) -> list[dict]:
    with Session(engine) as session:
        stmt = select(Activity)
        if sport:
            stmt = stmt.where(Activity.sport == sport)
        activities = session.exec(stmt).all()

    yearly: dict[int, dict] = {}
    for a in activities:
        y = a.date.year
        if y not in yearly:
            yearly[y] = {"year": y, "count": 0, "distance_km": 0.0, "duration_hours": 0.0}
        yearly[y]["count"] += 1
        yearly[y]["distance_km"] += (a.distance_meters or 0) / 1000
        yearly[y]["duration_hours"] += a.duration_seconds / 3600

    return sorted(yearly.values(), key=lambda x: x["year"])
