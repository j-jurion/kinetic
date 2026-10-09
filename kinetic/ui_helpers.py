"""Shared UI helpers, theme tokens and navigation."""

from datetime import date, datetime
from typing import Optional, Union

from nicegui import ui

# Every date shown in the app uses this format
DATE_FORMAT = "%d-%m-%Y"
DATETIME_FORMAT = "%d-%m-%Y %H:%M"
# Quasar date-picker mask matching DATE_FORMAT
DATE_MASK = "DD-MM-YYYY"

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
KINDS = ["race", "training", "easy", "social", "long_run", "tempo", "interval", "recovery", "other"]

# SVG ring icons for multisport disciplines
# Three rings (swim · bike · run)
_TRIATHLON_ICON = (
    "img:data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E"
    "%3Ccircle cx='4' cy='12' r='3.5' fill='none' stroke='%237c4dff' stroke-width='1.8'/%3E"
    "%3Ccircle cx='12' cy='12' r='3.5' fill='none' stroke='%237c4dff' stroke-width='1.8'/%3E"
    "%3Ccircle cx='20' cy='12' r='3.5' fill='none' stroke='%237c4dff' stroke-width='1.8'/%3E"
    "%3C/svg%3E"
)
# Two rings (run · bike)
_DUATHLON_ICON = (
    "img:data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E"
    "%3Ccircle cx='7' cy='12' r='5.5' fill='none' stroke='%23ff4dd8' stroke-width='1.8'/%3E"
    "%3Ccircle cx='17' cy='12' r='5.5' fill='none' stroke='%23ff4dd8' stroke-width='1.8'/%3E"
    "%3C/svg%3E"
)
# Four rings in a 2×2 grid (other multisport)
_MULTISPORT_ICON = (
    "img:data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E"
    "%3Ccircle cx='7' cy='7' r='3.5' fill='none' stroke='%2300bfa5' stroke-width='1.8'/%3E"
    "%3Ccircle cx='17' cy='7' r='3.5' fill='none' stroke='%2300bfa5' stroke-width='1.8'/%3E"
    "%3Ccircle cx='7' cy='17' r='3.5' fill='none' stroke='%2300bfa5' stroke-width='1.8'/%3E"
    "%3Ccircle cx='17' cy='17' r='3.5' fill='none' stroke='%2300bfa5' stroke-width='1.8'/%3E"
    "%3C/svg%3E"
)
# The standard running figure placed on top of a hill (trail running)
_TRAIL_RUNNING_ICON = (
    "img:data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E"
    "%3Cpath transform='translate(2.4,0) scale(0.8)' fill='%23ff7a00' d='M13.49 5.48c1.1 0 2-.9"
    " 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3"
    " 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2"
    "v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z'/%3E"
    "%3Cpath fill='%23ff7a00' d='M0 24L0 22.6C4.5 22.6 6 17.8 11 17.8C16 17.8 18 22.6 24"
    " 22.6L24 24Z'/%3E%3C/svg%3E"
)

SPORT_ICONS = {
    "running": "directions_run",
    "trail_running": _TRAIL_RUNNING_ICON,
    "cycling": "directions_bike",
    "swimming": "pool",
    "hiking": "hiking",
    "walking": "directions_walk",
    "triathlon": _TRIATHLON_ICON,
    "duathlon": _DUATHLON_ICON,
    "multisport": _MULTISPORT_ICON,
    "strength": "fitness_center",
    "yoga": "self_improvement",
    "other": "sports",
}

SPORT_COLORS = {
    "running": "#ff2d55",
    "trail_running": "#ff7a00",
    "cycling": "#00c853",
    "swimming": "#00a3ff",
    "hiking": "#ffb300",
    "walking": "#aeea00",
    "triathlon": "#7c4dff",
    "duathlon": "#ff4dd8",
    "multisport": "#00bfa5",
    "strength": "#ff2d8a",
    "yoga": "#00e5ff",
    "other": "#90a4ae",
}

# Filter groups: a single option that selects several sports at once
ALL_RUNNING = "all_running"
SPORT_GROUPS: dict[str, list[str]] = {
    ALL_RUNNING: ["running", "trail_running"],
}
SPORT_GROUP_LABELS = {ALL_RUNNING: "All running"}
ALL_SPORTS = ""

DISTANCE_LABELS: dict[float, str] = {
    400: "400 m",
    800: "800 m",
    1000: "1 km",
    1609.34: "1 mile",
    3000: "3 km",
    5000: "5 km",
    10000: "10 km",
    15000: "15 km",
    30000: "30 km",
    21097.5: "Half marathon",
    42195: "Marathon",
    20000: "20 km",
    40000: "40 km",
    100000: "100 km",
    100: "100 m",
    200: "200 m",
    1500: "1500 m",
}


def sport_label(sport: str) -> str:
    """Human readable name for a sport or sport group."""
    if sport in SPORT_GROUP_LABELS:
        return SPORT_GROUP_LABELS[sport]
    return sport.replace("_", " ").capitalize()


def sport_filter_options(
    sports: Optional[list[str]] = None, include_all_sports: bool = True
) -> dict[str, str]:
    """Options for a sport filter select, mapping stored value → displayed label."""
    options: dict[str, str] = {}
    if include_all_sports:
        options[ALL_SPORTS] = "All sports"
    candidates = sports if sports is not None else SPORTS
    for group, members in SPORT_GROUPS.items():
        if any(m in candidates for m in members):
            options[group] = SPORT_GROUP_LABELS[group]
    for sport in candidates:
        options[sport] = sport_label(sport)
    return options


def resolve_sports(value: Optional[str]) -> Optional[list[str]]:
    """Expand a filter selection into the sports it covers (None = every sport)."""
    if not value:
        return None
    if value in SPORT_GROUPS:
        return list(SPORT_GROUPS[value])
    return [value]


def sport_color(sport: Optional[str], default: str = "#f97316") -> str:
    """Colour for a sport or sport group."""
    if not sport:
        return default
    if sport in SPORT_GROUPS:
        return SPORT_COLORS.get(SPORT_GROUPS[sport][0], default)
    return SPORT_COLORS.get(sport, default)


def sport_icon(sport: Optional[str], default: str = "sports") -> str:
    """Icon for a sport or sport group."""
    if not sport:
        return default
    if sport in SPORT_GROUPS:
        return SPORT_ICONS.get(SPORT_GROUPS[sport][0], default)
    return SPORT_ICONS.get(sport, default)


def _to_datetime(value: Union[datetime, date, str, None]) -> Optional[datetime]:
    """Coerce a datetime, date or ISO/dd-mm-yyyy string into a datetime."""
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


def format_datetime(value: Union[datetime, date, str, None]) -> str:
    """Render any date value as dd-mm-yyyy HH:MM."""
    parsed = _to_datetime(value)
    return parsed.strftime(DATETIME_FORMAT) if parsed else ""


def parse_date_input(value: Union[str, None]) -> datetime:
    """Parse a user-entered dd-mm-yyyy[ HH:MM] value; ISO input is also accepted."""
    parsed = _to_datetime((value or "").strip())
    if parsed is None:
        raise ValueError(f"Unrecognised date: {value!r}")
    return parsed


def format_duration(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    if h > 0:
        return f"{h}h {m:02d}m {s:02d}s"
    return f"{m}:{s:02d}"


def format_pace(distance_m: float, duration_s: float) -> str:
    """Returns min/km pace string."""
    if distance_m <= 0:
        return "-"
    pace_s_per_km = duration_s / (distance_m / 1000)
    m = int(pace_s_per_km // 60)
    s = int(pace_s_per_km % 60)
    return f"{m}:{s:02d} /km"


def format_speed_kmh(speed_ms: float) -> str:
    return f"{speed_ms * 3.6:.1f} km/h"


def sport_chip(sport: str) -> None:
    color = SPORT_COLORS.get(sport, "#6b7280")
    icon = SPORT_ICONS.get(sport, "sports")
    ui.chip(sport_label(sport), icon=icon, color=color).props("outline dense")
