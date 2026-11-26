"""Best efforts per distance and the top activities rankings."""

from typing import Optional

from fastapi import APIRouter, HTTPException
from sqlmodel import col, select

from app.database import engine
from app.models import (
    Activity,
    ActivityKind,
    BestEffort,
    RaceResult,
)
from app.ownership import UserSession as Session
from app.queries import multisport_parent_sports, multisport_parents
from app.race_efforts import effort_fields, race_efforts
from app.routes.common import (
    activity_dump,
    dump,
    in_year,
    sport_filter,
)

router = APIRouter()


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
        sport_types = sport_filter(sport)
        if sport_types:
            stmt = stmt.where(col(BestEffort.sport).in_(sport_types))
        if year:
            stmt = stmt.where(BestEffort.year == year)
        results = list(session.exec(stmt).all())
        # Races measured just short of a distance count for it (see app/race_efforts.py)
        results += race_efforts(session, sport_types, year, distance)
        results.sort(key=lambda row: (row[0].distance_meters, row[0].duration_seconds))
        parents = multisport_parents(session, (a.parent_id for _, a in results))
        raced = set(session.exec(select(RaceResult.activity_id)).all())

        def parent_of(activity: Activity) -> Optional[Activity]:
            return parents.get(activity.parent_id) if activity.parent_id else None

        return [
            {
                **dump(effort),
                **effort_fields(effort, activity),
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
        sport_types = sport_filter(sport)
        if sport_types:
            stmt = stmt.where(col(Activity.sport).in_(sport_types))
        else:
            # Without a sport filter a multisport parent already covers its legs
            stmt = stmt.where(col(Activity.parent_id).is_(None))
        stmt = in_year(stmt, Activity.date, year).order_by(ranked.desc())
        if limit:
            stmt = stmt.limit(limit)
        activities = session.exec(stmt).all()
        parents = multisport_parent_sports(session, (a.parent_id for a in activities))
        rows = []
        for activity in activities:
            data = activity_dump(activity)
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
        sport_types = sport_filter(sport)
        if sport_types:
            stmt = stmt.where(col(Activity.sport).in_(sport_types))
        activities = session.exec(in_year(stmt, Activity.date, year)).all()

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
