"""Friend requests between accounts, run in an isolated process and database."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth import COOKIE_NAME, User, password_hash
from app.database import engine
from app.main import fastapi_app

origin = {"Origin": "http://localhost:5173"}

with TestClient(fastapi_app, base_url="http://localhost:5173") as client:
    with Session(engine) as session:
        for username in ("alice", "bob", "carol"):
            session.add(
                User(username=username, hashed_password=password_hash.hash("correct-horse-battery"))
            )
        session.commit()

    tokens = {}
    for username in ("alice", "bob", "carol"):
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

    # Alice has a friend without the app, tagged on an activity, who later joins as Bob
    as_user("alice")
    offline = post("/api/friends", {"name": "Bobby"}).json()
    assert offline["username"] is None
    run = post(
        "/api/activities",
        {
            "name": "Run",
            "date": "2026-01-01T10:00:00",
            "duration_seconds": 60,
            "friend_ids": [offline["id"]],
        },
    ).json()

    assert client.get("/api/users/search", params={"q": "b"}).json() == []
    assert client.get("/api/users/search", params={"q": "bo"}).json() == [
        {"username": "bob", "status": "none", "request_id": None}
    ]
    assert [u["username"] for u in client.get("/api/users/search?q=al").json()] == []
    assert post("/api/friend-requests", {"username": "alice"}).status_code == 400
    assert post("/api/friend-requests", {"username": "nobody"}).status_code == 404

    sent = post("/api/friend-requests", {"username": "Bob", "friend_id": offline["id"]})
    assert sent.status_code == 201, sent.text
    assert sent.json()["status"] == "pending"
    request_id = sent.json()["id"]
    # Sending again does not create a second request
    assert post("/api/friend-requests", {"username": "bob"}).json()["id"] == request_id
    assert client.get("/api/friend-requests/count").json() == {"incoming": 0}
    assert client.get("/api/users/search?q=bob").json()[0]["status"] == "outgoing"

    # Carol cannot see or answer the request
    as_user("carol")
    assert client.get("/api/friend-requests").json() == {"incoming": [], "outgoing": []}
    assert post(f"/api/friend-requests/{request_id}/accept").status_code == 404
    assert post(f"/api/friend-requests/{request_id}/decline").status_code == 404
    assert client.delete(f"/api/friend-requests/{request_id}", headers=origin).status_code == 404

    as_user("bob")
    assert client.get("/api/friend-requests/count").json() == {"incoming": 1}
    incoming = client.get("/api/friend-requests").json()["incoming"]
    assert [r["username"] for r in incoming] == ["alice"]
    assert client.get("/api/users/search?q=ali").json()[0]["status"] == "incoming"
    # Bob cannot cancel a request he received
    assert client.delete(f"/api/friend-requests/{request_id}", headers=origin).status_code == 404
    accepted = post(f"/api/friend-requests/{request_id}/accept")
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["username"] == "alice"
    assert client.get("/api/friend-requests/count").json() == {"incoming": 0}
    assert [(f["name"], f["username"]) for f in client.get("/api/friends").json()] == [
        ("alice", "alice")
    ]
    assert post(f"/api/friend-requests/{request_id}/accept").status_code == 404

    # Alice's existing friend is now linked to Bob and keeps the activity
    as_user("alice")
    friends = client.get("/api/friends").json()
    assert [(f["id"], f["name"], f["username"]) for f in friends] == [
        (offline["id"], "Bobby", "bob")
    ]
    assert friends[0]["activity_count"] == 1
    assert "user_id" not in friends[0]
    detail = client.get(f"/api/activities/{run['id']}/detail").json()
    assert [f["username"] for f in detail["friends"]] == ["bob"]
    assert client.get(f"/api/friends/{offline['id']}").json()["username"] == "bob"
    together = client.get("/api/activities", params={"friend": offline["id"]}).json()
    assert [a["id"] for a in together] == [run["id"]]
    other = post("/api/friends", {"name": "Nobody"}).json()
    assert client.get("/api/activities", params={"friend": other["id"]}).json() == []
    assert client.get("/api/users/search?q=bob").json()[0]["status"] == "friend"
    assert post("/api/friend-requests", {"username": "bob"}).status_code == 400

    # Renaming keeps the link; the link itself cannot be changed through the API
    renamed = client.patch(
        f"/api/friends/{offline['id']}", json={"name": "Bob B.", "user_id": "x"}, headers=origin
    ).json()
    assert (renamed["name"], renamed["username"]) == ("Bob B.", "bob")

    # Carol declines; a crossed request is accepted by sending one back
    declined = post("/api/friend-requests", {"username": "carol"}).json()
    as_user("carol")
    assert post(f"/api/friend-requests/{declined['id']}/decline").status_code == 204
    assert client.get("/api/friend-requests/count").json() == {"incoming": 0}
    as_user("bob")
    to_carol = post("/api/friend-requests", {"username": "carol"}).json()
    cancel = client.delete(f"/api/friend-requests/{to_carol['id']}", headers=origin)
    assert cancel.status_code == 204
    post("/api/friend-requests", {"username": "carol"})
    as_user("carol")
    crossed = post("/api/friend-requests", {"username": "bob"}).json()
    assert crossed["status"] == "accepted"
    assert client.get("/api/friend-requests").json() == {"incoming": [], "outgoing": []}
    as_user("bob")
    assert sorted(f["username"] for f in client.get("/api/friends").json()) == ["alice", "carol"]
    assert client.get("/api/friend-requests").json() == {"incoming": [], "outgoing": []}

print("ok")
