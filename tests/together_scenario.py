"""Suggestions of activities done together with a friend, run in an isolated process and
database."""

import json
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from sqlmodel import select

from app.account import delete_account_data
from app.auth import COOKIE_NAME, User, password_hash
from app.database import engine
from app.main import fastapi_app
from app.models import Activity, SportType, TogetherDismissal

origin = {"Origin": "http://localhost:5173"}
# Recent days, within the period suggestions look back over
DAY = (datetime.now(timezone.utc) - timedelta(days=10)).replace(
    tzinfo=None, hour=0, minute=0, second=0, microsecond=0
)


def route_from(lat: float, lon: float) -> str:
    return json.dumps([[lat + i * 1e-4, lon] for i in range(20)])


with TestClient(fastapi_app, base_url="http://localhost:5173") as client:
    users = {}
    with Session(engine) as session:
        for username in ("alice", "bob", "carol"):
            user = User(
                username=username, hashed_password=password_hash.hash("correct-horse-battery")
            )
            session.add(user)
            session.commit()
            users[username] = user.id

    tokens = {}
    for username in users:
        client.cookies.clear()
        response = client.post(
            "/api/auth/login",
            json={"username": username, "password": "correct-horse-battery"},
            headers=origin,
        )
        assert response.status_code == 204, response.text
        tokens[username] = client.cookies.get(COOKIE_NAME)

    def as_user(username):
        client.cookies.clear()
        client.cookies.set(COOKIE_NAME, tokens[username], domain="localhost.local", path="/")

    def post(path, body=None):
        return client.post(path, json=body, headers=origin)

    def add(owner, name, sport, start, minutes, route=None, parent=None):
        with Session(engine) as session:
            activity = Activity(
                owner_id=users[owner],
                name=name,
                sport=sport,
                date=start,
                duration_seconds=minutes * 60,
                route_json=route,
                parent_id=parent,
            )
            session.add(activity)
            session.commit()
            return activity.id

    def suggested(username):
        as_user(username)
        response = client.get("/api/friends/together")
        assert response.status_code == 200, response.text
        return [(s["activity"]["name"], s["friend"]["name"]) for s in response.json()]

    # No friends yet: nothing to suggest
    add(
        "alice",
        "Morning run",
        SportType.running,
        DAY + timedelta(hours=9),
        45,
        route_from(50.0, 4.0),
    )
    add(
        "bob",
        "Run with Alice",
        SportType.running,
        DAY + timedelta(hours=9, minutes=4),
        44,
        route_from(50.0015, 4.0),
    )  # ~170 m from Alice's start
    assert suggested("alice") == []

    # Alice and Bob become friends
    as_user("alice")
    request = post("/api/friend-requests", {"username": "bob"}).json()
    as_user("bob")
    assert post(f"/api/friend-requests/{request['id']}/accept", {}).status_code == 200

    day2, day3, day4 = (DAY + timedelta(days=n) for n in (1, 2, 3))
    # Same time, 30 km apart: not together
    add(
        "alice", "Solo run", SportType.running, day2 + timedelta(hours=7), 30, route_from(50.0, 4.0)
    )
    add(
        "bob",
        "Other run",
        SportType.running,
        day2 + timedelta(hours=7, minutes=1),
        30,
        route_from(50.27, 4.0),
    )
    # No GPS on either side: the rides overlap for most of their time
    ride = add("alice", "Indoor-less ride", SportType.cycling, day2 + timedelta(hours=14), 60)
    add("bob", "Ride", SportType.cycling, day2 + timedelta(hours=14, minutes=5), 55)
    # Same time and place, but a run and a ride
    add(
        "alice",
        "Track run",
        SportType.running,
        day3 + timedelta(hours=18),
        40,
        route_from(51.0, 3.0),
    )
    add(
        "bob",
        "Bike to the track",
        SportType.cycling,
        day3 + timedelta(hours=18),
        40,
        route_from(51.0, 3.0),
    )
    # A trail run and a run count as the same sport
    trail = add(
        "alice",
        "Trail",
        SportType.trail_running,
        day4 + timedelta(hours=8),
        90,
        route_from(50.5, 5.5),
    )
    add(
        "bob",
        "Hills",
        SportType.running,
        day4 + timedelta(hours=8, minutes=9),
        85,
        route_from(50.5, 5.5),
    )

    assert suggested("alice") == [
        ("Trail", "bob"),
        ("Indoor-less ride", "bob"),
        ("Morning run", "bob"),
    ], suggested("alice")
    # Bob sees the same pairs from his side
    assert [name for name, _ in suggested("bob")] == ["Hills", "Ride", "Run with Alice"]

    # Confirming tags Bob on the ride; it is no longer suggested
    as_user("alice")
    friends = {f["name"]: f["id"] for f in client.get("/api/friends").json()}
    bob_friend = friends["bob"]
    answer = {"activity_id": ride, "friend_id": bob_friend}
    assert post("/api/friends/together/confirm", answer).status_code == 204
    assert [f["name"] for f in client.get(f"/api/activities/{ride}/friends").json()] == ["bob"]
    # "Not together" for the trail run is remembered
    assert (
        post(
            "/api/friends/together/dismiss", {"activity_id": trail, "friend_id": bob_friend}
        ).status_code
        == 204
    )
    assert (
        post(
            "/api/friends/together/dismiss", {"activity_id": trail, "friend_id": bob_friend}
        ).status_code
        == 204
    )
    assert suggested("alice") == [("Morning run", "bob")]

    # Answers only work on the account's own activity and friend
    as_user("carol")
    assert post("/api/friends/together/confirm", answer).status_code == 404
    assert post("/api/friends/together/dismiss", answer).status_code == 404
    assert suggested("carol") == []

    # Once Bob removes Alice, his activities are no longer compared with hers
    as_user("bob")
    alice_friend = {f["name"]: f["id"] for f in client.get("/api/friends").json()}["alice"]
    assert client.delete(f"/api/friends/{alice_friend}", headers=origin).status_code == 204
    assert suggested("alice") == []

    # Deleting Alice's account removes her answers too
    delete_account_data(users["alice"])
    with Session(engine) as session:
        assert session.execute(select(TogetherDismissal)).all() == []

print("together scenario passed")
