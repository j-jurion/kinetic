"""Run the account integration scenario in an isolated process and database."""

import asyncio
import os
import re
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.auth import COOKIE_NAME, User, UserManager, async_sessions, get_user_db
from app.main import fastapi_app, main


async def create_test_users():
    async with async_sessions() as session:
        db = await anext(get_user_db(session))
        manager = UserManager(db)
        password_hash = manager.password_helper.hash("correct-horse-battery")
        for email in ("alice@example.com", "bob@example.com"):
            session.add(
                User(
                    email=email,
                    hashed_password=password_hash,
                    is_active=True,
                    is_verified=True,
                    is_superuser=False,
                )
            )
        await session.commit()


with patch("uvicorn.run"):
    main()

origin = {"Origin": "http://localhost:8081"}
with TestClient(fastapi_app, base_url="http://localhost:8081") as client:
    asyncio.run(create_test_users())
    assert client.get("/api/activities").status_code == 401
    assert client.get("/").status_code == 200  # follows the redirect to login
    assert client.post("/auth/register", json={}, headers=origin).status_code == 503

    def login(email):
        response = client.post(
            "/auth/cookie/login",
            data={"username": email, "password": "correct-horse-battery"},
            headers=origin,
        )
        assert response.status_code == 204, response.text
        return client.cookies.get(COOKIE_NAME)

    def use_token(token):
        client.cookies.clear()
        client.cookies.set(COOKIE_NAME, token, domain="localhost.local", path="/")

    alice = login("alice@example.com")
    activity = {"name": "Alice's run", "date": "2026-01-01T10:00:00", "duration_seconds": 60}
    response = client.post("/api/activities", json=activity, headers=origin)
    assert response.status_code == 201, response.text
    activity_id = response.json()["id"]
    page = client.get("/")
    assert page.status_code == 200
    match = re.search(r'["\']client_id["\']\s*:\s*["\']([0-9a-f-]{36})', page.text)
    assert match, "NiceGUI page did not contain a client identifier"
    alice_client = match.group(1)
    client.cookies.clear()
    bob = login("bob@example.com")
    assert client.get("/api/activities").json() == []
    assert client.get(f"/api/activities/{activity_id}").status_code == 404
    assert (
        client.patch(
            f"/api/activities/{activity_id}", json={"name": "stolen"}, headers=origin
        ).status_code
        == 404
    )
    assert client.delete(f"/api/activities/{activity_id}", headers=origin).status_code == 404
    assert client.get(f"/api/activities/{activity_id}/laps").json() == []
    assert (
        client.post(
            "/api/activities", json=activity, headers={"Origin": "https://evil.example"}
        ).status_code
        == 403
    )
    socket_path = (
        "/_nicegui_ws/socket.io/?EIO=4&transport=websocket&implicit_handshake=true"
        f"&client_id={alice_client}&document_id=test-document&tab_id=test-tab"
    )
    ws_headers = {**origin, "Upgrade": "websocket", "Connection": "Upgrade"}
    with client.websocket_connect(
        "ws://localhost:8081" + socket_path, headers=ws_headers
    ) as socket:
        assert socket.receive_text().startswith("0")
        socket.send_text("40")
        assert socket.receive_text().startswith("44")
    use_token(alice)
    with client.websocket_connect(
        "ws://localhost:8081" + socket_path, headers=ws_headers
    ) as socket:
        assert socket.receive_text().startswith("0")
        socket.send_text("40")
        assert socket.receive_text().startswith("40")
        assert [row["name"] for row in client.get("/api/activities").json()] == ["Alice's run"]
        use_token(bob)
        bob_page = client.get("/")
        bob_match = re.search(
            r'["\']client_id["\']\s*:\s*["\']([0-9a-f-]{36})', bob_page.text
        )
        assert bob_match
        bob_path = socket_path.replace(alice_client, bob_match.group(1))
        with client.websocket_connect(
            "ws://localhost:8081" + bob_path, headers=ws_headers
        ) as bob_socket:
            assert bob_socket.receive_text().startswith("0")
            bob_socket.send_text("40")
            assert bob_socket.receive_text().startswith("40")
            bob_socket.send_text(
                f'421["event",{{"client_id":"{alice_client}","id":0,'
                '"listener_id":"invalid","args":[]}]'
            )
            while True:
                message = bob_socket.receive_text()
                if message.startswith("431"):
                    assert message == "431[false]", message
                    break
        use_token(alice)
        assert client.post("/auth/cookie/logout", headers=origin).status_code == 204
        socket.send_text(
            f'422["event",{{"client_id":"{alice_client}","id":0,'
            '"listener_id":"invalid","args":[]}]'
        )
        while True:
            message = socket.receive_text()
            if message.startswith("432"):
                assert message == "432[false]", message
                break
    use_token(alice)
    assert client.get("/api/activities").status_code == 401
    use_token(bob)
    assert client.get("/api/activities").status_code == 200

    os.environ.update(
        {
            "KINETIC_SMTP_HOST": "smtp.example.com",
            "KINETIC_SMTP_USER": "test",
            "KINETIC_SMTP_PASSWORD": "test",
            "KINETIC_SMTP_FROM": "test@example.com",
        }
    )
    sent = []
    with patch("app.auth._send_email", side_effect=lambda *args: sent.append(args)):
        client.cookies.clear()
        response = client.post(
            "/auth/register",
            json={"email": "carol@example.com", "password": "correct-horse-battery"},
            headers=origin,
        )
        assert response.status_code == 201, response.text
        assert len(sent) == 1
        assert (
            client.post(
                "/auth/cookie/login",
                data={"username": "carol@example.com", "password": "correct-horse-battery"},
                headers=origin,
            ).status_code
            == 400
        )
        assert (
            client.post("/auth/verify", json={"token": sent.pop()[3]}, headers=origin).status_code
            == 200
        )
        carol = login("carol@example.com")
        assert (
            client.post(
                "/auth/forgot-password", json={"email": "carol@example.com"}, headers=origin
            ).status_code
            == 202
        )
        reset_token = sent.pop()[3]
        assert (
            client.post(
                "/auth/reset-password",
                json={"token": reset_token, "password": "new-correct-horse-battery"},
                headers=origin,
            ).status_code
            == 200
        )
        use_token(carol)
        assert client.get("/api/activities").status_code == 401
        assert (
            client.post(
                "/auth/reset-password",
                json={"token": reset_token, "password": "new-correct-horse-battery"},
                headers=origin,
            ).status_code
            == 400
        )
