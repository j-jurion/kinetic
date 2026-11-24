"""Deleting an account, run in an isolated process and database."""

from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import garmin_sync, streams
from app.auth import COOKIE_NAME, AccessToken, IntegrationToken, User, password_hash
from app.database import engine
from app.main import fastapi_app
from app.models import Activity, ActivityFriend, Friend, FriendRequest, Lap, RaceResult
from app.ownership import current_owner

origin = {"Origin": "http://localhost:5173"}
PASSWORD = "correct-horse-battery"

with TestClient(fastapi_app, base_url="http://localhost:5173") as client:
    with Session(engine) as session:
        for username in ("alice", "bob", "carol"):
            session.add(User(username=username, hashed_password=password_hash.hash(PASSWORD)))
        session.commit()
        ids = {u.username: u.id for u in session.scalars(select(User)).all()}

    tokens = {}
    for username in ("alice", "bob", "carol"):
        client.cookies.clear()
        response = client.post(
            "/api/auth/login", json={"username": username, "password": PASSWORD}, headers=origin
        )
        assert response.status_code == 204, response.text
        tokens[username] = client.cookies.get(COOKIE_NAME)

    def as_user(username):
        client.cookies.clear()
        client.cookies.set(COOKIE_NAME, tokens[username], domain="localhost.local", path="/")

    def post(path, body=None):
        return client.post(path, json=body, headers=origin)

    def count(model, *where):
        with Session(engine) as session:
            return session.scalar(select(func.count()).select_from(model).where(*where))

    # Alice: an activity with a FIT file, laps, a race result and a tagged friend; a linked
    # friendship with Bob, a pending request to Carol, Garmin tokens and an Apple Health token
    as_user("alice")
    friend = post("/api/friends", {"name": "Dave"}).json()
    run = post(
        "/api/activities",
        {"name": "Race", "date": "2026-01-01T10:00:00", "duration_seconds": 600,
         "friend_ids": [friend["id"]]},
    ).json()
    assert client.put(
        f"/api/activities/{run['id']}/race-result",
        json={"official_time_seconds": 600, "splits": []}, headers=origin,
    ).status_code == 200
    streams.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    fit = streams.UPLOAD_DIR / "alice-run.fit"
    fit.write_bytes(b"fit")
    with Session(engine) as session:
        activity = session.get(Activity, run["id"])
        activity.fit_file_path = str(fit)
        session.add(Lap(activity_id=run["id"], lap_number=1, duration_seconds=600))
        session.commit()
    request_id = post("/api/friend-requests", {"username": "bob"}).json()["id"]
    post("/api/friend-requests", {"username": "carol"})
    assert post("/api/integrations/apple-health/token").status_code == 200
    token = current_owner.set(ids["alice"])
    garmin_sync.save_email("alice@garmin.example")
    garmin_dir = garmin_sync._token_dir()
    current_owner.reset(token)
    as_user("bob")
    assert post(f"/api/friend-requests/{request_id}/accept").status_code == 200
    bob_run = post(
        "/api/activities",
        {"name": "Bob run", "date": "2026-01-02T10:00:00", "duration_seconds": 60},
    ).json()

    # Wrong password, a forged origin or no session: nothing is deleted
    as_user("alice")
    wrong = post("/api/auth/delete-account", {"password": "wrong-horse-battery"})
    assert wrong.status_code == 400, wrong.text
    forged = client.post(
        "/api/auth/delete-account", json={"password": PASSWORD},
        headers={"Origin": "https://evil.example"},
    )
    assert forged.status_code == 403
    client.cookies.clear()
    assert post("/api/auth/delete-account", {"password": PASSWORD}).status_code == 401
    assert count(User, User.id == ids["alice"]) == 1

    # Not while a Garmin sync of the account is running
    as_user("alice")
    garmin_sync._running_syncs.add(ids["alice"])
    busy = post("/api/auth/delete-account", {"password": PASSWORD})
    assert busy.status_code == 409, busy.text
    garmin_sync._running_syncs.discard(ids["alice"])

    deleted = post("/api/auth/delete-account", {"password": PASSWORD})
    assert deleted.status_code == 204, deleted.text
    assert COOKIE_NAME not in client.cookies

    alice = ids["alice"]
    assert count(User, User.id == alice) == 0
    assert count(AccessToken, AccessToken.user_id == alice) == 0
    assert count(IntegrationToken, IntegrationToken.user_id == alice) == 0
    assert count(Activity, Activity.owner_id == alice) == 0
    assert count(Lap) == 0
    assert count(RaceResult) == 0
    assert count(ActivityFriend) == 0
    assert count(Friend, Friend.owner_id == alice) == 0
    assert count(FriendRequest) == 0
    assert not fit.exists()
    assert not Path(garmin_dir).exists()

    # The old session no longer works and the username can be registered again
    as_user("alice")
    assert client.get("/api/auth/me").status_code == 401
    client.cookies.clear()
    assert post(
        "/api/auth/login", {"username": "alice", "password": PASSWORD}
    ).status_code == 400

    # Bob keeps his data; his friend record for Alice stays, no longer linked
    as_user("bob")
    assert [a["name"] for a in client.get("/api/activities").json()] == ["Bob run"]
    assert bob_run["id"]
    friends = client.get("/api/friends").json()
    assert [(f["name"], f["username"]) for f in friends] == [("alice", None)], friends
    as_user("carol")
    assert client.get("/api/friend-requests/count").json() == {"incoming": 0}

print("ok")
