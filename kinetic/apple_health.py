"""Import workout summaries from Apple Health exports without retaining the export."""

import hashlib
import json
import math
import zipfile
from collections.abc import Callable
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path, PurePosixPath
from typing import BinaryIO
from xml.etree.ElementTree import Element, ParseError

from defusedxml.common import DefusedXmlException
from defusedxml.ElementTree import iterparse
from sqlmodel import Session, select

from kinetic.database import engine
from kinetic.models import Activity, SportType

MAX_UPLOAD_BYTES = 250 * 1024 * 1024
MAX_XML_BYTES = 1024 * 1024 * 1024

_SPORTS = {
    "Running": SportType.running,
    "Cycling": SportType.cycling,
    "Swimming": SportType.swimming,
    "Hiking": SportType.hiking,
    "Walking": SportType.walking,
    "TraditionalStrengthTraining": SportType.strength,
    "FunctionalStrengthTraining": SportType.strength,
    "Yoga": SportType.yoga,
    "Triathlon": SportType.triathlon,
}
_DISTANCE_TYPES = {
    "HKQuantityTypeIdentifierDistanceWalkingRunning",
    "HKQuantityTypeIdentifierDistanceCycling",
    "HKQuantityTypeIdentifierDistanceSwimming",
    "HKQuantityTypeIdentifierDistanceWheelchair",
}
_DISTANCE_UNITS = {"m": 1, "km": 1000, "mi": 1609.344, "yd": 0.9144, "ft": 0.3048}
_TIME_UNITS = {"s": 1, "sec": 1, "min": 60, "h": 3600, "hr": 3600}
_ENERGY_UNITS = {"kcal": 1, "Cal": 1, "kJ": 1 / 4.184, "J": 1 / 4184}


@contextmanager
def _export_stream(path: Path):
    if path.stat().st_size > MAX_UPLOAD_BYTES:
        raise ValueError("The Apple Health export exceeds the 250 MB upload limit.")
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as archive:
            matches = [
                info
                for info in archive.infolist()
                if PurePosixPath(info.filename).name == "export.xml" and not info.is_dir()
            ]
            if len(matches) != 1:
                raise ValueError("The ZIP must contain exactly one Apple Health export.xml file.")
            if matches[0].file_size > MAX_XML_BYTES:
                raise ValueError("The uncompressed Apple Health XML exceeds the 1 GB limit.")
            with archive.open(matches[0]) as stream:
                yield stream
    elif path.suffix.lower() == ".xml":
        with path.open("rb") as stream:
            yield stream
    else:
        raise ValueError("Select an Apple Health .zip or .xml export.")


def _quantity(value: str, unit: str, units: dict[str, float]) -> float:
    if unit not in units:
        raise ValueError(f"Unsupported workout unit: {unit}")
    number = float(value) * units[unit]
    if not math.isfinite(number) or number < 0:
        raise ValueError("Workout quantities must be finite and non-negative.")
    return number


def _timestamp(value: str) -> datetime:
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d %H:%M:%S %z")
    except ValueError:
        parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise ValueError("Workout timestamps must include a timezone.")
    return parsed.astimezone(timezone.utc)


def _workout_activity(workout: Element) -> Activity:
    attributes = workout.attrib
    start = _timestamp(attributes["startDate"])
    end = _timestamp(attributes["endDate"])
    if end < start:
        raise ValueError("Workout ends before it starts.")
    duration = _quantity(attributes["duration"], attributes.get("durationUnit", "min"), _TIME_UNITS)
    metadata = {item.get("key"): item.get("value") for item in workout.findall("MetadataEntry")}
    external_id = metadata.get("HKExternalUUID") or metadata.get("HKMetadataKeyExternalUUID")
    identity = (
        [external_id]
        if external_id
        else [
            attributes["workoutActivityType"],
            start.isoformat(),
            end.isoformat(),
            attributes.get("sourceName", ""),
        ]
    )
    workout_id = hashlib.sha256(json.dumps(identity).encode()).hexdigest()
    kind = attributes["workoutActivityType"].removeprefix("HKWorkoutActivityType")
    distance = None
    calories = None
    avg_heart_rate = None
    max_heart_rate = None
    if attributes.get("totalDistance"):
        distance = _quantity(
            attributes["totalDistance"], attributes.get("totalDistanceUnit", "km"), _DISTANCE_UNITS
        )
    if attributes.get("totalEnergyBurned"):
        calories = _quantity(
            attributes["totalEnergyBurned"],
            attributes.get("totalEnergyBurnedUnit", "kcal"),
            _ENERGY_UNITS,
        )
    for statistic in workout.findall("WorkoutStatistics"):
        values = statistic.attrib
        quantity_type = values.get("type")
        if distance is None and quantity_type in _DISTANCE_TYPES and values.get("sum"):
            distance = _quantity(values["sum"], values.get("unit", ""), _DISTANCE_UNITS)
        if calories is None and quantity_type == "HKQuantityTypeIdentifierActiveEnergyBurned":
            if values.get("sum"):
                calories = _quantity(values["sum"], values.get("unit", ""), _ENERGY_UNITS)
        if (
            quantity_type == "HKQuantityTypeIdentifierHeartRate"
            and values.get("unit") == "count/min"
        ):
            if values.get("average"):
                avg_heart_rate = round(_quantity(values["average"], "count/min", {"count/min": 1}))
            if values.get("maximum"):
                max_heart_rate = round(_quantity(values["maximum"], "count/min", {"count/min": 1}))
    return Activity(
        name=f"Apple Health {kind}",
        sport=_SPORTS.get(kind, SportType.other),
        date=start,
        duration_seconds=duration,
        distance_meters=distance,
        calories=round(calories) if calories is not None else None,
        avg_heart_rate=avg_heart_rate,
        max_heart_rate=max_heart_rate,
        avg_speed_ms=distance / duration if distance is not None and duration else None,
        apple_health_workout_id=workout_id,
    )


def _import_stream(
    stream: BinaryIO,
    since: date,
    until: date,
    progress_cb: Callable[[str], None] | None,
) -> dict:
    result = {"imported": 0, "skipped": 0, "errors": []}
    parser = iterparse(stream, events=("start", "end"))
    try:
        _, root = next(parser)
    except StopIteration:
        raise ValueError("The Apple Health export is empty.") from None
    if root.tag != "HealthData":
        raise ValueError("This XML is not an Apple Health export.")
    depth = 1
    scanned = 0
    with Session(engine) as db:
        for event, element in parser:
            if event == "start":
                depth += 1
                continue
            if depth == 2:
                if element.tag == "Workout":
                    scanned += 1
                    try:
                        activity = _workout_activity(element)
                        if not since <= activity.date.date() <= until:
                            result["skipped"] += 1
                        elif (
                            db.exec(
                                select(Activity.id).where(
                                    Activity.apple_health_workout_id
                                    == activity.apple_health_workout_id
                                )
                            ).first()
                            is not None
                        ):
                            result["skipped"] += 1
                        else:
                            db.add(activity)
                            db.flush()
                            result["imported"] += 1
                    except (ValueError, KeyError, OverflowError):
                        if len(result["errors"]) < 50:
                            result["errors"].append(
                                f"Workout {scanned} has invalid or unsupported data."
                            )
                    if progress_cb and scanned % 100 == 0:
                        progress_cb(f"Processed {scanned} workouts...")
                element.clear()
                root.clear()
            depth -= 1
        db.commit()
    if progress_cb:
        progress_cb(f"Processed {scanned} workouts.")
    return result


def import_workouts(
    path: Path,
    since: date,
    until: date | None = None,
    progress_cb: Callable[[str], None] | None = None,
) -> dict:
    until = until or date.today()
    if since > until:
        raise ValueError("The end date must be on or after the start date.")
    try:
        with _export_stream(path) as stream:
            return _import_stream(stream, since, until, progress_cb)
    except (ParseError, DefusedXmlException, zipfile.BadZipFile, RuntimeError):
        raise ValueError("The Apple Health export is invalid, encrypted, or unsafe.") from None
