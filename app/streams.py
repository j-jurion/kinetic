"""Per-second activity data (heart rate, speed, altitude, …) read back from the FIT file.

Only summaries, laps and the route are stored in the database, so the detail charts read the
original FIT file on request. Parsing is slow, so files are cached once read.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Optional

from app import analysis
from app.garmin_sync import UPLOAD_DIR

# Points returned per activity; each is the average of an equal slice of the records
MAX_POINTS = 600
# Sports whose FIT cadence counts one foot, so steps per minute are twice the value
_STEP_SPORTS = {"running", "trail_running", "walking", "hiking"}
# Sports shown as running pace, which get a grade-adjusted pace
RUNNING_SPORTS = {"running", "trail_running"}

FIELDS = (
    "t",
    "distance",
    "heart_rate",
    "speed",
    "altitude",
    "cadence",
    "power",
    "lat",
    "lon",
    "temperature",
    "step_length",
    "ground_contact",
    "vertical_oscillation",
    "vertical_ratio",
    "grade_adjusted_speed",
)
# FIT stores positions in semicircles
_SEMICIRCLES_TO_DEG = 180.0 / (2**31)
# Decimals kept per field when averaging (positions need ~10 cm precision)
_DECIMALS = {"lat": 6, "lon": 6}


@dataclass(frozen=True)
class FitData:
    records: tuple[dict, ...]
    lengths: tuple[dict, ...]
    # Values the watch was set up with: max_hr, threshold_hr, ftp, weight, resting_hr
    settings: dict


def _value(record: dict, *names: str) -> Optional[float]:
    for name in names:
        value = record.get(name)
        if value is not None:
            try:
                return float(value)
            except (TypeError, ValueError):
                return None
    return None


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _plausible(value, low: float, high: float) -> Optional[float]:
    """A setting only when it is a sensible number (watches store 0 or junk for unset)."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if low <= number <= high else None


@lru_cache(maxsize=32)
def _read_fit(path: str, mtime: float) -> FitData:
    """Records, pool lengths and watch settings of a FIT file (cached per file version)."""
    import fitparse

    records, lengths = [], []
    settings: dict = {}
    for message in fitparse.FitFile(path).get_messages(
        ["record", "length", "zones_target", "user_profile"]
    ):
        values = {field.name: field.value for field in message.fields}
        if message.name == "record":
            records.append(values)
        elif message.name == "length":
            lengths.append(values)
        elif message.name == "zones_target":
            settings.setdefault("max_hr", _plausible(values.get("max_heart_rate"), 120, 230))
            settings.setdefault(
                "threshold_hr", _plausible(values.get("threshold_heart_rate"), 100, 220)
            )
            settings.setdefault(
                "ftp", _plausible(values.get("functional_threshold_power"), 50, 600)
            )
        elif message.name == "user_profile":
            settings.setdefault("weight", _plausible(values.get("weight"), 30, 200))
            settings.setdefault("resting_hr", _plausible(values.get("resting_heart_rate"), 30, 100))
    return FitData(tuple(records), tuple(lengths), {k: v for k, v in settings.items() if v})


def read_fit(path: Path) -> FitData:
    return _read_fit(str(path), path.stat().st_mtime)


def fit_path_for(stored: Optional[str]) -> Optional[Path]:
    """The FIT file of an activity, if it exists in the uploads folder.

    Files are looked up by name in ``UPLOAD_DIR`` rather than by the stored path, so the
    folder can move (``KINETIC_UPLOAD_DIR``) and the server can start from any directory.
    Only a plain file name inside that folder is ever read.
    """
    if not stored:
        return None
    # The stored path may use either separator, depending on the OS that imported it
    name = stored.replace("\\", "/").rsplit("/", 1)[-1]
    if not name or name in (".", ".."):
        return None
    path = (UPLOAD_DIR / name).resolve()
    if not path.is_file() or path.parent != UPLOAD_DIR.resolve():
        return None
    return path


def _in_window(items, start: Optional[datetime], duration: Optional[float], key="timestamp"):
    """Only the items of one multisport leg (all items when ``start`` is None)."""
    if start is None:
        return [i for i in items if isinstance(i.get(key), datetime)]
    begin = _as_utc(start) - timedelta(seconds=5)
    end = _as_utc(start) + timedelta(seconds=(duration or 0) + 60)
    return [
        i for i in items if isinstance(i.get(key), datetime) and begin <= _as_utc(i[key]) <= end
    ]


def activity_rows(
    data: FitData, sport: str, start: Optional[datetime] = None, duration: Optional[float] = None
) -> list[dict]:
    """The records of one activity as plain rows in common units.

    ``start`` and ``duration`` limit the records to one leg of a multisport file.
    """
    timed = _in_window(data.records, start, duration)
    if not timed:
        return []
    first = _as_utc(timed[0]["timestamp"])
    first_distance = _value(timed[0], "distance") or 0.0
    steps = sport in _STEP_SPORTS
    rows = []
    for r in timed:
        cadence = _value(r, "cadence")
        if cadence is not None:
            cadence += _value(r, "fractional_cadence") or 0.0
            if steps:
                cadence *= 2
        distance = _value(r, "distance")
        lat = _value(r, "position_lat")
        lon = _value(r, "position_long")
        step_length = _value(r, "step_length")  # millimetres
        oscillation = _value(r, "vertical_oscillation")  # millimetres
        rows.append(
            {
                "t": (_as_utc(r["timestamp"]) - first).total_seconds(),
                "distance": distance - first_distance if distance is not None else None,
                "heart_rate": _value(r, "heart_rate"),
                "speed": _value(r, "enhanced_speed", "speed"),
                "altitude": _value(r, "enhanced_altitude", "altitude"),
                "cadence": cadence or None,
                "power": _value(r, "power"),
                "lat": lat * _SEMICIRCLES_TO_DEG if lat is not None else None,
                "lon": lon * _SEMICIRCLES_TO_DEG if lon is not None else None,
                "temperature": _value(r, "temperature"),
                "step_length": step_length / 1000 if step_length else None,  # metres
                "ground_contact": _value(r, "stance_time") or None,  # milliseconds
                "vertical_oscillation": oscillation / 10 if oscillation else None,  # cm
                "vertical_ratio": _value(r, "vertical_ratio") or None,  # percent
            }
        )
    return rows


def activity_lengths(
    data: FitData, start: Optional[datetime] = None, duration: Optional[float] = None
) -> list[dict]:
    return _in_window(data.lengths, start, duration, key="start_time")


def _downsample(rows: list[dict]) -> dict[str, list]:
    """Average equal slices of rows so the charts stay light but smooth."""
    size = max(1, -(-len(rows) // MAX_POINTS))
    points: dict[str, list] = {f: [] for f in FIELDS}
    for i in range(0, len(rows), size):
        chunk = rows[i : i + size]
        for field in FIELDS:
            values = [r.get(field) for r in chunk if r.get(field) is not None]
            average = sum(values) / len(values) if values else None
            points[field].append(
                round(average, _DECIMALS.get(field, 2)) if average is not None else None
            )
    return points


def read_streams(
    path: Path,
    sport: str,
    start: Optional[datetime] = None,
    duration_seconds: Optional[float] = None,
    max_hr: Optional[float] = None,
    ftp: Optional[float] = None,
) -> dict:
    """Downsampled streams plus zones, climbs, swim lengths and a summary for one activity.

    ``max_hr`` and ``ftp`` are fallbacks for when the file has no watch settings.
    """
    data = read_fit(path)
    rows = activity_rows(data, sport, start, duration_seconds)
    if not rows:
        return {"points": {f: [] for f in FIELDS}, "zones": [], "zone_max_hr": None}

    if sport in RUNNING_SPORTS:
        for row, adjusted in zip(rows, analysis.grade_adjusted_speeds(rows)):
            row["grade_adjusted_speed"] = adjusted

    settings = data.settings
    # Zones follow the watch's maximum heart rate; otherwise the highest one recorded
    histogram = analysis.hr_histogram(rows)
    record_max = max(histogram, default=None)
    reference = settings.get("max_hr") or max(filter(None, [max_hr, record_max]), default=None)
    zones = []
    if reference and histogram:
        seconds = analysis.hr_zone_seconds(histogram, reference)
        zones = [
            {
                "zone": name,
                "low": round(low * reference),
                "high": round(min(high, 1) * reference),
                "seconds": s,
            }
            for (name, low, high), s in zip(analysis.HR_ZONES, seconds)
        ]

    series = analysis.power_series(rows)
    threshold_power = settings.get("ftp") or ftp
    np_ = analysis.normalized_power(series)
    power_zones = []
    if series and threshold_power:
        seconds = analysis.power_zone_seconds(series, threshold_power)
        power_zones = [
            {
                "zone": name,
                "name": label,
                "low": round(low * threshold_power),
                "high": round(min(high, 2) * threshold_power) if high < 100 else None,
                "seconds": round(s),
            }
            for (name, low, high, label), s in zip(analysis.POWER_ZONES, seconds)
        ]

    gap = analysis.average_grade_adjusted_speed(rows) if sport in RUNNING_SPORTS else None
    return {
        "points": _downsample(rows),
        "zones": zones,
        "zone_max_hr": round(reference) if reference else None,
        "zone_source": "watch" if settings.get("max_hr") else "estimate",
        "power_zones": power_zones,
        "ftp": round(threshold_power) if threshold_power else None,
        "climbs": analysis.climbs(rows),
        "lengths": analysis.swim_lengths(activity_lengths(data, start, duration_seconds)),
        "summary": {
            "normalized_power": np_,
            "intensity_factor": round(np_ / threshold_power, 2)
            if np_ and threshold_power
            else None,
            "decoupling_pct": analysis.decoupling(
                rows, use_power=bool(series) and sport == "cycling"
            ),
            "avg_temperature": _round(analysis.average_moving(rows, "temperature", minimum=-100)),
            "grade_adjusted_speed": _round(gap, 3),
            "avg_step_length": _round(analysis.average_moving(rows, "step_length"), 2),
            "avg_ground_contact": _round(analysis.average_moving(rows, "ground_contact")),
            "avg_vertical_oscillation": _round(
                analysis.average_moving(rows, "vertical_oscillation"), 1
            ),
            "avg_vertical_ratio": _round(analysis.average_moving(rows, "vertical_ratio"), 1),
            "weight": settings.get("weight"),
        },
    }


def _round(value: Optional[float], digits: int = 0) -> Optional[float]:
    if value is None:
        return None
    return round(value, digits) if digits else round(value)
