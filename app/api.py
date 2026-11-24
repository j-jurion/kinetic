"""JSON API used by the React web app: the routers of ``app/routes`` under one prefix.

Every query goes through the account-scoped ``UserSession``, so a request only ever sees the
records of the account that made it. Values are returned raw (metres, seconds, ISO dates);
the web app formats them.
"""

from fastapi import APIRouter

from app.routes import (
    activities,
    apple_health,
    best_efforts,
    garmin,
    races,
    stats,
    training,
)

router = APIRouter()
for module in (activities, races, best_efforts, stats, training, garmin, apple_health):
    router.include_router(module.router)
