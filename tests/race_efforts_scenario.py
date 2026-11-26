"""Races measured slightly short count for their distance, run in an isolated process and
database (see test_account_integration.py)."""

from datetime import datetime

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.auth import User, password_hash
from app.database import engine
from app.main import fastapi_app
from app.models import Activity, ActivityKind, BestEffort, SportType

origin = {"Origin": "http://localhost:5173"}
MARATHON, TEN_K = 42195, 10000

with TestClient(fastapi_app, base_url="http://localhost:5173") as client:
    with Session(engine) as session:
        users = {}
        for name in ("alice", "bob"):
            user = User(username=name, hashed_password=password_hash.hash("correct-horse-battery"))
            session.add(user)
            session.commit()
            users[name] = user.id

    def add(
        name,
        distance,
        seconds,
        kind=ActivityKind.training,
        sport=SportType.running,
        owner="alice",
        parent_id=None,
        day=1,
    ):
        with Session(engine) as session:
            activity = Activity(
                owner_id=users[owner],
                name=name,
                sport=sport,
                kind=kind,
                parent_id=parent_id,
                date=datetime(2026, 4, day, 9),
                distance_meters=distance,
                duration_seconds=seconds,
            )
            session.add(activity)
            session.commit()
            return activity.id

    def login(name):
        client.cookies.clear()
        response = client.post(
            "/api/auth/login",
            headers=origin,
            json={"username": name, "password": "correct-horse-battery"},
        )
        assert response.status_code == 204, response.text

    def marathons():
        rows = client.get(f"/api/best-efforts/attempts?distance={MARATHON}").json()
        return [(r["activity_name"], r["duration_seconds"], r["source"]) for r in rows]

    meerdaal = add("Meerdaal marathon", 42150, 3 * 3600 + 30 * 60, ActivityKind.race, day=5)
    add("Long run", 42150, 4 * 3600)  # training: a long run is not a marathon
    add("Too short", 41300, 3 * 3600, ActivityKind.race)  # 2.1% short is too far
    login("alice")

    # A race 45 m short is a marathon, with its whole time, wherever best efforts are shown
    assert marathons() == [("Meerdaal marathon", 12600, "race")], marathons()
    row = client.get(f"/api/best-efforts/attempts?distance={MARATHON}").json()[0]
    assert row["measured_meters"] == 42150 and row["is_race"] and row["id"] == -meerdaal
    records = {
        r["distance_meters"]: r for r in client.get("/api/best-efforts/overview").json()["records"]
    }
    assert records[MARATHON]["activity_id"] == meerdaal
    assert any(e["distance_meters"] == MARATHON for e in client.get("/api/best-efforts").json())
    assert client.get(f"/api/best-efforts/attempts?distance={MARATHON}&year=2025").json() == []
    detail = client.get(f"/api/activities/{meerdaal}/detail").json()
    assert [(e["distance_meters"], e["rank"], e["source"]) for e in detail["best_efforts"]] == [
        (MARATHON, 1, "race")
    ]

    # Unmarking the race takes it away at once; a race result makes it count again
    client.patch(f"/api/activities/{meerdaal}", json={"kind": "training"}, headers=origin)
    assert marathons() == []
    saved = client.put(
        f"/api/activities/{meerdaal}/race-result",
        headers=origin,
        json={"official_time_seconds": 12590, "splits": []},
    )
    assert saved.status_code == 200, saved.text
    # ... with its official time; anything else keeps the moving time
    assert marathons() == [("Meerdaal marathon", 12590, "official")]
    detail = client.get(f"/api/activities/{meerdaal}/detail").json()
    assert detail["best_efforts"][0]["duration_seconds"] == 12590
    assert detail["activity"]["duration_seconds"] == 12600
    client.delete(f"/api/activities/{meerdaal}/race-result", headers=origin)
    assert marathons() == []
    client.patch(f"/api/activities/{meerdaal}", json={"kind": "race"}, headers=origin)

    # A faster race ranks first; the stored GPS effort of another marathon is ranked with it
    full = add("Full distance", 42300, 3 * 3600 + 40 * 60, ActivityKind.race, day=10)
    with Session(engine) as session:
        session.add(
            BestEffort(
                activity_id=full,
                sport=SportType.running,
                distance_meters=MARATHON,
                duration_seconds=3 * 3600 + 39 * 60,
                date=datetime(2026, 4, 10, 9),
                year=2026,
            )
        )
        session.commit()
    assert [(n, s) for n, _, s in marathons()] == [
        ("Meerdaal marathon", "race"),
        ("Full distance", "gps"),
    ]
    rank = client.get(f"/api/activities/{full}/detail").json()["best_efforts"][0]["rank"]
    assert rank == 2  # behind the Meerdaal race, which is not a stored effort
    # A race with a GPS effort at the distance keeps that one (no second entry)
    with Session(engine) as session:
        session.add(
            BestEffort(
                activity_id=meerdaal,
                sport=SportType.running,
                distance_meters=MARATHON,
                duration_seconds=12500,
                date=datetime(2026, 4, 5, 9),
                year=2026,
            )
        )
        session.commit()
    assert [s for n, _, s in marathons() if n == "Meerdaal marathon"] == ["gps"]

    # An official time takes the place of the GPS effort, also when GPS measured long
    result = {"official_time_seconds": 3 * 3600 + 41 * 60, "splits": []}
    client.put(f"/api/activities/{full}/race-result", headers=origin, json=result)
    assert [(n, d, s) for n, d, s in marathons() if n == "Full distance"] == [
        ("Full distance", 3 * 3600 + 41 * 60, "official")
    ]
    detail = client.get(f"/api/activities/{full}/detail").json()["best_efforts"]
    assert [(e["source"], e["rank"]) for e in detail] == [("official", 2)]
    # behind Meerdaal's GPS effort; its own GPS effort, now replaced, does not count
    # ... but not when the race is a different distance (here 5% too long)
    far = add("Long trail", 44400, 5 * 3600, ActivityKind.race, day=12)
    client.put(f"/api/activities/{far}/race-result", headers=origin, json=result)
    assert "Long trail" not in [n for n, _, _ in marathons()]

    # A triathlon's run leg counts when the event is a race
    tri = add("Olympic tri", 51400, 9000, ActivityKind.race, SportType.triathlon, day=20)
    leg = add("Run leg", 9950, 2700, sport=SportType.running, parent_id=tri, day=20)
    tens = client.get(f"/api/best-efforts/attempts?distance={TEN_K}").json()
    assert [(r["activity_id"], r["activity_name"], r["source"]) for r in tens] == [
        (leg, "Olympic tri", "race")
    ]
    client.patch(f"/api/activities/{tri}", json={"kind": "training"}, headers=origin)
    assert client.get(f"/api/best-efforts/attempts?distance={TEN_K}").json() == []

    # Another account sees none of it
    login("bob")
    assert marathons() == []

print("ok")
