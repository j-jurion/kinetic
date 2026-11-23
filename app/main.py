"""Kinetic API – the JSON backend behind the React web app in ``web/``.

Run with:  uv run python run.py
"""

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

from app.api import router
from app.auth import create_auth_tables, public_origin
from app.auth import router as auth_router
from app.auth_guard import AuthGuard
from app.database import create_db_and_tables, lock_down_postgres_tables


@asynccontextmanager
async def lifespan(_app: FastAPI):
    create_db_and_tables()
    create_auth_tables()
    lock_down_postgres_tables()
    yield


fastapi_app = FastAPI(title="Kinetic API", lifespan=lifespan, docs_url="/api/docs",
                      openapi_url="/api/openapi.json")
fastapi_app.add_middleware(AuthGuard)
fastapi_app.include_router(auth_router)
fastapi_app.include_router(router, prefix="/api")


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

    import uvicorn

    uvicorn.run(
        fastapi_app,
        host=os.environ.get("KINETIC_API_HOST", "127.0.0.1"),
        port=int(os.environ.get("KINETIC_API_PORT", "8000")),
    )


if __name__ == "__main__":
    main()
