"""Data for the Graphs page and the all-activities map."""

import json
from typing import Optional

from fastapi import APIRouter, HTTPException
from sqlmodel import col, select

from app.database import engine
from app.formatting import SPORTS
from app.models import (
    Activity,
    SportType,
)
from app.ownership import UserSession as Session
from app.routes.common import (
    activity_dump,
    sport_filter,
)

router = APIRouter()


# ── Stats for charts ──────────────────────────────────────────────────────────


@router.get("/stats/graphs")
def graph_stats(sport: Optional[str] = None) -> dict:
    """One compact row per activity of the sport, oldest first, for the Graphs page.

    The page aggregates these in the browser (weekly/monthly/yearly volume, breakdowns,
    year-over-year progress, pace trend), so changing the year filter needs no new request.
    """
    with Session(engine) as session:
        stmt = select(Activity)
        sport_types = sport_filter(sport)
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
        data = activity_dump(activity)
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
