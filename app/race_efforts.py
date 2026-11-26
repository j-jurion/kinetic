"""Best efforts of races whose GPS measured them slightly short.

A best effort is the fastest stretch of a standard distance inside an activity, so a
marathon whose GPS measured 42,150 m has no marathon best effort at all. A race is run over
its official distance, so a race whose total distance is less than ``RACE_SHORTFALL`` short of
a standard distance counts its whole time as that distance.

These efforts are not stored: they are added when best efforts are read, so marking or
unmarking a race, adding or removing its result, or correcting its distance takes effect at
once. They carry ``source: "race"`` and the ``measured_meters``; stored ones ``"gps"``.
"""

from typing import Optional

from sqlmodel import col, select

from app.fit_parser import BEST_EFFORT_DISTANCES
from app.models import Activity, ActivityKind, BestEffort, RaceResult, SportType

# A race may measure this much short of its distance (2%: 844 m of a marathon)
RACE_SHORTFALL = 0.02


def race_distance(sport: SportType, distance: Optional[float]) -> Optional[float]:
    """The standard distance an activity of ``distance`` metres falls just short of, if any."""
    if not distance:
        return None
    for target in BEST_EFFORT_DISTANCES.get(sport, []):
        if target * (1 - RACE_SHORTFALL) <= distance < target:
            return target
    return None


def race_efforts(
    session,
    sports: Optional[list[SportType]] = None,
    year: Optional[int] = None,
    distance: Optional[float] = None,
    activity_id: Optional[int] = None,
) -> list[tuple[BestEffort, Activity]]:
    """(effort, activity) for every race of the account that measured just short.

    A race is an activity marked as one or with a race result, or a multisport leg of such an
    event. The effort is not stored; its id is the activity's id, negated, so it never
    collides with a stored effort.
    """
    candidate_sports = [s for s in BEST_EFFORT_DISTANCES if not sports or s in sports]
    if not candidate_sports:
        return []
    stmt = select(Activity).where(
        col(Activity.sport).in_(candidate_sports), col(Activity.distance_meters).is_not(None)
    )
    if activity_id is not None:
        stmt = stmt.where(Activity.id == activity_id)
    candidates = [
        (activity, target)
        for activity in session.exec(stmt).all()
        if (target := race_distance(activity.sport, activity.distance_meters)) is not None
        and (year is None or activity.date.year == year)
        and (distance is None or abs(target - distance) < 0.5)
    ]
    if not candidates:
        return []

    raced = set(session.exec(select(RaceResult.activity_id)).all())
    parent_ids = {a.parent_id for a, _ in candidates if a.parent_id is not None}
    racing_parents = (
        {
            p.id
            for p in session.exec(select(Activity).where(col(Activity.id).in_(parent_ids))).all()
            if p.kind == ActivityKind.race or p.id in raced
        }
        if parent_ids
        else set()
    )
    # A GPS effort at the same distance (data and summary can disagree slightly) wins
    stored = set(
        session.exec(
            select(BestEffort.activity_id, BestEffort.distance_meters).where(
                col(BestEffort.activity_id).in_([a.id for a, _ in candidates])
            )
        ).all()
    )

    efforts = []
    for activity, target in candidates:
        is_race = (
            activity.kind == ActivityKind.race
            or activity.id in raced
            or activity.parent_id in racing_parents
        )
        if not is_race or any(aid == activity.id and abs(d - target) < 0.5 for aid, d in stored):
            continue
        efforts.append(
            (
                BestEffort(
                    id=-activity.id,
                    activity_id=activity.id,
                    sport=activity.sport,
                    distance_meters=target,
                    duration_seconds=activity.duration_seconds,
                    date=activity.date,
                    year=activity.date.year,
                ),
                activity,
            )
        )
    return efforts


def effort_fields(effort: BestEffort, activity: Activity) -> dict:
    """What tells a race effort from a stored one in API responses."""
    if effort.id is not None and effort.id < 0:
        return {"source": "race", "measured_meters": activity.distance_meters}
    return {"source": "gps", "measured_meters": None}
