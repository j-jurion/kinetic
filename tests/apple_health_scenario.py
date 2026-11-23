"""Run the Apple Health webhook scenario in an isolated process and database."""

from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth import COOKIE_NAME, User, password_hash
from app.database import engine
from app.main import fastapi_app
from tests.apple_health_samples import START, outdoor_run, treadmill_run

WEBHOOK = "/api/integrations/apple-health/webhook"
origin = {"Origin": "http://localhost:5173"}
payload = {"data": {"metrics": [], "workouts": [outdoor_run()]}}

with TestClient(fastapi_app, base_url="http://localhost:5173") as client:
    with Session(engine) as session:
        for username in ("alice", "bob"):
            session.add(
                User(username=username, hashed_password=password_hash.hash("correct-horse-battery"))
            )
        session.commit()

    def login(username):
        client.cookies.clear()
        response = client.post(
            "/api/auth/login",
            json={"username": username, "password": "correct-horse-battery"},
            headers=origin,
        )
        assert response.status_code == 204, response.text

    def bearer(token):
        return {"Authorization": f"Bearer {token}"}

    # No token, a wrong token, or only a browser session: refused
    assert client.post(WEBHOOK, json=payload).status_code == 401
    assert client.post(WEBHOOK, json=payload, headers=bearer("nope")).status_code == 401
    login("alice")
    assert client.post(WEBHOOK, json=payload, headers=origin).status_code == 401

    assert client.get("/api/integrations/apple-health").json() == {"token": None}
    created = client.post("/api/integrations/apple-health/token", headers=origin).json()
    alice_token = created["token"]
    assert created["webhook_path"] == WEBHOOK
    info = client.get("/api/integrations/apple-health").json()["token"]
    assert info["last_used_at"] is None

    # The app posts without cookies or Origin
    client.cookies.clear()
    response = client.post(WEBHOOK, json=payload, headers=bearer(alice_token))
    assert response.status_code == 200, response.text
    assert len(response.json()["imported"]) == 1
    again = client.post(WEBHOOK, json=payload, headers=bearer(alice_token)).json()
    assert again["skipped"] == 1 and again["imported"] == []
    assert client.post(WEBHOOK, content=b"not json", headers=bearer(alice_token)).status_code == 400
    assert client.post(WEBHOOK, json={"data": "x"}, headers=bearer(alice_token)).status_code == 400
    # Metrics-only payloads (no workouts) are fine
    empty = client.post(WEBHOOK, json={"data": {"metrics": []}}, headers=bearer(alice_token))
    assert empty.status_code == 200 and empty.json()["imported"] == []
    # The token only opens the webhook, nothing else
    assert client.get("/api/activities", headers=bearer(alice_token)).status_code == 401

    login("alice")
    activities = client.get("/api/activities").json()
    assert [a["name"][:11] for a in activities] == ["Outdoor Run"], activities
    assert client.get("/api/integrations/apple-health").json()["token"]["last_used_at"]
    assert client.get(f"/api/activities/{activities[0]['id']}/streams").status_code == 200

    # The browser import endpoint uses the session and the usual Origin check
    browser_payload = {"data": {"workouts": [treadmill_run(START + timedelta(days=1))]}}
    assert (
        client.post("/api/integrations/apple-health/import", json=browser_payload).status_code
        == 403
    )
    response = client.post(
        "/api/integrations/apple-health/import", json=browser_payload, headers=origin
    )
    assert response.status_code == 200 and len(response.json()["imported"]) == 1, response.text

    # Bob's token writes to Bob only
    login("bob")
    bob_token = client.post("/api/integrations/apple-health/token", headers=origin).json()["token"]
    client.cookies.clear()
    response = client.post(WEBHOOK, json=payload, headers=bearer(bob_token))
    assert len(response.json()["imported"]) == 1
    login("bob")
    assert len(client.get("/api/activities").json()) == 1
    login("alice")
    assert len(client.get("/api/activities").json()) == 2

    # A new token replaces the old one; revoking disables it
    response = client.post("/api/integrations/apple-health/token", headers=origin)
    replacement = response.json()["token"]
    assert client.post(WEBHOOK, json=payload, headers=bearer(alice_token)).status_code == 401
    assert client.post(WEBHOOK, json=payload, headers=bearer(replacement)).status_code == 200
    assert client.delete("/api/integrations/apple-health/token", headers=origin).status_code == 204
    assert client.post(WEBHOOK, json=payload, headers=bearer(replacement)).status_code == 401
    assert client.cookies.get(COOKIE_NAME)

print("ok")
