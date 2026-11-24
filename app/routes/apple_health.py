"""Apple Health workouts: the integration token, webhook and export import."""

import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from loguru import logger

from app import apple_health, auth
from app.routes.common import (
    current_owner_id,
    run_in_thread,
)

router = APIRouter()


# ── Apple Health ──────────────────────────────────────────────────────────────

MAX_APPLE_HEALTH_BYTES = 25 * 1024 * 1024


async def _json_body(request: Request, limit: int) -> Any:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise HTTPException(status_code=413, detail="Request is too large")
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > limit:
            raise HTTPException(status_code=413, detail="Request is too large")
    try:
        return json.loads(body)
    except ValueError:
        raise HTTPException(status_code=400, detail="Body is not valid JSON") from None


async def _import_apple_workouts(request: Request) -> dict:
    payload = await _json_body(request, MAX_APPLE_HEALTH_BYTES)
    try:
        workouts = apple_health.workouts_from_payload(payload)
        result = await run_in_thread(apple_health.import_workouts, workouts)
    except apple_health.WorkoutError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    logger.info(
        "Apple Health: {} imported, {} skipped, {} failed",
        len(result["imported"]),
        result["skipped"],
        len(result["errors"]),
    )
    return result


@router.get("/integrations/apple-health")
def apple_health_status() -> dict:
    return {"token": auth.integration_token_info(current_owner_id(), auth.APPLE_HEALTH)}


@router.post("/integrations/apple-health/token")
def apple_health_create_token() -> dict:
    """Create (or replace) the token Health Auto Export sends; it is only shown this once."""
    token = auth.create_integration_token(current_owner_id(), auth.APPLE_HEALTH)
    return {"token": token, "webhook_path": "/api/integrations/apple-health/webhook"}


@router.delete("/integrations/apple-health/token", status_code=204)
def apple_health_revoke_token() -> None:
    auth.revoke_integration_token(current_owner_id(), auth.APPLE_HEALTH)


@router.post("/integrations/apple-health/webhook")
async def apple_health_webhook(request: Request) -> dict:
    """Health Auto Export "REST API" automation target; authenticated by its bearer token."""
    return await _import_apple_workouts(request)


@router.post("/integrations/apple-health/import")
async def apple_health_import(request: Request) -> dict:
    """Workouts the web app read from an Apple Health export.zip, in the same JSON format."""
    return await _import_apple_workouts(request)
