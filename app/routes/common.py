"""Helpers shared by the API route modules."""

from contextvars import copy_context
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlmodel import col

from app.formatting import resolve_sports
from app.models import (
    Activity,
    SportType,
)
from app.ownership import HEAVY_COLUMNS, current_owner

# ── Helpers ───────────────────────────────────────────────────────────────────


def sport_filter(sport: Optional[str]) -> Optional[list[SportType]]:
    """Resolve a sport filter (sport, group or umbrella) into concrete sport types."""
    try:
        sports = resolve_sports(sport)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Unknown sport: {sport}") from None
    return [SportType(s) for s in sports] if sports else None


def in_year(stmt, column, year: Optional[int]):
    if year:
        stmt = stmt.where(col(column) >= datetime(year, 1, 1))
        stmt = stmt.where(col(column) < datetime(year + 1, 1, 1))
    return stmt


def dump(model) -> dict:
    return model.model_dump(mode="json")


def activity_dump(activity: Activity) -> dict:
    """An activity without its (large) GPS routes; ``has_route`` says whether it has one."""
    return activity.model_dump(mode="json", exclude=set(HEAVY_COLUMNS))


def fetch_activity(session, activity_id: int) -> Activity:
    activity = session.get(Activity, activity_id)
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    return activity


async def run_in_thread(fn, *args):
    """Run blocking work in a thread while keeping the account context."""
    from starlette.concurrency import run_in_threadpool

    context = copy_context()
    return await run_in_threadpool(context.run, fn, *args)


def current_owner_id() -> str:
    owner_id = current_owner.get()
    if not owner_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return owner_id
