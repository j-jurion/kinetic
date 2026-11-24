"""Stored route shapes, the streams cache, compression and paged activity lists, run in an
isolated process and database (see test_account_integration.py)."""

import gzip
import json
import os
from datetime import datetime
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlmodel import Session

from app import streams
from app.auth import User, password_hash
from app.database import _backfill_route_shapes, engine
from app.main import fastapi_app
from app.models import Activity, SportType
from tests.fit_samples import write_sample_run

origin = {"Origin": "http://localhost:5173"}
uploads = Path(os.environ.get("KINETIC_UPLOAD_DIR", "uploads"))
uploads.mkdir(parents=True, exist_ok=True)
route = [[50.0 + i / 1000, 4.0 + i / 1000] for i in range(1000)]

with TestClient(fastapi_app, base_url="http://localhost:5173") as client:
    with Session(engine) as session:
        users = {}
        for name in ("alice", "bob"):
            user = User(username=name, hashed_password=password_hash.hash("correct-horse-battery"))
            session.add(user)
            session.commit()
            users[name] = user.id
        for day in range(1, 8):
            session.add(
                Activity(
                    owner_id=users["alice"],
                    name=f"Run {day}",
                    sport=SportType.running,
                    date=datetime(2026, 1, day, 7),
                    duration_seconds=1800,
                    distance_meters=5000,
                    elevation_gain_meters=10,
                    route_json=json.dumps(route) if day % 2 else None,
                )
            )
        tri = Activity(
            owner_id=users["alice"],
            name="Tri",
            sport=SportType.triathlon,
            date=datetime(2026, 1, 3, 9),
            duration_seconds=7200,
            distance_meters=40000,
        )
        session.add(tri)
        session.flush()
        session.add(
            Activity(
                owner_id=users["alice"],
                name="Tri run",
                sport=SportType.running,
                parent_id=tri.id,
                date=datetime(2026, 1, 3, 10),
                duration_seconds=2400,
                distance_meters=10000,
            )
        )
        session.add(
            Activity(
                owner_id=users["bob"],
                name="Bob run",
                sport=SportType.running,
                date=datetime(2026, 1, 2, 7),
                duration_seconds=999,
                distance_meters=99999,
                route_json=json.dumps(route),
            )
        )
        session.commit()

    def login(name):
        client.cookies.clear()
        response = client.post(
            "/api/auth/login",
            headers=origin,
            json={"username": name, "password": "correct-horse-battery"},
        )
        assert response.status_code == 204, response.text

    # ── Route shapes are derived when a route is saved ──
    with Session(engine) as session:
        run = session.get(Activity, 1)
        assert run.has_route and len(json.loads(run.map_route_json)) == 251
        assert not session.get(Activity, 2).has_route
        session.get(Activity, 2).route_json = json.dumps(route[:3])
        session.commit()
        assert session.get(Activity, 2).has_route
        assert json.loads(session.get(Activity, 2).map_route_json) == [
            [50.0, 4.0],
            [50.001, 4.001],
            [50.002, 4.002],
        ]

    # Lists never fetch the full route from the database
    login("alice")
    queries = []
    listener = lambda *args: queries.append(args[2])  # noqa: E731
    event.listen(engine, "before_cursor_execute", listener)
    rows = client.get("/api/activities").json()
    event.remove(engine, "before_cursor_execute", listener)
    assert not any("route_json" in q for q in queries), queries
    assert [r["has_route"] for r in rows if r["name"] == "Run 1"] == [True]
    assert all("route_json" not in r and "map_route_json" not in r for r in rows)

    # The map uses the stored light routes. Only running has routes: its 7 runs and the
    # triathlon's run leg are the candidates
    data = client.get("/api/map").json()
    assert data["counts"] == {"drawn": 5, "total": 8, "without_gps": 3}, data["counts"]
    assert all(len(r["coords"]) <= 251 for r in data["routes"])

    # Activities stored before the shapes existed are filled in once at startup
    with engine.connect() as conn:  # like create_db_and_tables: commits as it goes
        conn.exec_driver_sql("UPDATE activity SET has_route = FALSE, map_route_json = NULL")
        conn.commit()
        assert _backfill_route_shapes(conn, batch=2) == 6
        assert _backfill_route_shapes(conn) == 0
    assert client.get("/api/map").json()["counts"]["drawn"] == 5

    # ── Paged activity list and its totals ──
    everything = client.get("/api/activities").json()
    assert [r["name"] for r in everything][:3] == ["Run 7", "Run 6", "Run 5"]
    pages, before = [], None
    while True:
        query = "/api/activities?limit=3" + (f"&before={before}" if before else "")
        page = client.get(query).json()
        if not page:
            break
        pages += page
        before = f"{page[-1]['date']},{page[-1]['id']}"
    assert [r["id"] for r in pages] == [r["id"] for r in everything]
    assert [r["name"] for r in client.get("/api/activities?since=2026-01-06").json()] == [
        "Run 7",
        "Run 6",
    ]
    assert client.get("/api/activities?before=nonsense").status_code == 400
    assert client.get("/api/activities?limit=0").status_code == 422

    totals = client.get("/api/activities/totals").json()
    assert totals == {"count": 8, "meters": 75000.0, "seconds": 19800.0, "climb": 70.0}, totals
    # With a sport filter the leg is listed, and counted because its event is not
    running = client.get("/api/activities/totals?sport=running").json()
    assert running["count"] == 8 and running["meters"] == 45000.0, running
    login("bob")
    assert client.get("/api/activities/totals").json()["count"] == 1  # only Bob's own
    assert [a["name"] for a in client.get("/api/stats/graphs").json()["activities"]] == ["Bob run"]
    login("alice")
    graphs = client.get("/api/stats/graphs?sport=running").json()["activities"]
    assert [a["name"] for a in graphs][:2] == ["Run 1", "Run 2"]  # oldest first
    assert set(graphs[0]) == {
        "id",
        "name",
        "date",
        "sport",
        "kind",
        "distance_meters",
        "duration_seconds",
        "elevation_meters",
        "avg_heart_rate",
    }

    # ── Compression: JSON is gzipped, the progress streams are not ──
    login("alice")
    response = client.get("/api/map", headers={"Accept-Encoding": "gzip"})
    assert response.headers.get("content-encoding") == "gzip"
    response = client.post("/api/training/analyse", headers={**origin, "Accept-Encoding": "gzip"})
    assert response.status_code == 200 and "content-encoding" not in response.headers
    assert response.text.strip().splitlines()[-1].startswith('{"type": "result"')

    # ── Streams are cached on disk next to the FIT file ──
    fit = write_sample_run(uploads / "run.fit")
    with Session(engine) as session:
        session.get(Activity, 1).fit_file_path = str(fit)
        session.commit()
    first = client.get("/api/activities/1/streams").json()
    assert first["available"]
    cached = streams.streams_cache_files(fit)
    assert len(cached) == 1
    assert json.loads(gzip.decompress(cached[0].read_bytes()))["zones"] == first["zones"]
    assert client.get("/api/activities/1/streams").json() == first
    # Bob cannot read Alice's streams, cached or not
    login("bob")
    assert client.get("/api/activities/1/streams").status_code == 404

print("ok")
