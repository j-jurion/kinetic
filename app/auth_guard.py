"""Protect HTTP requests and bind NiceGUI socket events to their account."""

import inspect
from urllib.parse import parse_qs

from nicegui import core
from nicegui.client import Client
from socketio.exceptions import ConnectionRefusedError as SocketConnectionRefusedError
from starlette.datastructures import MutableHeaders
from starlette.responses import JSONResponse, RedirectResponse

from app.auth import authenticated_owner, public_origin
from app.ownership import current_owner


class AuthGuard:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        origin = headers.get(b"origin", b"").decode("latin-1")
        unsafe = scope["type"] == "websocket" or scope.get("method") not in (
            "GET", "HEAD", "OPTIONS"
        )
        if unsafe and origin != public_origin():
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 4403})
            else:
                await JSONResponse({"detail": "Invalid origin"}, status_code=403)(
                    scope, receive, send
                )
            return

        path = scope["path"]
        public = path in (
            "/login", "/register", "/forgot", "/verify", "/reset", "/resend"
        ) or path.startswith("/auth/")
        owner_id = authenticated_owner(scope)
        if not public and owner_id is None:
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 4401})
            elif path.startswith("/api/") or path.startswith("/_nicegui_ws/"):
                await JSONResponse({"detail": "Authentication required"}, status_code=401)(
                    scope, receive, send
                )
            else:
                await RedirectResponse("/login", status_code=303)(scope, receive, send)
            return

        scope.setdefault("state", {})["owner_id"] = owner_id
        token = current_owner.set(owner_id)

        async def send_private(message):
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)["Cache-Control"] = "no-store"
            await send(message)

        try:
            await self.app(scope, receive, send_private)
        finally:
            current_owner.reset(token)


def install_socket_guards() -> None:
    handlers = core.sio.handlers.get("/", {})
    names = ("connect", "handshake", "event", "javascript_response", "ack", "log")
    if any(name not in handlers for name in names):
        raise RuntimeError("Unsupported NiceGUI socket handlers")

    def wrap(name, handler):
        async def guarded(sid, *args):
            environ = core.sio.get_environ(sid)
            if environ is None:
                if name == "connect":
                    raise SocketConnectionRefusedError("Unauthorized")
                return False
            scope = environ["asgi.scope"]
            owner_id = authenticated_owner(scope)
            query = parse_qs(scope.get("query_string", b"").decode())
            message = args[0] if args and isinstance(args[0], dict) else {}
            client_id = query.get("client_id", [""])[0] if name == "connect" else message.get(
                "client_id", ""
            )
            client = Client.instances.get(client_id)
            allowed = (
                owner_id is not None
                and client is not None
                and client._request is not None
                and client._request.scope.get("state", {}).get("owner_id") == owner_id
                and (name in ("connect", "handshake") or sid in client._socket_to_document_id)
            )
            if not allowed:
                if name == "connect":
                    raise SocketConnectionRefusedError("Unauthorized")
                return False
            token = current_owner.set(owner_id)
            try:
                result = handler(sid, *args)
                return await result if inspect.isawaitable(result) else result
            finally:
                current_owner.reset(token)

        return guarded

    for name in names:
        core.sio.on(name, handler=wrap(name, handlers[name]))
