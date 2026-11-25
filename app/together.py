"""Activities done together with a friend: suggestions for the account to confirm.

Only friends linked to their own Kinetic account can be matched, and only while the friendship
is mutual (both accounts have the other as a linked friend). An activity of this account and
one of the friend's match when they start within ``MAX_START_GAP`` of each other in the same
kind of sport, and at the same place: their routes start within ``MAX_START_DISTANCE_M`` when
both have GPS, or else they overlap for most of their time. Nothing is tagged until the account
confirms; a suggestion answered with "not together" is not made again.

The friend's activities are read only to find these matches; a suggestion names the friend and
this account's own activity, nothing of the friend's.
"""

import json
import math
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, col, select

from app.database import engine
from app.models import Activity, ActivityFriend, Friend, SportType, TogetherDismissal
from app.ownership import UserSession, current_owner

router = APIRouter()

MAX_START_GAP = timedelta(minutes=10)
MAX_START_DISTANCE_M = 500.0
# Without GPS on both sides, the activities must overlap for this share of the shorter one
MIN_OVERLAP = 0.6
# How far back to look for activities done together
LOOKBACK = timedelta(days=180)

# Sports that count as the same activity when done together
_FAMILY = {
    SportType.trail_running: SportType.running,
    SportType.walking: SportType.hiking,
}


class _Candidate:
    """The few fields of an activity matching needs."""

    def __init__(self, row) -> None:
        self.id: int = row.id
        self.owner_id: str = row.owner_id
        self.name: str = row.name
        self.date: datetime = row.date
        self.sport: SportType = row.sport
        self.duration = float(row.duration_seconds or 0)
        self.start = _route_start(row.map_route_json)

    @property
    def family(self) -> SportType:
        return _FAMILY.get(self.sport, self.sport)

    @property
    def end(self) -> datetime:
        return self.date + timedelta(seconds=self.duration)


def _route_start(map_route_json: Optional[str]) -> Optional[tuple[float, float]]:
    try:
        coords = json.loads(map_route_json) if map_route_json else None
        lat, lon = coords[0][0], coords[0][1]
        return float(lat), float(lon)
    except (ValueError, TypeError, IndexError, KeyError):
        return None


def _metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def together(mine: _Candidate, theirs: _Candidate) -> bool:
    """Whether two activities of different accounts were most likely done together."""
    if mine.family != theirs.family or abs(mine.date - theirs.date) > MAX_START_GAP:
        return False
    if mine.start and theirs.start:
        return _metres(mine.start, theirs.start) <= MAX_START_DISTANCE_M
    shorter = min(mine.duration, theirs.duration)
    if shorter <= 0:
        return False
    overlap = (min(mine.end, theirs.end) - max(mine.date, theirs.date)).total_seconds()
    return overlap / shorter >= MIN_OVERLAP


def _candidates(session: Session, owner_ids: list[str], since: datetime) -> list[_Candidate]:
    rows = session.exec(
        select(
            Activity.id,
            Activity.owner_id,
            Activity.name,
            Activity.date,
            Activity.sport,
            Activity.duration_seconds,
            Activity.map_route_json,
        ).where(
            col(Activity.owner_id).in_(owner_ids),
            col(Activity.parent_id).is_(None),
            col(Activity.date) >= since,
        )
    ).all()
    return [_Candidate(row) for row in rows]


def suggestions(owner_id: str, now: Optional[datetime] = None) -> list[dict]:
    """Activities of the account probably done with a linked friend who is not tagged yet,
    newest first."""
    since = (now or datetime.now(timezone.utc)).replace(tzinfo=None) - LOOKBACK
    with Session(engine) as session:
        linked = session.exec(
            select(Friend).where(Friend.owner_id == owner_id, col(Friend.user_id).is_not(None))
        ).all()
        # Only mutual friendships: the other account has this one as a linked friend too
        mutual_users = set(
            session.exec(
                select(Friend.owner_id).where(
                    col(Friend.owner_id).in_([f.user_id for f in linked]),
                    Friend.user_id == owner_id,
                )
            ).all()
        )
        friends = [f for f in linked if f.user_id in mutual_users]
        if not friends:
            return []

        mine = _candidates(session, [owner_id], since)
        theirs: dict[str, list[_Candidate]] = {}
        for candidate in _candidates(session, [f.user_id for f in friends], since - MAX_START_GAP):
            theirs.setdefault(candidate.owner_id, []).append(candidate)
        mine_ids = [a.id for a in mine]
        tagged = {
            (link.activity_id, link.friend_id)
            for link in session.exec(
                select(ActivityFriend).where(col(ActivityFriend.activity_id).in_(mine_ids))
            ).all()
        }
        dismissed = {
            (d.activity_id, d.friend_id)
            for d in session.exec(
                select(TogetherDismissal).where(TogetherDismissal.owner_id == owner_id)
            ).all()
        }

    found = []
    for activity in sorted(mine, key=lambda a: a.date, reverse=True):
        for friend in friends:
            key = (activity.id, friend.id)
            if key in tagged or key in dismissed:
                continue
            if any(together(activity, other) for other in theirs.get(friend.user_id, [])):
                found.append(
                    {
                        "activity": {
                            "id": activity.id,
                            "name": activity.name,
                            "date": activity.date.isoformat(),
                            "sport": activity.sport.value,
                        },
                        "friend": {"id": friend.id, "name": friend.name},
                    }
                )
    return found


# ── API ───────────────────────────────────────────────────────────────────────


class TogetherAnswer(BaseModel):
    activity_id: int
    friend_id: int


def _owner() -> str:
    owner_id = current_owner.get()
    if not owner_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return owner_id


def _check_owned(answer: TogetherAnswer) -> Activity:
    """The account's activity and friend of an answer (404 when either is not its own)."""
    with UserSession(engine) as session:
        activity = session.get(Activity, answer.activity_id)
        if activity is None:
            raise HTTPException(status_code=404, detail="Activity not found")
        if session.get(Friend, answer.friend_id) is None:
            raise HTTPException(status_code=404, detail="Friend not found")
        return activity


@router.get("/friends/together")
def list_together() -> list[dict]:
    """Activities probably done together with a linked friend, for the account to confirm."""
    return suggestions(_owner())


@router.post("/friends/together/confirm", status_code=204)
def confirm_together(answer: TogetherAnswer) -> None:
    """Tag the friend on the activity, and on its multisport legs."""
    _check_owned(answer)
    with UserSession(engine) as session:
        ids = [answer.activity_id] + list(
            session.exec(select(Activity.id).where(Activity.parent_id == answer.activity_id)).all()
        )
        for activity_id in ids:
            if not session.get(ActivityFriend, (activity_id, answer.friend_id)):
                session.add(ActivityFriend(activity_id=activity_id, friend_id=answer.friend_id))
        session.commit()


@router.post("/friends/together/dismiss", status_code=204)
def dismiss_together(answer: TogetherAnswer) -> None:
    """Do not suggest this friend for this activity again."""
    owner_id = _owner()
    _check_owned(answer)
    key = (owner_id, answer.activity_id, answer.friend_id)
    with Session(engine) as session:
        if session.get(TogetherDismissal, key) is None:
            session.add(
                TogetherDismissal(
                    owner_id=owner_id, activity_id=answer.activity_id, friend_id=answer.friend_id
                )
            )
            session.commit()
