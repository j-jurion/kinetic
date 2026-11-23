"""Protect API requests and bind each request to its authenticated account."""

import hmac
import os

from starlette.datastructures import MutableHeaders
from starlette.responses import JSONResponse

from app.auth import authenticated_owner, public_origin
from app.ownership import current_owner

PUBLIC_PATHS = ("/api/auth/login", "/api/auth/register", "/api/auth/logout", "/api/health")
ORIGIN_SECRET_HEADER = b"x-origin-secret"


def _origin_secret_ok(headers: dict[bytes, bytes], path: str) -> bool:
    """When KINETIC_ORIGIN_SECRET is set, only the proxy in front of the API (Vercel) knows it.

    This rejects requests that reach the API host (e.g. *.fly.dev) directly. The health check
    stays open so the hosting platform can probe it.
    """
    secret = os.environ.get("KINETIC_ORIGIN_SECRET", "")
    if not secret or path == "/api/health":
        return True
    return hmac.compare_digest(headers.get(ORIGIN_SECRET_HEADER, b""), secret.encode())


class AuthGuard:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        if not _origin_secret_ok(headers, scope["path"]):
            await JSONResponse({"detail": "Not found"}, status_code=404)(scope, receive, send)
            return

        origin = headers.get(b"origin", b"").decode("latin-1")
        # Browsers send Origin on every cross-site and same-site state-changing request; the
        # web app is served from the public origin, so anything else is a forged request.
        if scope.get("method") not in ("GET", "HEAD", "OPTIONS") and origin != public_origin():
            await JSONResponse({"detail": "Invalid origin"}, status_code=403)(
                scope, receive, send
            )
            return

        owner_id = authenticated_owner(scope)
        # Only the API holds account data; the web app's static files are public.
        protected = scope["path"].startswith("/api/") and scope["path"] not in PUBLIC_PATHS
        if protected and owner_id is None:
            await JSONResponse({"detail": "Authentication required"}, status_code=401)(
                scope, receive, send
            )
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
