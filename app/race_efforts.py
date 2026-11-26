"""Best efforts of races: their official time, or their whole time when GPS measured them short.

A best effort is the fastest stretch of a standard distance inside an activity, found in its
GPS data. A race is run over its official distance, so:

- a race with a race result whose official time is entered counts that time for the standard
  distance its GPS measured (up to ``RACE_SHORTFALL`` short or ``RACE_OVERSHOOT`` long),
  instead of the fastest stretch: the race result is what the race officially took;
- any other race whose GPS measured it up to ``RACE_SHORTFALL`` short of a standard distance
  (so it has no best effort there) counts its whole (moving) time for that distance.

A race is an activity marked as one or with a race result, or a multisport leg of such an
event; a leg counts its own time, as the event's official time is for the whole event.

These efforts are not stored: they are added when best efforts are read, so marking or
unmarking a race, entering its result or correcting its distance takes effect at once. They
carry ``source`` "official" or "race" (stored ones "gps") and the ``measured_meters``.
Everything else (pace, totals, training load) keeps using the moving time.
"""

from typing import Optional

from sqlmodel import col, select

from app.fit_parser import BEST_EFFORT_DISTANCES
from app.models import Activity, ActivityKind, BestEffort, RaceResult, SportType

# A race may measure this much short of its distance (2%: 844 m of a marathon)
RACE_SHORTFALL = 0.02
# ... and, with an official time, this much long (5%, as for GPS best efforts)
RACE_OVERSHOOT = 0.05
_SAME_DISTANCE = 0.5


def race_distance(
    sport: SportType, distance: Optional[float], official: bool = False
) -> Optional[float]:
    """The standard distance a race of ``distance`` metres was run over, if any.

    Without an official time only a race measured short counts: one measured long already
    has a GPS best effort at the distance.
    """
    if not distance:
        return None
    for target in BEST_EFFORT_DISTANCES.get(sport, []):
        if target * (1 - RACE_SHORTFALL) <= distance and (
            distance <= target * (1 + RACE_OVERSHOOT) if official else distance < target
        ):
            return target
    return None


def race_efforts(
    session,
    sports: Optional[list[SportType]] = None,
    year: Optional[int] = None,
    distance: Optional[float] = None,
    activity_id: Optional[int] = None,
) -> list[tuple[BestEffort, Activity]]:
    """(effort, activity) for every race of the account that counts for a distance.

    The effort is not stored; its id is the activity's id, negated, so it never collides
    with a stored effort. It takes the place of a stored effort of the activity at the same
    distance (see ``with_race_efforts``).
    """
    candidate_sports = [s for s in BEST_EFFORT_DISTANCES if not sports or s in sports]
    if not candidate_sports:
        return []
    stmt = select(Activity).where(
        col(Activity.sport).in_(candidate_sports), col(Activity.distance_meters).is_not(None)
    )
    if activity_id is not None:
        stmt = stmt.where(Activity.id == activity_id)
    activities = [
        a for a in session.exec(stmt).all() if year is None or a.date.year == year
    ]
    if not activities:
        return []

    results = {r.activity_id: r for r in session.exec(select(RaceResult)).all()}
    official = {
        aid: r.official_time_seconds for aid, r in results.items() if r.official_time_seconds
    }
    candidates = [
        (activity, target)
        for activity in activities
        if (
            target := race_distance(
                activity.sport, activity.distance_meters, activity.id in official
            )
        )
        is not None
        and (distance is None or abs(target - distance) < _SAME_DISTANCE)
    ]
    if not candidates:
        return []

    parent_ids = {a.parent_id for a, _ in candidates if a.parent_id is not None}
    racing_parents = (
        {
            p.id
            for p in session.exec(select(Activity).where(col(Activity.id).in_(parent_ids))).all()
            if p.kind == ActivityKind.race or p.id in results
        }
        if parent_ids
        else set()
    )
    # Without an official time a GPS effort at the same distance (data and summary can
    # disagree slightly) wins
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
            or activity.id in results
            or activity.parent_id in racing_parents
        )
        has_gps_effort = any(
            aid == activity.id and abs(d - target) < _SAME_DISTANCE for aid, d in stored
        )
        if not is_race or (activity.id not in official and has_gps_effort):
            continue
        efforts.append(
            (
                BestEffort(
                    id=-activity.id,
                    activity_id=activity.id,
                    sport=activity.sport,
                    distance_meters=target,
                    duration_seconds=official.get(activity.id, activity.duration_seconds),
                    date=activity.date,
                    year=activity.date.year,
                ),
                activity,
            )
        )
    return efforts


def replaced_by(races: list[tuple[BestEffort, Activity]]) -> set[tuple[int, float]]:
    """(activity id, distance) of the stored efforts these race efforts take the place of."""
    return {(effort.activity_id, effort.distance_meters) for effort, _ in races}


def is_replaced(effort: BestEffort, replaced: set[tuple[int, float]]) -> bool:
    return any(
        aid == effort.activity_id and abs(d - effort.distance_meters) < _SAME_DISTANCE
        for aid, d in replaced
    )


def with_race_efforts(session, rows: list, **filters) -> list:
    """Stored (effort, activity) rows with the race efforts in place of the ones they replace."""
    races = race_efforts(session, **filters)
    replaced = replaced_by(races)
    return [row for row in rows if not is_replaced(row[0], replaced)] + races


def effort_fields(effort: BestEffort, activity: Activity) -> dict:
    """What tells a race effort from a stored one in API responses."""
    if effort.id is not None and effort.id < 0:
        # The official time, unless it happens to equal the moving time (then either reads)
        official = effort.duration_seconds != activity.duration_seconds
        return {
            "source": "official" if official else "race",
            "measured_meters": activity.distance_meters,
        }
    return {"source": "gps", "measured_meters": None}
