"""The GPS route of an activity in the shapes the API serves.

``route_json`` holds every recorded point (often thousands). Lists and the all-activities map
only need to know whether there is a route, and a light version of it, so two columns are
derived from it whenever it is saved: ``has_route`` and ``map_route_json`` (at most
``MAP_POINTS`` points, rounded to about a metre). Queries through the account-scoped session
skip the heavy columns unless asked for them (see ``app/ownership.py``).
"""

import json
from typing import Any, Optional

from sqlalchemy import event, inspect

from app.models import Activity

MAP_POINTS = 250


def parse_route(route_json: Optional[str]) -> Optional[list[list[float]]]:
    """The located points of a stored route, or None when it has fewer than two."""
    if not route_json:
        return None
    try:
        raw: Any = json.loads(route_json)
    except (ValueError, TypeError):
        return None
    if not isinstance(raw, list):
        return None
    coords = [
        c for c in raw if isinstance(c, list) and len(c) >= 2 and None not in (c[0], c[1])
    ]
    return coords if len(coords) >= 2 else None


def simplify(coords: list[list[float]], points: int = MAP_POINTS) -> list[list[float]]:
    """Evenly decimate a route to at most ``points`` + 1 points, keeping its last point."""
    if len(coords) <= points:
        simplified = coords
    else:
        step = len(coords) / points
        simplified = [coords[int(i * step)] for i in range(points)]
        simplified.append(coords[-1])
    return [[round(float(c[0]), 5), round(float(c[1]), 5)] for c in simplified]


def map_route_json(route_json: Optional[str]) -> Optional[str]:
    coords = parse_route(route_json)
    return json.dumps(simplify(coords), separators=(",", ":")) if coords else None


def _sync(target: Activity) -> None:
    target.has_route = bool(target.route_json)
    target.map_route_json = map_route_json(target.route_json)


@event.listens_for(Activity, "before_insert")
def _before_insert(_mapper, _connection, target: Activity) -> None:
    _sync(target)


@event.listens_for(Activity, "before_update")
def _before_update(_mapper, _connection, target: Activity) -> None:
    state = inspect(target)
    if "route_json" not in state.unloaded and state.attrs.route_json.history.has_changes():
        _sync(target)
