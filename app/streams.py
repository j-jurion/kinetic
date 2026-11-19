"""Per-second activity data (heart rate, speed, altitude, …) read back from the FIT file.

Only summaries, laps and the route are stored in the database, so the detail charts read the
original FIT file on request. Parsing is slow, so results are cached per file and time window.
"""

from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Optional

from app.garmin_sync import UPLOAD_DIR

# Points returned per activity; each is the average of an equal slice of the records
MAX_POINTS = 600
# Gaps between records longer than this are pauses and do not count as time in a zone
MAX_GAP_SECONDS = 10
# Heart-rate zones as fractions of the maximum heart rate
ZONES = [("Z1", 0.5, 0.6), ("Z2", 0.6, 0.7), ("Z3", 0.7, 0.8), ("Z4", 0.8, 0.9), ("Z5", 0.9, 10.0)]
# Sports whose FIT cadence counts one foot, so steps per minute are twice the value
_STEP_SPORTS = {"running", "trail_running", "walking", "hiking"}

FIELDS = ("t", "distance", "heart_rate", "speed", "altitude", "cadence", "power")


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


@lru_cache(maxsize=32)
def _read_records(path: str, mtime: float) -> tuple[dict, ...]:
    """Every record message of a FIT file (cached per file version)."""
    import fitparse

    records = []
    for message in fitparse.FitFile(path).get_messages("record"):
        records.append({field.name: field.value for field in message.fields})
    return tuple(records)


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


def read_streams(
    path: Path,
    sport: str,
    start: Optional[datetime] = None,
    duration_seconds: Optional[float] = None,
    max_hr: Optional[float] = None,
) -> dict:
    """Downsampled streams and time per heart-rate zone for one activity.

    ``start`` and ``duration_seconds`` limit the records to one leg of a multisport file.
    """
    records = _read_records(str(path), path.stat().st_mtime)
    if start is not None:
        begin = _as_utc(start) - timedelta(seconds=5)
        end = _as_utc(start) + timedelta(seconds=(duration_seconds or 0) + 60)
        records = tuple(
            r for r in records if isinstance(r.get("timestamp"), datetime)
            and begin <= _as_utc(r["timestamp"]) <= end
        )
    timed = [r for r in records if isinstance(r.get("timestamp"), datetime)]
    if not timed:
        return {"points": {f: [] for f in FIELDS}, "zones": [], "zone_max_hr": None}

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
        rows.append(
            {
                "t": (_as_utc(r["timestamp"]) - first).total_seconds(),
                "distance": distance - first_distance if distance is not None else None,
                "heart_rate": _value(r, "heart_rate"),
                "speed": _value(r, "enhanced_speed", "speed"),
                "altitude": _value(r, "enhanced_altitude", "altitude"),
                "cadence": cadence or None,
                "power": _value(r, "power"),
            }
        )

    # Time in zones from the full-resolution heart rate
    zones = []
    record_max = max((r["heart_rate"] for r in rows if r["heart_rate"]), default=None)
    reference = max(filter(None, [max_hr, record_max]), default=None)
    if reference:
        seconds = [0.0] * len(ZONES)
        for previous, current in zip(rows, rows[1:]):
            gap = current["t"] - previous["t"]
            hr = previous["heart_rate"]
            if not hr or gap <= 0 or gap > MAX_GAP_SECONDS:
                continue
            for i, (_, low, high) in enumerate(ZONES):
                if low * reference <= hr < high * reference:
                    seconds[i] += gap
                    break
        zones = [
            {"zone": name, "low": round(low * reference), "high": round(min(high, 1) * reference),
             "seconds": round(s)}
            for (name, low, high), s in zip(ZONES, seconds)
        ]

    # Average equal slices of records so the charts stay light but smooth
    size = max(1, -(-len(rows) // MAX_POINTS))
    points: dict[str, list] = {f: [] for f in FIELDS}
    for i in range(0, len(rows), size):
        chunk = rows[i : i + size]
        for field in FIELDS:
            values = [r[field] for r in chunk if r[field] is not None]
            points[field].append(round(sum(values) / len(values), 2) if values else None)

    return {
        "points": points,
        "zones": zones,
        "zone_max_hr": round(reference) if reference else None,
    }
