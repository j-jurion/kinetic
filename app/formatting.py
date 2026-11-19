"""Sport metadata and value formatting shared by the API and the FIT parser.

The web frontend has its own copy of these rules in ``web/lib/format.ts``; keep both in sync.
"""

from datetime import date, datetime
from typing import Optional, Union

# Every date shown in the app uses this format
DATE_FORMAT = "%d-%m-%Y"
DATETIME_FORMAT = "%d-%m-%Y %H:%M"

SPORTS = [
    "running",
    "trail_running",
    "cycling",
    "swimming",
    "hiking",
    "walking",
    "triathlon",
    "duathlon",
    "multisport",
    "strength",
    "yoga",
    "other",
]

# Filter groups: a single option that selects several sports at once
ALL_RUNNING = "all_running"
SPORT_GROUPS: dict[str, list[str]] = {
    ALL_RUNNING: ["running", "trail_running"],
}

# Sports that act as an umbrella over more specific ones when used as a filter
SPORT_COVERS: dict[str, list[str]] = {
    "multisport": ["multisport", "triathlon", "duathlon"],
}


def resolve_sports(value: Optional[str]) -> Optional[list[str]]:
    """Expand a filter selection into the sports it covers (None = every sport).

    Besides the filter groups, picking "Multisport" also covers triathlon and duathlon.
    """
    if not value:
        return None
    if value in SPORT_GROUPS:
        return list(SPORT_GROUPS[value])
    if value not in SPORTS:
        raise ValueError(f"Unknown sport: {value!r}")
    return list(SPORT_COVERS.get(value, [value]))


def is_swimming(sport: Optional[str]) -> bool:
    """True when a sport (or sport group) only covers swimming."""
    sports = resolve_sports(sport)
    return bool(sports) and all(s == "swimming" for s in sports)


def _to_datetime(value: Union[datetime, date, str, None]) -> Optional[datetime]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day)
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        for fmt in (DATETIME_FORMAT, DATE_FORMAT):
            try:
                return datetime.strptime(value, fmt)
            except ValueError:
                continue
    return None


def format_date(value: Union[datetime, date, str, None]) -> str:
    """Render any date value as dd-mm-yyyy."""
    parsed = _to_datetime(value)
    return parsed.strftime(DATE_FORMAT) if parsed else ""
