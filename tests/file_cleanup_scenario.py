"""Deleting activities removes their FIT files and cached streams once nothing uses them,
run in an isolated process and database (see test_account_integration.py)."""

from datetime import datetime
from pathlib import Path

from fastapi.testclient import TestClient
from sqlmodel import Session

from app import streams
from app.auth import User, password_hash
from app.database import engine
from app.main import fastapi_app
from app.models import Activity, SportType
from tests.fit_samples import write_sample_run

origin = {"Origin": "http://localhost:5173"}
uploads = Path("uploads")
uploads.mkdir(exist_ok=True)

with TestClient(fastapi_app, base_url="http://localhost:5173") as client:
    with Session(engine) as session:
        users = {}
        for name in ("alice", "bob"):
            user = User(username=name, hashed_password=password_hash.hash("correct-horse-battery"))
            session.add(user)
            session.commit()
            users[name] = user.id

    def add(owner, name, fit=None, sport=SportType.running, parent_id=None):
        with Session(engine) as session:
            activity = Activity(
                owner_id=users[owner],
                name=name,
                sport=sport,
                parent_id=parent_id,
                date=datetime(2026, 1, 1, 7),
                duration_seconds=1800,
                fit_file_path=str(fit) if fit else None,
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

    def delete(activity_id):
        response = client.delete(f"/api/activities/{activity_id}", headers=origin)
        assert response.status_code == 204, response.text

    login("alice")

    # A single activity: its FIT file and its cached streams go with it
    run_fit = write_sample_run(uploads / "run.fit")
    run = add("alice", "Run", run_fit)
    assert client.get(f"/api/activities/{run}/streams").json()["available"]
    assert len(streams.streams_cache_files(run_fit)) == 1
    delete(run)
    assert not run_fit.exists() and streams.streams_cache_files(run_fit) == []

    # A multisport event: its legs share its file, so deleting a leg keeps the file
    tri_fit = write_sample_run(uploads / "tri.fit")
    tri = add("alice", "Tri", tri_fit, SportType.triathlon)
    swim = add("alice", "Swim", tri_fit, SportType.swimming, tri)
    add("alice", "Run leg", tri_fit, SportType.running, tri)
    delete(swim)
    assert tri_fit.exists()
    delete(tri)  # the event takes its remaining legs and, now unused, the file
    assert not tri_fit.exists()

    # A file another account still refers to (a copied test account) is kept
    shared_fit = write_sample_run(uploads / "shared.fit")
    alice_copy = add("alice", "Shared", shared_fit)
    add("bob", "Shared too", shared_fit)
    delete(alice_copy)
    assert shared_fit.exists()

    # An activity without a file, and one whose file is already gone
    delete(add("alice", "Manual"))
    gone = add("alice", "Gone", uploads / "missing.fit")
    delete(gone)

    # Account deletion follows the same rule: Bob's file is used by nobody else now
    login("bob")
    response = client.post(
        "/api/auth/delete-account", headers=origin, json={"password": "correct-horse-battery"}
    )
    assert response.status_code == 204, response.text
    assert not shared_fit.exists()

print("ok")
