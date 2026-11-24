"""Run the account integration scenario in an isolated process and database."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth import COOKIE_NAME, User, password_hash, reset_password
from app.database import engine
from app.main import fastapi_app


def create_test_users():
    with Session(engine) as session:
        for username in ("alice", "bob"):
            session.add(
                User(username=username, hashed_password=password_hash.hash("correct-horse-battery"))
            )
        session.commit()


origin = {"Origin": "http://localhost:5173"}
with TestClient(fastapi_app, base_url="http://localhost:5173") as client:
    create_test_users()
    assert client.get("/api/activities").status_code == 401
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/health").status_code == 200

    def login(username, password="correct-horse-battery"):
        response = client.post(
            "/api/auth/login",
            json={"username": username, "password": password},
            headers=origin,
        )
        assert response.status_code == 204, response.text
        return client.cookies.get(COOKIE_NAME)

    def use_token(token):
        client.cookies.clear()
        client.cookies.set(COOKIE_NAME, token, domain="localhost.local", path="/")

    alice = login("alice")
    assert client.get("/api/auth/me").json() == {"username": "alice"}
    friend = client.post("/api/friends", json={"name": "Eve"}, headers=origin).json()
    activity = {
        "name": "Alice's run",
        "date": "2026-01-01T10:00:00",
        "duration_seconds": 60,
        "friend_ids": [friend["id"]],
    }
    response = client.post("/api/activities", json=activity, headers=origin)
    assert response.status_code == 201, response.text
    activity_id = response.json()["id"]
    detail = client.get(f"/api/activities/{activity_id}/detail").json()
    assert [f["name"] for f in detail["friends"]] == ["Eve"]
    race = {"official_time_seconds": 59, "splits": [{"label": "Run", "duration_seconds": 59}]}
    assert (
        client.put(
            f"/api/activities/{activity_id}/race-result", json=race, headers=origin
        ).status_code
        == 200
    )
    assert len(client.get("/api/races").json()) == 1

    client.cookies.clear()
    bob = login("bob")
    assert client.get("/api/activities").json() == []
    assert client.get("/api/races").json() == []
    assert client.get("/api/friends").json() == []
    assert client.get(f"/api/activities/{activity_id}").status_code == 404
    assert client.get(f"/api/activities/{activity_id}/detail").status_code == 404
    assert (
        client.patch(
            f"/api/activities/{activity_id}", json={"name": "stolen"}, headers=origin
        ).status_code
        == 404
    )
    assert client.delete(f"/api/activities/{activity_id}", headers=origin).status_code == 404
    assert (
        client.put(
            f"/api/activities/{activity_id}/race-result", json=race, headers=origin
        ).status_code
        == 404
    )
    assert client.get(f"/api/activities/{activity_id}/laps").json() == []
    bob_activity = client.post(
        "/api/activities", json={**activity, "friend_ids": []}, headers=origin
    ).json()
    # Alice's friend cannot be attached to Bob's activity
    assert (
        client.put(
            f"/api/activities/{bob_activity['id']}/friends/{friend['id']}", headers=origin
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/activities", json=activity, headers={"Origin": "https://evil.example"}
        ).status_code
        == 403
    )

    use_token(alice)
    assert [row["name"] for row in client.get("/api/activities").json()] == ["Alice's run"]
    assert client.delete(f"/api/activities/{activity_id}", headers=origin).status_code == 204
    assert client.get("/api/races").json() == []
    assert client.post("/api/auth/logout", headers=origin).status_code == 204
    use_token(alice)
    assert client.get("/api/activities").status_code == 401
    use_token(bob)
    assert client.get("/api/activities").status_code == 200

    def register(username, password="correct-horse-battery"):
        client.cookies.clear()
        return client.post(
            "/api/auth/register",
            json={"username": username, "password": password},
            headers=origin,
        )

    response = register(" Carol ")
    assert response.status_code == 201, response.text
    assert response.json() == {"username": "carol"}
    assert client.get("/api/activities").json() == []
    assert register("CAROL").json()["detail"] == "Username is already taken"
    assert register("ab").status_code == 400
    assert register("carol@example.com").status_code == 400
    assert register("dave", "too-short").status_code == 400
    assert (
        client.post(
            "/api/auth/login",
            json={"username": "carol", "password": "wrong-horse-battery"},
            headers=origin,
        ).status_code
        == 400
    )
    carol = login("Carol")
    new_password = reset_password("carol")
    use_token(carol)
    assert client.get("/api/activities").status_code == 401
    client.cookies.clear()
    assert (
        client.post(
            "/api/auth/login",
            json={"username": "carol", "password": "correct-horse-battery"},
            headers=origin,
        ).status_code
        == 400
    )
    login("carol", new_password)
    assert client.get("/api/activities").status_code == 200

    # Password guessing is cut off: after too many failures even the right password is refused
    # until the window passes, and the refusal comes before any password hashing.
    from app import rate_limit

    client.cookies.clear()

    def login_status(username, password):
        return client.post(
            "/api/auth/login", json={"username": username, "password": password}, headers=origin
        )

    for _ in range(rate_limit.FAILED_LOGINS_PER_USERNAME):
        assert login_status("bob", "wrong-horse-battery").status_code == 400
    blocked = login_status("bob", "correct-horse-battery")
    assert blocked.status_code == 429, blocked.text
    assert int(blocked.headers["Retry-After"]) > 0
    rate_limit.reset_all()
    assert login_status("bob", "correct-horse-battery").status_code == 204
    # A successful login clears the username's failures
    for _ in range(rate_limit.FAILED_LOGINS_PER_USERNAME - 1):
        login_status("bob", "wrong-horse-battery")
    assert login_status("bob", "correct-horse-battery").status_code == 204
    assert login_status("bob", "wrong-horse-battery").status_code == 400
    assert login_status("bob", "correct-horse-battery").status_code == 204

    # Registrations from one address are capped
    rate_limit.reset_all()
    for index in range(rate_limit.REGISTRATIONS_PER_IP):
        assert register(f"user{index}").status_code == 201
    assert register("one-too-many").status_code == 429
