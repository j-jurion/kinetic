"""Deleting an account and everything that belongs to it."""

from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response
from loguru import logger
from pydantic import BaseModel, Field
from sqlalchemy import delete, or_, select, update
from sqlmodel import SQLModel

from app import garmin_sync, streams
from app.auth import (
    COOKIE_NAME,
    AccessToken,
    IntegrationToken,
    User,
    _secure_cookies,
    password_hash,
)
from app.database import engine
from app.errors import UserError

router = APIRouter(prefix="/api/auth")

CONFIRMATION_FAILED = "Password is incorrect"


class AccountDeletion(BaseModel):
    password: str = Field(max_length=1024)


def delete_account_data(user_id: str) -> int:
    """Delete the account and all of its data in one transaction; returns the activity count.

    Removes its activities with their laps, best efforts, metrics, race results and friend
    tags; its friends and friend requests; its sessions and integration tokens; its uploaded
    FIT files and its stored Garmin tokens. Other accounts that had this account as a linked
    friend keep their friend record, as an unlinked one.
    """
    tables = SQLModel.metadata.tables
    activity, friend = tables["activity"], tables["friend"]
    race, split = tables["raceresult"], tables["raceresultsplit"]
    activity_friend = tables["activityfriend"]

    with garmin_sync.no_sync_running(user_id), engine.begin() as conn:
        fit_paths = [
            path
            for (stored,) in conn.execute(
                select(activity.c.fit_file_path).where(activity.c.owner_id == user_id)
            )
            if (path := streams.fit_path_for(stored)) is not None
        ]
        activity_ids = select(activity.c.id).where(activity.c.owner_id == user_id)
        friend_ids = select(friend.c.id).where(friend.c.owner_id == user_id)
        race_ids = select(race.c.id).where(race.c.activity_id.in_(activity_ids))
        count = len(conn.execute(activity_ids).all())

        conn.execute(delete(split).where(split.c.race_result_id.in_(race_ids)))
        conn.execute(delete(race).where(race.c.activity_id.in_(activity_ids)))
        for name in ("lap", "besteffort", "activitymetrics"):
            table = tables[name]
            conn.execute(delete(table).where(table.c.activity_id.in_(activity_ids)))
        conn.execute(
            delete(activity_friend).where(
                or_(
                    activity_friend.c.activity_id.in_(activity_ids),
                    activity_friend.c.friend_id.in_(friend_ids),
                )
            )
        )
        # Multisport legs point at their parent, so they go first
        conn.execute(
            delete(activity).where(
                activity.c.owner_id == user_id, activity.c.parent_id.is_not(None)
            )
        )
        conn.execute(delete(activity).where(activity.c.owner_id == user_id))
        conn.execute(delete(friend).where(friend.c.owner_id == user_id))
        conn.execute(update(friend).where(friend.c.user_id == user_id).values(user_id=None))
        requests = tables["friendrequest"]
        conn.execute(
            delete(requests).where(
                or_(requests.c.from_user_id == user_id, requests.c.to_user_id == user_id)
            )
        )
        conn.execute(delete(IntegrationToken).where(IntegrationToken.user_id == user_id))
        conn.execute(delete(AccessToken).where(AccessToken.user_id == user_id))
        conn.execute(delete(User).where(User.id == user_id))

    # Files go only once the database no longer refers to them
    for path in fit_paths:
        _remove(path)
    garmin_sync.forget_account(user_id)
    from app.routes.garmin import forget_pending_mfa

    forget_pending_mfa(user_id)
    return count


def _remove(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError as exc:
        logger.warning("Could not delete {} of a deleted account: {}", path.name, exc)


@router.post("/delete-account", status_code=204)
def delete_account(data: AccountDeletion, request: Request, response: Response) -> None:
    """Permanently delete the signed-in account. The password is asked again to confirm."""
    owner_id = request.scope.get("state", {}).get("owner_id")
    if owner_id is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    with engine.connect() as conn:
        hashed = conn.execute(select(User.hashed_password).where(User.id == owner_id)).scalar()
    if hashed is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not password_hash.verify(data.password, hashed):
        raise HTTPException(status_code=400, detail=CONFIRMATION_FAILED)
    try:
        count = delete_account_data(owner_id)
    except UserError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    logger.info("Deleted account {} with {} activities", owner_id, count)
    response.delete_cookie(COOKIE_NAME, httponly=True, secure=_secure_cookies(), samesite="strict")
