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
    "%3Ccircle cx='4' cy='12' r='3.5' fill='none' stroke='%238b5cf6' stroke-width='1.8'/%3E"
    "%3Ccircle cx='12' cy='12' r='3.5' fill='none' stroke='%238b5cf6' stroke-width='1.8'/%3E"
    "%3Ccircle cx='20' cy='12' r='3.5' fill='none' stroke='%238b5cf6' stroke-width='1.8'/%3E"
    "%3C/svg%3E"
)
# Two rings (run · bike)
_DUATHLON_ICON = (
    "img:data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E"
    "%3Ccircle cx='7' cy='12' r='5.5' fill='none' stroke='%23d946ef' stroke-width='1.8'/%3E"
    "%3Ccircle cx='17' cy='12' r='5.5' fill='none' stroke='%23d946ef' stroke-width='1.8'/%3E"
    "%3C/svg%3E"
)
# Four rings in a 2×2 grid (other multisport)
_MULTISPORT_ICON = (
    "img:data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E"
    "%3Ccircle cx='7' cy='7' r='3.5' fill='none' stroke='%2314b8a6' stroke-width='1.8'/%3E"
    "%3Ccircle cx='17' cy='7' r='3.5' fill='none' stroke='%2314b8a6' stroke-width='1.8'/%3E"
    "%3Ccircle cx='7' cy='17' r='3.5' fill='none' stroke='%2314b8a6' stroke-width='1.8'/%3E"
    "%3Ccircle cx='17' cy='17' r='3.5' fill='none' stroke='%2314b8a6' stroke-width='1.8'/%3E"
    "%3C/svg%3E"
)

SPORT_ICONS = {
    "running": "directions_run",
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
    "running": "#830000",
    "cycling": "#036627",
    "swimming": "#3b82f6",
    "hiking": "#aa7400",
    "walking": "#84cc16",
    "triathlon": "#8b5cf6",
    "duathlon": "#d946ef",
    "multisport": "#c37aac",
    "strength": "#ec4899",
    "yoga": "#0bcaf5",
    "other": "#6b7280",
}

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
    ui.chip(sport, icon=icon, color=color).props("outline dense")
