"""Repairs of data imported by earlier versions. Run at startup; safe to repeat.

Earlier versions imported every file the watch tagged ``auto_multi_sport`` as a multisport
event, even when it held a single leg (a run or swim started from a multisport activity
profile): a "Multisport" activity with one leg, without laps or best efforts of its own.
The parser no longer does that; this turns the events already imported into the normal
activity they are. A real multisport event always has at least two legs, so nothing else
is touched.

Earlier versions also counted jumps in the distance data (a GPS fix far off, or distance
that arrived in one batch after a pause) as covered ground, which gave best efforts such as
1 km in 23 seconds. ``repair_impossible_best_efforts`` recomputes those from the FIT file.
"""

import re

from loguru import logger
from sqlalchemy import func
from sqlmodel import Session, col, select

from app.database import engine
from app.fit_parser import MAX_EFFORT_SPEED_MS, parse_fit_file
from app.models import (
    Activity,
    ActivityFriend,
    ActivityMetrics,
    BestEffort,
    Lap,
    RaceResult,
    RaceResultSplit,
    SportType,
)
from app.ownership import current_owner
from app.streams import fit_path_for

MULTISPORT = (SportType.triathlon, SportType.duathlon, SportType.multisport)
# The name the importer gave an event, e.g. "Multisport 20-11-2026"; a name the user or
# Garmin chose is kept
_DEFAULT_NAME = re.compile(r"^(Multisport|Triathlon|Duathlon) \d{2}-\d{2}-\d{4}$")
# What the activity takes over from the file (or its only leg); its id, owner, kind, notes,
# date, Garmin id, friends and race result stay as they are
_STATS = (
    "sport",
    "duration_seconds",
    "distance_meters",
    "elevation_gain_meters",
    "avg_heart_rate",
    "max_heart_rate",
    "avg_speed_ms",
    "max_speed_ms",
    "avg_cadence",
    "avg_power",
    "calories",
    "route_json",
)


def single_leg_events(session: Session) -> list[tuple[Activity, Activity]]:
    """Every (event, its only leg) of all accounts."""
    one_leg = (
        select(Activity.parent_id)
        .where(col(Activity.parent_id).is_not(None))
        .group_by(col(Activity.parent_id))
        .having(func.count() == 1)
    )
    events = session.exec(
        select(Activity).where(
            col(Activity.id).in_(one_leg),
            col(Activity.sport).in_(MULTISPORT),
            col(Activity.parent_id).is_(None),
        )
    ).all()
    pairs = []
    for event in events:
        leg = session.exec(select(Activity).where(Activity.parent_id == event.id)).one()
        pairs.append((event, leg))
    return pairs


def _rows(session: Session, model, activity_id: int) -> list:
    return list(session.exec(select(model).where(model.activity_id == activity_id)).all())


def _delete_leg(session: Session, leg: Activity) -> None:
    for model in (Lap, BestEffort, ActivityFriend, ActivityMetrics):
        for row in _rows(session, model, leg.id):
            session.delete(row)
    for race in _rows(session, RaceResult, leg.id):
        for split in session.exec(
            select(RaceResultSplit).where(RaceResultSplit.race_result_id == race.id)
        ).all():
            session.delete(split)
        session.delete(race)
    session.flush()
    session.delete(leg)


def merge_single_leg_event(session: Session, event: Activity, leg: Activity) -> None:
    """Make the event the normal activity of its only leg, and remove the leg.

    The stats, laps and best efforts come from the FIT file when it is on the server (the
    file's laps were never stored for these events); otherwise from the leg.
    """
    source, laps, best_efforts = leg, None, None
    path = fit_path_for(event.fit_file_path)
    if path is not None:
        try:
            parsed, file_laps, file_efforts, children = parse_fit_file(path)
            if not children:
                source, laps, best_efforts = parsed, file_laps, file_efforts
        except Exception:
            logger.exception("Could not re-read the FIT file of activity {}", event.id)

    if laps is None:
        laps = _rows(session, Lap, leg.id)
        best_efforts = _rows(session, BestEffort, leg.id)
    for name in _STATS:
        setattr(event, name, getattr(source, name))
    if _DEFAULT_NAME.match(event.name):
        event.name = source.name

    for model in (Lap, BestEffort, ActivityMetrics):
        for row in _rows(session, model, event.id):
            session.delete(row)
    session.flush()
    for row in [*laps, *best_efforts]:
        row.activity_id = event.id
        session.add(row)
    session.flush()
    _delete_leg(session, leg)


def repair_single_leg_events() -> int:
    """Repair every single-leg multisport event of every account; returns how many."""
    with Session(engine) as session:
        pairs = [(event.id, leg.id) for event, leg in single_leg_events(session)]
    repaired = []
    for event_id, leg_id in pairs:
        with Session(engine) as session:
            event, leg = session.get(Activity, event_id), session.get(Activity, leg_id)
            if event is None or leg is None:
                continue
            owner = event.owner_id
            try:
                merge_single_leg_event(session, event, leg)
                session.commit()
            except Exception:
                session.rollback()
                logger.exception("Could not repair single-leg multisport event {}", event_id)
                continue
        repaired.append((owner, event_id))
        logger.info("Turned single-leg multisport event {} into a normal activity", event_id)

    # The training metrics were computed for the event; compute them for the activity
    from app import metrics

    for owner, event_id in repaired:
        if not owner:
            continue
        token = current_owner.set(owner)
        try:
            metrics.store_quietly([event_id])
        finally:
            current_owner.reset(token)
    return len(repaired)


def impossible_best_efforts(session: Session) -> list[BestEffort]:
    """Every best effort, of all accounts, faster than its sport allows."""
    rows: list[BestEffort] = []
    for sport, speed in MAX_EFFORT_SPEED_MS.items():
        rows.extend(
            session.exec(
                select(BestEffort).where(
                    BestEffort.sport == sport,
                    col(BestEffort.distance_meters) > col(BestEffort.duration_seconds) * speed,
                )
            ).all()
        )
    return rows


def recompute_best_efforts(session: Session, activity: Activity) -> None:
    """Replace the activity's best efforts with those its FIT file gives now.

    Without a readable file (or for a multisport leg, whose file holds the whole event) only
    the impossible efforts are removed, and the others are kept.
    """
    fresh = None
    path = fit_path_for(activity.fit_file_path) if activity.parent_id is None else None
    if path is not None:
        try:
            _parsed, _laps, efforts, children = parse_fit_file(path)
            if not children:
                fresh = efforts
        except Exception:
            logger.exception("Could not re-read the FIT file of activity {}", activity.id)

    current = _rows(session, BestEffort, activity.id)
    if fresh is None:
        impossible = {row.id for row in impossible_best_efforts(session)}
        for row in current:
            if row.id in impossible:
                session.delete(row)
        return
    for row in current:
        session.delete(row)
    session.flush()
    for effort in fresh:
        # The activity's own date: it may have been edited since the import
        effort.activity_id = activity.id
        effort.date = activity.date
        effort.year = activity.date.year
        session.add(effort)


def repair_impossible_best_efforts() -> int:
    """Recompute the best efforts of every activity with an impossible one; returns how many."""
    with Session(engine) as session:
        activity_ids = sorted({row.activity_id for row in impossible_best_efforts(session)})
    for activity_id in activity_ids:
        with Session(engine) as session:
            activity = session.get(Activity, activity_id)
            if activity is None:
                continue
            try:
                recompute_best_efforts(session, activity)
                session.commit()
            except Exception:
                session.rollback()
                logger.exception("Could not recompute the best efforts of activity {}", activity_id)
                continue
        logger.info("Recomputed the best efforts of activity {}", activity_id)
    return len(activity_ids)
