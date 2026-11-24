"""Race results of an activity, the race list and multisport events with their legs."""

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel
from sqlmodel import col, select

from app.database import engine, require_id
from app.models import (
    Activity,
    ActivityKind,
    RaceResult,
    RaceResultSplit,
    SportType,
)
from app.ownership import UserSession as Session
from app.queries import multisport_parent_sports
from app.routes.common import (
    activity_dump,
    dump,
    fetch_activity,
)

router = APIRouter()


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


def race_result_dump(session, activity_id: int) -> Optional[dict]:
    result = session.exec(select(RaceResult).where(RaceResult.activity_id == activity_id)).first()
    if not result:
        return None
    splits = session.exec(
        select(RaceResultSplit)
        .where(RaceResultSplit.race_result_id == result.id)
        .order_by(col(RaceResultSplit.order))
    ).all()
    return {**dump(result), "splits": [dump(s) for s in splits]}


# ── Race results ──────────────────────────────────────────────────────────────


@router.put("/activities/{activity_id}/race-result")
def save_race_result(activity_id: int, data: RaceResultIn) -> dict:
    with Session(engine) as session:
        fetch_activity(session, activity_id)
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
        return race_result_dump(session, activity_id) or {}


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
    labels = [
        _LEG_LABELS.get(leg.sport.value, leg.sport.value.replace("_", " ").title()) for leg in legs
    ]
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
                segments.append(
                    {
                        "label": f"T{transitions}",
                        "kind": f"t{transitions}",
                        "seconds": round(gap, 1),
                        "distance_meters": None,
                        "activity_id": None,
                    }
                )
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
                select(Activity)
                .where(col(Activity.parent_id).in_(ids))
                .order_by(col(Activity.date))
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
                splits_by_result.setdefault(split.race_result_id, []).append(dump(split))
        return [
            {
                **dump(result),
                "activity": activity_dump(activity),
                "parent_sport": parents.get(activity.parent_id) if activity.parent_id else None,
                "splits": splits_by_result.get(result.id or -1, []),
            }
            for result, activity in results
        ]
