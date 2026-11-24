"""Strava activity files: import the originals from a Strava bulk export.

A Strava export (Settings → My Account → Download or Delete Your Account → Request your
archive) holds ``activities.csv`` and an ``activities/`` folder with each activity's original
file: ``.fit``, ``.gpx`` or ``.tcx``, usually gzipped. The web app reads the zip in the browser
and sends the files one at a time, with the activity's name, type and description from the CSV.

FIT files are imported as they are. GPX and TCX files are converted into a FIT file with the
Apple Health encoder, so every activity goes through the same import, charts and metrics.

A file is skipped when an activity of the same sport already starts within a minute of it, so
importing the export twice, or an activity that also came in from Garmin, adds nothing.
"""

import io
import zlib
from datetime import datetime, timezone
from typing import Any, Optional
from xml.etree import ElementTree

from loguru import logger

from app import apple_health
from app.apple_health import RoutePoint, Workout
from app.database import engine
from app.fit_parser import resolve_sport
from app.models import Activity, SportType
from app.ownership import UserSession as Session

MAX_FILE_BYTES = 50 * 1024 * 1024
EXTENSIONS = (".fit", ".gpx", ".tcx")

# Strava activity types (activities.csv "Activity Type", GPX <type>) → FIT sport, sub-sport
_STRAVA_TYPES: dict[str, tuple[str, str]] = {
    "run": ("running", "generic"),
    "running": ("running", "generic"),
    "trail run": ("running", "trail"),
    "trailrun": ("running", "trail"),
    "virtual run": ("running", "treadmill"),
    "virtualrun": ("running", "treadmill"),
    "ride": ("cycling", "generic"),
    "cycling": ("cycling", "generic"),
    "biking": ("cycling", "generic"),
    "virtual ride": ("cycling", "indoor_cycling"),
    "virtualride": ("cycling", "indoor_cycling"),
    "swim": ("swimming", "generic"),
    "swimming": ("swimming", "generic"),
    "hike": ("hiking", "generic"),
    "hiking": ("hiking", "generic"),
    "walk": ("walking", "generic"),
    "walking": ("walking", "generic"),
    "weight training": ("training", "strength_training"),
    "weighttraining": ("training", "strength_training"),
    "yoga": ("training", "yoga"),
}
# Older Strava GPX files carry a numeric activity type
_STRAVA_TYPE_CODES = {"1": "ride", "4": "hike", "9": "run", "10": "walk", "16": "swim"}
# TCX <Activity Sport="...">
_TCX_SPORTS = {"running": "run", "biking": "ride"}


class StravaFileError(ValueError):
    """A file that cannot be imported."""


def classify(activity_type: Optional[str]) -> Optional[tuple[str, str]]:
    """FIT sport and sub-sport for a Strava activity type, or None when it is unknown."""
    if not activity_type:
        return None
    text = activity_type.strip().lower()
    text = _STRAVA_TYPE_CODES.get(text, text)
    if text in _STRAVA_TYPES:
        return _STRAVA_TYPES[text]
    if "ride" in text or "bike" in text:  # Mountain Bike Ride, Gravel Ride, E-Bike Ride, …
        return "cycling", "indoor_cycling" if "virtual" in text else "generic"
    if "run" in text:
        return "running", "trail" if "trail" in text else "generic"
    return None


def decompress(filename: str, content: bytes) -> tuple[str, bytes]:
    """The file's format (``.fit``, ``.gpx`` or ``.tcx``) and its uncompressed bytes."""
    name = filename.lower().strip()
    if name.endswith(".gz"):
        name = name[:-3]
    if content[:2] == b"\x1f\x8b":
        inflater = zlib.decompressobj(zlib.MAX_WBITS | 16)
        try:
            content = inflater.decompress(content, MAX_FILE_BYTES + 1)
        except zlib.error as exc:
            raise StravaFileError(f"Corrupt gzip file: {exc}") from None
        if len(content) > MAX_FILE_BYTES or inflater.unconsumed_tail:
            raise StravaFileError("File is too large")
    for extension in EXTENSIONS:
        if name.endswith(extension):
            return extension, content
    raise StravaFileError("Only .fit, .gpx and .tcx files (optionally gzipped) are accepted")


# ── GPX and TCX ───────────────────────────────────────────────────────────────


def _local(tag: Any) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _child(element: ElementTree.Element, name: str) -> Optional[ElementTree.Element]:
    return next((c for c in element if _local(c.tag) == name), None)


def _text(element: Optional[ElementTree.Element], name: str) -> Optional[str]:
    child = _child(element, name) if element is not None else None
    return child.text.strip() if child is not None and child.text else None


def _float(value: Optional[str]) -> Optional[float]:
    try:
        return float(value) if value not in (None, "") else None
    except ValueError:
        return None


def _time(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def _extension_values(element: ElementTree.Element) -> dict[str, float]:
    """Sensor values from any extension block, keyed by lower-case local tag name."""
    values: dict[str, float] = {}
    for node in element.iter():
        number = _float(node.text.strip()) if node.text and node.text.strip() else None
        if number is not None:
            values.setdefault(_local(node.tag).lower(), number)
    return values


def _parse_xml(content: bytes) -> ElementTree.Element:
    if b"<!DOCTYPE" in content[:4096] or b"<!ENTITY" in content[:4096]:
        raise StravaFileError("XML files with a DOCTYPE are not accepted")
    try:
        return ElementTree.fromstring(content)
    except ElementTree.ParseError as exc:
        raise StravaFileError(f"Invalid XML: {exc}") from None


def _workout(
    name: str, sport: tuple[str, str], points: list[dict], **summary: Any
) -> Workout:
    """A workout from timed points with optional position, altitude and sensor values."""
    points = sorted((p for p in points if p["time"] is not None), key=lambda p: p["time"])
    if len(points) < 2:
        raise StravaFileError("The file has no timed track points")
    start, end = points[0]["time"], points[-1]["time"]
    if end <= start:
        raise StravaFileError("The activity must end after it starts")
    workout = Workout(name=name[:60], start=start, end=end, sport=sport[0], sub_sport=sport[1])
    for key, value in summary.items():
        setattr(workout, key, value)

    previous_distance = None
    for p in points:
        moment = p["time"]
        if p.get("lat") is not None and p.get("lon") is not None:
            workout.route.append(
                RoutePoint(moment, p["lat"], p["lon"], p.get("altitude"), p.get("speed"))
            )
        if p.get("heart_rate"):
            workout.heart_rate.append((moment, p["heart_rate"]))
        if p.get("power") is not None:
            workout.power.append((moment, p["power"]))
        if p.get("cadence") is not None:
            workout.cadence.append((moment, p["cadence"]))
        distance = p.get("distance")
        if distance is not None:
            # Workout distance samples are increments; TCX gives a running total
            if previous_distance is None:
                workout.distance_samples.append((moment, 0.0))
                previous_distance = distance
            elif distance >= previous_distance:
                workout.distance_samples.append((moment, distance - previous_distance))
                previous_distance = distance
    if workout.distance is None and previous_distance:
        workout.distance = previous_distance
    return workout


def parse_gpx(content: bytes, sport: Optional[tuple[str, str]] = None) -> Workout:
    root = _parse_xml(content)
    if _local(root.tag) != "gpx":
        raise StravaFileError("Not a GPX file")
    track = _child(root, "trk")
    if track is None:
        raise StravaFileError("The GPX file has no track")
    name = _text(track, "name") or _text(_child(root, "metadata"), "name") or "Activity"
    sport = sport or classify(_text(track, "type")) or ("generic", "generic")

    points = []
    for segment in (c for c in track if _local(c.tag) == "trkseg"):
        for point in (c for c in segment if _local(c.tag) == "trkpt"):
            extensions = _child(point, "extensions")
            extra = _extension_values(extensions) if extensions is not None else {}
            points.append(
                {
                    "time": _time(_text(point, "time")),
                    "lat": _float(point.get("lat")),
                    "lon": _float(point.get("lon")),
                    "altitude": _float(_text(point, "ele")),
                    "heart_rate": extra.get("hr") or extra.get("heartrate"),
                    "cadence": extra.get("cad") or extra.get("cadence"),
                    "power": extra.get("power") if "power" in extra else extra.get("watts"),
                    "speed": extra.get("speed"),
                }
            )
    return _workout(name, sport, points)


def parse_tcx(content: bytes, sport: Optional[tuple[str, str]] = None) -> Workout:
    root = _parse_xml(content)
    if _local(root.tag) != "TrainingCenterDatabase":
        raise StravaFileError("Not a TCX file")
    activities = _child(root, "Activities")
    activity = _child(activities, "Activity") if activities is not None else None
    if activity is None:
        raise StravaFileError("The TCX file has no activity")
    tcx_sport = (activity.get("Sport") or "").lower()
    sport = sport or classify(_TCX_SPORTS.get(tcx_sport, tcx_sport)) or ("generic", "generic")

    points, timer, distance, calories = [], 0.0, 0.0, 0.0
    for lap in (c for c in activity if _local(c.tag) == "Lap"):
        timer += _float(_text(lap, "TotalTimeSeconds")) or 0.0
        distance += _float(_text(lap, "DistanceMeters")) or 0.0
        calories += _float(_text(lap, "Calories")) or 0.0
        for track in (c for c in lap if _local(c.tag) == "Track"):
            for point in (c for c in track if _local(c.tag) == "Trackpoint"):
                position = _child(point, "Position")
                extensions = _child(point, "Extensions")
                extra = _extension_values(extensions) if extensions is not None else {}
                points.append(
                    {
                        "time": _time(_text(point, "Time")),
                        "lat": _float(_text(position, "LatitudeDegrees")),
                        "lon": _float(_text(position, "LongitudeDegrees")),
                        "altitude": _float(_text(point, "AltitudeMeters")),
                        "distance": _float(_text(point, "DistanceMeters")),
                        "heart_rate": _float(_text(_child(point, "HeartRateBpm"), "Value")),
                        "cadence": _float(_text(point, "Cadence")) or extra.get("runcadence"),
                        "power": extra.get("watts"),
                        "speed": extra.get("speed"),
                    }
                )
    name = _text(activity, "Notes") or _text(activity, "Name") or "Activity"
    return _workout(
        name,
        sport,
        points,
        duration=timer or None,
        distance=distance or None,
        calories=calories or None,
    )


# ── Import ────────────────────────────────────────────────────────────────────


def _fit_start_and_sport(content: bytes) -> tuple[Optional[datetime], SportType]:
    """The start time (naive UTC) and sport of a FIT file, for the duplicate check."""
    import fitparse

    try:
        fit = fitparse.FitFile(io.BytesIO(content))
        for message in fit.get_messages("session"):
            values = message.get_values()
            start = values.get("start_time")
            sport = resolve_sport(values.get("sport"), values.get("sub_sport"))
            return (start if isinstance(start, datetime) else None), sport
    except Exception as exc:
        raise StravaFileError(f"Could not read FIT file: {exc}") from None
    return None, SportType.other


def import_file(
    filename: str,
    content: bytes,
    name: Optional[str] = None,
    activity_type: Optional[str] = None,
    description: Optional[str] = None,
) -> dict[str, Any]:
    """Import one Strava activity file; ``{"status": "imported"|"skipped", "id": ...}``."""
    from app.garmin_sync import import_fit_bytes

    kind, data = decompress(filename, content)
    name = (name or "").strip()[:200] or None
    if kind == ".fit":
        start, sport = _fit_start_and_sport(data)
        fit_bytes = data
    else:
        parse = parse_gpx if kind == ".gpx" else parse_tcx
        workout = parse(data, classify(activity_type))
        start, sport = workout.start, workout.sport_type
        fit_bytes = apple_health.to_fit(workout)

    if start is not None and apple_health.activity_exists_near(start, sport):
        return {"status": "skipped", "id": None}

    activity_id = import_fit_bytes(fit_bytes, name=name)
    description = (description or "").replace("\r\n", "\n").strip()
    if description:
        with Session(engine) as session:
            activity = session.get(Activity, activity_id)
            if activity is not None and not activity.notes:
                activity.notes = description[:5000]
                session.add(activity)
                session.commit()
    logger.info("Strava file {} imported as activity {}", filename, activity_id)
    return {"status": "imported", "id": activity_id}
