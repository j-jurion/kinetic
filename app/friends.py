"""Friends: people an account trains with, and friend requests between accounts.

A friend is a record owned by one account. It can stand on its own (someone without the app)
or be linked to another Kinetic account. Linking happens only through a friend request that
the other account accepts; accepting links (or creates) a friend on both sides.

Friend records are read and written through the account-scoped ``UserSession``. Requests and
linking involve two accounts, so they use a plain session and check every account explicitly.
"""

from datetime import datetime, timezone
from typing import Iterable, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy import select as sa_select
from sqlmodel import Session, col, select

from app.auth import User, normalize_username
from app.database import engine, require_id
from app.models import Activity, ActivityFriend, Friend, FriendRequest, FriendRequestStatus
from app.ownership import UserSession, current_owner

router = APIRouter()

SEARCH_MIN_CHARS = 2
SEARCH_LIMIT = 10


# ── Helpers ───────────────────────────────────────────────────────────────────


def _owner() -> str:
    owner_id = current_owner.get()
    if not owner_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return owner_id


def _usernames(user_ids: Iterable[Optional[str]]) -> dict[str, str]:
    ids = {user_id for user_id in user_ids if user_id}
    if not ids:
        return {}
    with Session(engine) as session:
        rows = session.execute(sa_select(User.id, User.username).where(User.id.in_(ids))).all()
    return {row.id: row.username for row in rows}


def friend_rows(friends: list[Friend]) -> list[dict]:
    """Friends as returned by the API: the linked account's username instead of its id."""
    usernames = _usernames(f.user_id for f in friends)
    rows = []
    for friend in friends:
        data = friend.model_dump(mode="json", exclude={"user_id", "owner_id"})
        data["username"] = usernames.get(friend.user_id) if friend.user_id else None
        rows.append(data)
    return rows


def _active_user(session: Session, username: str) -> User:
    user = session.scalar(sa_select(User).where(User.username == normalize_username(username)))
    if user is None or not user.is_active:
        raise HTTPException(status_code=404, detail=f"No user named {username.strip()!r}")
    return user


def _linked_friend(session: Session, owner_id: str, user_id: str) -> Optional[Friend]:
    return session.exec(
        select(Friend).where(Friend.owner_id == owner_id, Friend.user_id == user_id)
    ).first()


def _pending(session: Session, from_user_id: str, to_user_id: str) -> Optional[FriendRequest]:
    return session.exec(
        select(FriendRequest).where(
            FriendRequest.from_user_id == from_user_id,
            FriendRequest.to_user_id == to_user_id,
            FriendRequest.status == FriendRequestStatus.pending,
        )
    ).first()


def _link(
    session: Session, owner_id: str, user: User, preferred_friend_id: Optional[int]
) -> Friend:
    """The owner's friend for ``user``: already linked, a friend to link, or a new one."""
    existing = _linked_friend(session, owner_id, user.id)
    if existing:
        return existing
    if preferred_friend_id is not None:
        friend = session.get(Friend, preferred_friend_id)
        if friend and friend.owner_id == owner_id and friend.user_id is None:
            friend.user_id = user.id
            session.add(friend)
            return friend
    friend = Friend(owner_id=owner_id, name=user.username, user_id=user.id)
    session.add(friend)
    return friend


def _accept(session: Session, request: FriendRequest, friend_id: Optional[int]) -> Friend:
    """Accept a pending request as its recipient and return the recipient's new friend."""
    requester = session.get(User, request.from_user_id)
    recipient = session.get(User, request.to_user_id)
    if requester is None or recipient is None or not requester.is_active:
        raise HTTPException(status_code=404, detail="Friend request not found")
    _link(session, request.from_user_id, recipient, request.from_friend_id)
    friend = _link(session, request.to_user_id, requester, friend_id)
    request.status = FriendRequestStatus.accepted
    request.responded_at = datetime.now(timezone.utc)
    session.add(request)
    # A request the other way round is answered by this one too
    reverse = _pending(session, request.to_user_id, request.from_user_id)
    if reverse:
        reverse.status = FriendRequestStatus.accepted
        reverse.responded_at = request.responded_at
        session.add(reverse)
    session.commit()
    session.refresh(friend)
    return friend


def _request_for(session: Session, request_id: int, owner_id: str, as_recipient: bool):
    request = session.get(FriendRequest, request_id)
    expected = request and (request.to_user_id if as_recipient else request.from_user_id)
    if not request or expected != owner_id or request.status != FriendRequestStatus.pending:
        raise HTTPException(status_code=404, detail="Friend request not found")
    return request


# ── Request bodies ────────────────────────────────────────────────────────────


class FriendCreate(BaseModel):
    name: str = Field(max_length=100)
    email: Optional[str] = Field(default=None, max_length=254)


class FriendUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=100)
    email: Optional[str] = Field(default=None, max_length=254)


class FriendRequestCreate(BaseModel):
    username: str = Field(max_length=64)
    # A friend without an account to link to this user once they accept
    friend_id: Optional[int] = None


class FriendRequestAccept(BaseModel):
    # A friend without an account to link to the requester, instead of adding a new friend
    friend_id: Optional[int] = None


# ── Friends ───────────────────────────────────────────────────────────────────


@router.get("/friends")
def list_friends() -> list[dict]:
    with UserSession(engine) as session:
        friends = list(session.exec(select(Friend).order_by(func.lower(Friend.name))).all())
        # Activities together, counting a multisport activity once (not once per leg)
        stats = {
            row[0]: (row[1], row[2])
            for row in session.exec(
                select(ActivityFriend.friend_id, func.count(), func.max(Activity.date))
                .join(Activity, col(Activity.id) == col(ActivityFriend.activity_id))
                .where(col(Activity.parent_id).is_(None))
                .group_by(col(ActivityFriend.friend_id))
            ).all()
        }
    rows = friend_rows(friends)
    for row in rows:
        count, last = stats.get(row["id"], (0, None))
        row["activity_count"] = count
        row["last_activity_date"] = last.isoformat() if last else None
    return rows


@router.get("/friends/{friend_id}")
def get_friend(friend_id: int) -> dict:
    with UserSession(engine) as session:
        friend = session.get(Friend, friend_id)
        if not friend:
            raise HTTPException(status_code=404, detail="Friend not found")
        return friend_rows([friend])[0]


@router.post("/friends", status_code=201)
def create_friend(data: FriendCreate) -> dict:
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    with UserSession(engine) as session:
        friend = Friend(name=name, email=(data.email or "").strip() or None)
        session.add(friend)
        session.commit()
        session.refresh(friend)
        return friend_rows([friend])[0]


@router.patch("/friends/{friend_id}")
def update_friend(friend_id: int, data: FriendUpdate) -> dict:
    with UserSession(engine) as session:
        friend = session.get(Friend, friend_id)
        if not friend:
            raise HTTPException(status_code=404, detail="Friend not found")
        if data.name is not None:
            name = data.name.strip()
            if not name:
                raise HTTPException(status_code=400, detail="Name is required")
            friend.name = name
        if "email" in data.model_fields_set:
            friend.email = (data.email or "").strip() or None
        session.add(friend)
        session.commit()
        session.refresh(friend)
        return friend_rows([friend])[0]


@router.delete("/friends/{friend_id}", status_code=204)
def delete_friend(friend_id: int) -> None:
    """Remove a friend from this account. The other account keeps its own friend record."""
    with UserSession(engine) as session:
        friend = session.get(Friend, friend_id)
        if not friend:
            raise HTTPException(status_code=404, detail="Friend not found")
        for link in session.exec(
            select(ActivityFriend).where(ActivityFriend.friend_id == friend_id)
        ).all():
            session.delete(link)
        session.flush()
        session.delete(friend)
        session.commit()


# ── Finding other accounts ────────────────────────────────────────────────────


@router.get("/users/search")
def search_users(q: str = "") -> list[dict]:
    """Accounts whose username contains ``q``, with how each relates to this account."""
    owner_id = _owner()
    query = normalize_username(q)
    if len(query) < SEARCH_MIN_CHARS:
        return []
    pattern = "%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    with Session(engine) as session:
        users = session.execute(
            sa_select(User.id, User.username)
            .where(
                User.username.like(pattern, escape="\\"),
                User.id != owner_id,
                User.is_active.is_(True),
            )
            # Exact and prefix matches first
            .order_by((User.username != query), ~User.username.startswith(query), User.username)
            .limit(SEARCH_LIMIT)
        ).all()
        ids = [user.id for user in users]
        linked = set(
            session.exec(
                select(Friend.user_id).where(
                    Friend.owner_id == owner_id, col(Friend.user_id).in_(ids)
                )
            ).all()
        )
        pending = session.exec(
            select(FriendRequest).where(
                FriendRequest.status == FriendRequestStatus.pending,
                or_(
                    (col(FriendRequest.from_user_id) == owner_id)
                    & col(FriendRequest.to_user_id).in_(ids),
                    (col(FriendRequest.to_user_id) == owner_id)
                    & col(FriendRequest.from_user_id).in_(ids),
                ),
            )
        ).all()
    outgoing = {r.to_user_id: r.id for r in pending if r.from_user_id == owner_id}
    incoming = {r.from_user_id: r.id for r in pending if r.to_user_id == owner_id}
    rows = []
    for user in users:
        if user.id in linked:
            status, request_id = "friend", None
        elif user.id in incoming:
            status, request_id = "incoming", incoming[user.id]
        elif user.id in outgoing:
            status, request_id = "outgoing", outgoing[user.id]
        else:
            status, request_id = "none", None
        rows.append({"username": user.username, "status": status, "request_id": request_id})
    return rows


# ── Friend requests ───────────────────────────────────────────────────────────


@router.get("/friend-requests")
def list_friend_requests() -> dict:
    owner_id = _owner()
    with Session(engine) as session:
        pending = session.exec(
            select(FriendRequest)
            .where(
                FriendRequest.status == FriendRequestStatus.pending,
                or_(
                    col(FriendRequest.from_user_id) == owner_id,
                    col(FriendRequest.to_user_id) == owner_id,
                ),
            )
            .order_by(col(FriendRequest.created_at).desc())
        ).all()
    usernames = _usernames(
        r.to_user_id if r.from_user_id == owner_id else r.from_user_id for r in pending
    )

    def row(request: FriendRequest, other: str) -> Optional[dict]:
        username = usernames.get(other)
        if username is None:
            return None
        return {
            "id": request.id,
            "username": username,
            "created_at": request.created_at.isoformat(),
            "friend_id": request.from_friend_id if request.from_user_id == owner_id else None,
        }

    incoming = [row(r, r.from_user_id) for r in pending if r.to_user_id == owner_id]
    outgoing = [row(r, r.to_user_id) for r in pending if r.from_user_id == owner_id]
    return {
        "incoming": [r for r in incoming if r],
        "outgoing": [r for r in outgoing if r],
    }


@router.get("/friend-requests/count")
def count_friend_requests() -> dict:
    """The number of requests waiting for this account's answer (for the navigation badge)."""
    owner_id = _owner()
    with Session(engine) as session:
        count = session.exec(
            select(func.count())
            .select_from(FriendRequest)
            .join(User, User.id == FriendRequest.from_user_id)  # type: ignore[arg-type]
            .where(
                FriendRequest.to_user_id == owner_id,
                FriendRequest.status == FriendRequestStatus.pending,
                User.is_active.is_(True),
            )
        ).one()
    return {"incoming": count}


@router.post("/friend-requests", status_code=201)
def send_friend_request(data: FriendRequestCreate) -> dict:
    owner_id = _owner()
    with Session(engine) as session:
        user = _active_user(session, data.username)
        if user.id == owner_id:
            raise HTTPException(status_code=400, detail="You cannot add yourself as a friend")
        if data.friend_id is not None:
            friend = session.get(Friend, data.friend_id)
            if not friend or friend.owner_id != owner_id:
                raise HTTPException(status_code=404, detail="Friend not found")
            if friend.user_id is not None:
                raise HTTPException(status_code=400, detail="This friend is already linked")
        if _linked_friend(session, owner_id, user.id):
            raise HTTPException(
                status_code=400, detail=f"You are already friends with {user.username}"
            )
        # They already asked: sending one back accepts theirs
        incoming = _pending(session, user.id, owner_id)
        if incoming:
            friend = _accept(session, incoming, data.friend_id)
            return {"status": "accepted", "friend": friend_rows([friend])[0]}
        existing = _pending(session, owner_id, user.id)
        if existing:
            if data.friend_id is not None and existing.from_friend_id != data.friend_id:
                existing.from_friend_id = data.friend_id
                session.add(existing)
                session.commit()
            return {"status": "pending", "id": existing.id, "username": user.username}
        request = FriendRequest(
            from_user_id=owner_id, to_user_id=user.id, from_friend_id=data.friend_id
        )
        session.add(request)
        session.commit()
        session.refresh(request)
        return {"status": "pending", "id": require_id(request.id), "username": user.username}


@router.post("/friend-requests/{request_id}/accept")
def accept_friend_request(request_id: int, data: Optional[FriendRequestAccept] = None) -> dict:
    owner_id = _owner()
    with Session(engine) as session:
        request = _request_for(session, request_id, owner_id, as_recipient=True)
        friend = _accept(session, request, data.friend_id if data else None)
        return friend_rows([friend])[0]


@router.post("/friend-requests/{request_id}/decline", status_code=204)
def decline_friend_request(request_id: int) -> None:
    owner_id = _owner()
    with Session(engine) as session:
        request = _request_for(session, request_id, owner_id, as_recipient=True)
        request.status = FriendRequestStatus.declined
        request.responded_at = datetime.now(timezone.utc)
        session.add(request)
        session.commit()


@router.delete("/friend-requests/{request_id}", status_code=204)
def cancel_friend_request(request_id: int) -> None:
    owner_id = _owner()
    with Session(engine) as session:
        request = _request_for(session, request_id, owner_id, as_recipient=False)
        session.delete(request)
        session.commit()
