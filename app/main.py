"""Kinetic API – the JSON backend behind the React web app in ``web/``.

Run with:  uv run python run.py
"""

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from loguru import logger

from app.account import router as account_router
from app.api import router
from app.auth import create_auth_tables, preview_origin_patterns, public_origin
from app.auth import router as auth_router
from app.auth_guard import AuthGuard
from app.database import create_db_and_tables, lock_down_postgres_tables
from app.friends import router as friends_router
from app.repair import repair_impossible_best_efforts, repair_single_leg_events
from app.together import router as together_router
from app.token_crypto import warn_if_unconfigured

# Endpoints that stream progress as JSON lines while they work
STREAMING_PATHS = {"/api/garmin/sync", "/api/training/analyse"}


class NoCompression:
    """Hides Accept-Encoding from the compression middleware for the given paths."""

    def __init__(self, app, paths: set[str]):
        self.app = app
        self.paths = paths

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"] in self.paths:
            headers = [(k, v) for k, v in scope["headers"] if k != b"accept-encoding"]
            scope = {**scope, "headers": headers}
        await self.app(scope, receive, send)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    create_db_and_tables()
    create_auth_tables()
    lock_down_postgres_tables()
    try:
        repair_single_leg_events()
    except Exception:
        logger.exception("Repairing single-leg multisport events failed")
    try:
        repair_impossible_best_efforts()
    except Exception:
        logger.exception("Recomputing impossible best efforts failed")
    warn_if_unconfigured()
    yield


fastapi_app = FastAPI(title="Kinetic API", lifespan=lifespan, docs_url="/api/docs",
                      openapi_url="/api/openapi.json")
fastapi_app.add_middleware(AuthGuard)
# Compress JSON (the map and lists shrink several times), except the progress streams, which
# must reach the browser line by line
fastapi_app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)
fastapi_app.add_middleware(NoCompression, paths=STREAMING_PATHS)
fastapi_app.include_router(auth_router)
fastapi_app.include_router(account_router)
fastapi_app.include_router(router, prefix="/api")
# Before the friends router, whose /friends/{friend_id} would take /friends/together
fastapi_app.include_router(together_router, prefix="/api")
fastapi_app.include_router(friends_router, prefix="/api")


@fastapi_app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


# ── Built web app ─────────────────────────────────────────────────────────────
# In production the React app is built into web/dist and served from here, so the API and
# the web app share one origin. During development Vite serves it instead (see README).
WEB_DIST = Path(__file__).resolve().parent.parent / "web" / "dist"


@fastapi_app.get("/{path:path}", include_in_schema=False)
def web_app(path: str):
    if path.startswith("api/") or not (WEB_DIST / "index.html").is_file():
        raise HTTPException(status_code=404, detail="Not found")
    candidate = (WEB_DIST / path).resolve()
    if path and candidate.is_file() and candidate.is_relative_to(WEB_DIST):
        return FileResponse(candidate)
    # Client-side routes such as /activity/12 all load the single-page app
    return FileResponse(WEB_DIST / "index.html")


def main():
    public_origin()
    preview_origin_patterns()  # logs any KINETIC_PREVIEW_ORIGINS entry it has to ignore

    import uvicorn

    uvicorn.run(
        fastapi_app,
        host=os.environ.get("KINETIC_API_HOST", "127.0.0.1"),
        port=int(os.environ.get("KINETIC_API_PORT", "8000")),
    )


if __name__ == "__main__":
    main()
