"""Apple Health workouts: convert them to FIT files and import them.

Workouts arrive in the JSON format of the Health Auto Export iOS app (export version 2), either
pushed by that app to the webhook or produced by the web app from an Apple Health
``export.zip``. Each workout becomes a FIT file, so the activity page, best efforts and
training charts treat it exactly like a Garmin activity.

A workout is skipped when an activity of the same sport already starts within a minute of it:
that covers workouts sent twice and workouts that also came in from Garmin.
"""

import math
from bisect import bisect_left
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlmodel import col, select

from app import fit_writer
from app.database import engine
from app.errors import UserError, public_message
from app.models import Activity, SportType
from app.ownership import UserSession as Session

DUPLICATE_WINDOW = timedelta(seconds=60)
MAX_WORKOUTS_PER_REQUEST = 200

_LENGTH_UNITS = {"m": 1.0, "km": 1000.0, "mi": 1609.344, "ft": 0.3048, "yd": 0.9144, "cm": 0.01}
_ENERGY_UNITS = {"kcal": 1.0, "cal": 1.0, "kj": 1 / 4.184}
# Running, walking and hiking get 1 km laps, cycling 5 km, like a watch's auto lap
_LAP_METRES = {"running": 1000.0, "walking": 1000.0, "hiking": 1000.0, "cycling": 5000.0}
# How far apart two samples may be for a value to be interpolated between them
_MAX_GAP_SECONDS = 120.0
_FAMILIES = {SportType.trail_running: SportType.running}


class WorkoutError(UserError):
    """A workout that cannot be converted."""


@dataclass
class RoutePoint:
    time: datetime
    lat: float
    lon: float
    altitude: Optional[float] = None
    speed: Optional[float] = None


@dataclass
class Leg:
    """One part of a multisport workout: a swim, ride or run, or a transition."""

    name: str
    start: datetime
    end: datetime
    sport: str = "generic"
    sub_sport: str = "generic"
    distance: Optional[float] = None
    lap_length: Optional[float] = None


@dataclass
class Workout:
    name: str
    start: datetime
    end: datetime
    sport: str = "generic"
    sub_sport: str = "generic"
    duration: Optional[float] = None
    distance: Optional[float] = None
    calories: Optional[float] = None
    ascent: Optional[float] = None
    descent: Optional[float] = None
    avg_heart_rate: Optional[float] = None
    max_heart_rate: Optional[float] = None
    step_cadence: Optional[float] = None  # steps per minute
    lap_length: Optional[float] = None
    route: list[RoutePoint] = field(default_factory=list)
    heart_rate: list[tuple[datetime, float]] = field(default_factory=list)
    distance_samples: list[tuple[datetime, float]] = field(default_factory=list)
    power: list[tuple[datetime, float]] = field(default_factory=list)
    cadence: list[tuple[datetime, float]] = field(default_factory=list)
    # The legs of a multisport workout (Apple's "Swim Bike Run"), in order; empty otherwise
    legs: list[Leg] = field(default_factory=list)

    @property
    def sport_type(self) -> SportType:
        from app.fit_parser import resolve_sport

        return resolve_sport(self.sport, self.sub_sport)


# ── Parsing ───────────────────────────────────────────────────────────────────


def parse_date(value: Any) -> datetime:
    """Parse ``2024-02-06 06:34:12 -0800`` (Health Auto Export) or ISO 8601, as UTC."""
    if not isinstance(value, str) or not value.strip():
        raise WorkoutError(f"Invalid date: {value!r}")
    text = value.strip()
    for parse in (
        lambda s: datetime.strptime(s, "%Y-%m-%d %H:%M:%S %z"),
        lambda s: datetime.fromisoformat(s.replace("Z", "+00:00")),
    ):
        try:
            moment = parse(text)
        except ValueError:
            continue
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
        return moment.astimezone(timezone.utc)
    raise WorkoutError(f"Invalid date: {value!r}")


def _number(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    elif isinstance(value, str):
        try:
            number = float(value)
        except ValueError:
            return None
    else:
        return None
    return number if math.isfinite(number) else None


def _quantity(value: Any, units: Optional[dict[str, float]] = None) -> Optional[float]:
    """A ``{"qty": 5.2, "units": "km"}`` object (or a bare number) in base units."""
    if isinstance(value, dict):
        number = _number(value.get("qty"))
        unit = str(value.get("units") or "").strip().lower()
    else:
        number, unit = _number(value), ""
    if number is None:
        return None
    if units is None or not unit:
        return number
    factor = units.get(unit)
    return number * factor if factor is not None else None


def _length(value: Any) -> Optional[float]:
    return _quantity(value, _LENGTH_UNITS)


def _samples(items: Any, key: str = "qty", units: Optional[dict[str, float]] = None):
    """(time, value) pairs from a list of ``{"date": ..., "qty": ...}`` samples, sorted."""
    samples = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        number = _number(item.get(key))
        if number is None and key != "qty":
            number = _number(item.get("qty"))  # Version 1 heart rate samples
        if number is None:
            continue
        if units is not None:
            factor = units.get(str(item.get("units") or "m").strip().lower())
            if factor is None:
                continue
            number *= factor
        try:
            samples.append((parse_date(item.get("date")), number))
        except WorkoutError:
            continue
    samples.sort(key=lambda sample: sample[0])
    return samples


def _route(items: Any) -> list[RoutePoint]:
    points = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        lat = _number(item.get("latitude", item.get("lat")))
        lon = _number(item.get("longitude", item.get("lon")))
        if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        try:
            moment = parse_date(item.get("timestamp") or item.get("date"))
        except WorkoutError:
            continue
        speed = _number(item.get("speed"))
        points.append(
            RoutePoint(
                moment,
                lat,
                lon,
                _number(item.get("altitude")),
                speed if speed is not None and speed >= 0 else None,
            )
        )
    points.sort(key=lambda point: point.time)
    return points


def classify(name: str, location: str = "", is_indoor: bool = False) -> tuple[str, str]:
    """FIT sport and sub-sport for an Apple workout name such as "Outdoor Run"."""
    text = name.lower()
    place = location.lower()
    indoor = is_indoor or place == "indoor" or "indoor" in text
    if "swim" in text:
        if place == "open water" or "open water" in text:
            return "swimming", "open_water"
        return "swimming", "lap_swimming" if place == "pool" or "pool" in text else "generic"
    if "run" in text and "wheelchair" not in text:
        return "running", "treadmill" if indoor else "generic"
    if any(word in text for word in ("cycl", "bik", "ride")):
        return "cycling", "indoor_cycling" if indoor else "generic"
    if "hik" in text:
        return "hiking", "generic"
    if "walk" in text:
        return "walking", "generic"
    if "strength" in text:
        return "training", "strength_training"
    if "yoga" in text:
        return "training", "yoga"
    return "generic", "generic"


def _legs(items: Any, start: datetime, end: datetime) -> list[Leg]:
    """The legs of a multisport workout, sorted; none unless there are two sport legs."""
    legs = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        try:
            leg_start, leg_end = parse_date(item.get("start")), parse_date(item.get("end"))
        except WorkoutError:
            continue
        leg_start, leg_end = max(leg_start, start), min(leg_end, end)
        if leg_end <= leg_start:
            continue
        name = str(item.get("name") or "").strip()[:60]
        if "transition" in name.lower():
            sport, sub_sport = "transition", "generic"
        else:
            sport, sub_sport = classify(
                name, str(item.get("location") or ""), item.get("isIndoor") is True
            )
        legs.append(
            Leg(
                name=name or sport.capitalize(),
                start=leg_start,
                end=leg_end,
                sport=sport,
                sub_sport=sub_sport,
                distance=_length(item.get("distance")),
                lap_length=_length(item.get("lapLength")),
            )
        )
    legs.sort(key=lambda leg: leg.start)
    sports = [leg for leg in legs if leg.sport not in ("transition", "generic")]
    return legs if len(sports) >= 2 else []


def parse_workout(data: Any) -> Workout:
    """A Health Auto Export workout (version 2; version 1 fields are accepted too)."""
    if not isinstance(data, dict):
        raise WorkoutError("A workout must be an object")
    name = str(data.get("name") or "Workout").strip()[:60] or "Workout"
    start = parse_date(data.get("start"))
    end = parse_date(data.get("end"))
    if end <= start:
        raise WorkoutError("A workout must end after it starts")
    if end - start > timedelta(days=2):
        raise WorkoutError("A workout cannot last more than two days")

    sport, sub_sport = classify(
        name, str(data.get("location") or ""), data.get("isIndoor") is True
    )
    heart = data.get("heartRate") if isinstance(data.get("heartRate"), dict) else {}
    elevation = data.get("elevation") if isinstance(data.get("elevation"), dict) else {}
    # Version 2 sends "activeEnergyBurned"; its "activeEnergy" is a sample list
    energy = data.get("activeEnergyBurned")
    if energy is None and isinstance(data.get("activeEnergy"), dict):
        energy = data["activeEnergy"]
    workout = Workout(
        name=name,
        start=start,
        end=end,
        sport=sport,
        sub_sport=sub_sport,
        duration=_number(data.get("duration")),
        distance=_length(data.get("distance")),
        calories=_quantity(energy, _ENERGY_UNITS),
        ascent=_length(data.get("elevationUp")) or _length(elevation.get("ascent")),
        descent=_length(data.get("elevationDown")),
        avg_heart_rate=_quantity(heart.get("avg") or data.get("avgHeartRate")),
        max_heart_rate=_quantity(heart.get("max") or data.get("maxHeartRate")),
        step_cadence=_quantity(data.get("stepCadence")),
        lap_length=_length(data.get("lapLength")),
        route=_route(data.get("route")),
        heart_rate=_samples(data.get("heartRateData"), key="Avg"),
        power=_samples(data.get("cyclingPower") or data.get("runningPower")),
        cadence=_samples(data.get("cyclingCadence")),
    )
    workout.legs = _legs(data.get("legs"), start, end)
    distance_keys = ("walkingAndRunningDistance", "cyclingDistance", "swimDistance")
    if workout.legs:
        # Each leg counts its distance as its own kind; together they are the event's
        workout.sport, workout.sub_sport = "multisport", "generic"
        workout.distance_samples = sorted(
            sample
            for key in distance_keys
            for sample in _samples(data.get(key), units=_LENGTH_UNITS)
        )
        leg_distances = [leg.distance for leg in workout.legs if leg.distance]
        if leg_distances:
            workout.distance = sum(leg_distances)
    else:
        for key in distance_keys:
            samples = _samples(data.get(key), units=_LENGTH_UNITS)
            if samples:
                workout.distance_samples = samples
                break
    if workout.duration is None or workout.duration <= 0:
        workout.duration = (end - start).total_seconds()
    return workout


# ── Conversion ────────────────────────────────────────────────────────────────


def _haversine(a: RoutePoint, b: RoutePoint) -> float:
    lat1, lat2 = math.radians(a.lat), math.radians(b.lat)
    dlat = lat2 - lat1
    dlon = math.radians(b.lon - a.lon)
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 6371008.8 * math.asin(min(1.0, math.sqrt(h)))


class _Series:
    """Linear interpolation over (seconds, value) samples, without bridging long gaps."""

    def __init__(self, samples: list[tuple[float, float]], max_gap: float = _MAX_GAP_SECONDS):
        self.times = [t for t, _ in samples]
        self.values = [v for _, v in samples]
        self.max_gap = max_gap

    def __bool__(self) -> bool:
        return bool(self.times)

    def at(self, t: float) -> Optional[float]:
        if not self.times:
            return None
        i = bisect_left(self.times, t)
        if i < len(self.times) and self.times[i] == t:
            return self.values[i]
        if i == 0 or i == len(self.times):
            nearest = 0 if i == 0 else len(self.times) - 1
            return self.values[nearest] if abs(self.times[nearest] - t) <= 15 else None
        t0, t1 = self.times[i - 1], self.times[i]
        if t1 - t0 > self.max_gap:
            nearest = i - 1 if t - t0 <= t1 - t else i
            return self.values[nearest] if abs(self.times[nearest] - t) <= 15 else None
        v0, v1 = self.values[i - 1], self.values[i]
        return v0 + (v1 - v0) * (t - t0) / (t1 - t0)


def _seconds(workout: Workout, moment: datetime) -> float:
    return (moment - workout.start).total_seconds()


def _distance_series(workout: Workout) -> Optional[_Series]:
    """Cumulative distance against time, from the distance samples or else the route."""
    if workout.distance_samples:
        total, points = 0.0, [(0.0, 0.0)]
        for moment, metres in workout.distance_samples:
            t = _seconds(workout, moment)
            if t < 0:
                continue
            total += metres
            points.append((t, total))
        points = _dedupe(points)
        return _Series(points, max_gap=math.inf) if len(points) > 1 else None
    if len(workout.route) > 1:
        total, points = 0.0, [(_seconds(workout, workout.route[0].time), 0.0)]
        for previous, point in zip(workout.route, workout.route[1:]):
            total += _haversine(previous, point)
            points.append((_seconds(workout, point.time), total))
        # Match the watch's own total, which corrects GPS noise, unless they disagree wildly
        if workout.distance and total > 0 and 0.8 <= workout.distance / total <= 1.25:
            points = [(t, d * workout.distance / total) for t, d in points]
        return _Series(_dedupe(points), max_gap=math.inf)
    return None


def _dedupe(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Keep the last value per whole second, in time order."""
    by_second: dict[int, float] = {}
    for t, value in points:
        by_second[int(t)] = value
    return sorted((float(t), v) for t, v in by_second.items())


def _timeline(workout: Workout) -> list[int]:
    """Whole seconds since the start at which records are written."""
    if workout.route:
        times = {int(_seconds(workout, p.time)) for p in workout.route}
    else:
        times = {
            int(_seconds(workout, moment))
            for series in (workout.heart_rate, workout.distance_samples, workout.power,
                           workout.cadence)
            for moment, _ in series
        }
        if times:
            times |= {0}
    length = math.ceil((workout.end - workout.start).total_seconds())
    return sorted(t for t in times if 0 <= t <= length)


def _ascent(altitudes: list[Optional[float]], threshold: float = 1.0) -> Optional[float]:
    """Total climb, ignoring wobbles smaller than ``threshold`` metres."""
    values = [a for a in altitudes if a is not None]
    if len(values) < 2:
        return None
    climb, low = 0.0, values[0]
    for value in values[1:]:
        if value < low:
            low = value
        elif value - low >= threshold:
            climb += value - low
            low = value
    return climb


def build_records(workout: Workout) -> list[dict]:
    seconds = _timeline(workout)
    if not seconds:
        return []
    route_by_second: dict[int, RoutePoint] = {}
    for point in workout.route:
        route_by_second[int(_seconds(workout, point.time))] = point
    heart = _Series([(_seconds(workout, m), v) for m, v in workout.heart_rate])
    power = _Series([(_seconds(workout, m), v) for m, v in workout.power])
    cadence = _Series([(_seconds(workout, m), v) for m, v in workout.cadence])
    distance = _distance_series(workout)

    records = []
    for t in seconds:
        point = route_by_second.get(t)
        records.append(
            {
                "t": t,
                "lat": point.lat if point else None,
                "lon": point.lon if point else None,
                "altitude": point.altitude if point else None,
                "speed": point.speed if point else None,
                "heart_rate": heart.at(t),
                "power": power.at(t),
                "cadence": cadence.at(t),
                "distance": distance.at(t) if distance else None,
            }
        )

    # Without a measured speed, derive it from the distance over a few seconds either side
    for i, record in enumerate(records):
        if record["speed"] is not None or record["distance"] is None:
            continue
        before, after = records[max(0, i - 3)], records[min(len(records) - 1, i + 3)]
        if before["distance"] is None or after["distance"] is None:
            continue
        elapsed = after["t"] - before["t"]
        if elapsed > 0:
            record["speed"] = max(0.0, (after["distance"] - before["distance"]) / elapsed)
    return records


def _laps(workout: Workout, records: list[dict]) -> list[tuple[int, int]]:
    """(first, last) record index of each lap: auto laps by distance, or one lap."""
    split = _LAP_METRES.get(workout.sport)
    if not records:
        return []
    if not split or records[-1]["distance"] is None:
        return [(0, len(records) - 1)]
    laps, first, boundary = [], 0, split
    for i, record in enumerate(records):
        if record["distance"] is not None and record["distance"] >= boundary:
            laps.append((first, i))
            first = i
            boundary += split
    if first < len(records) - 1 or not laps:
        laps.append((first, len(records) - 1))
    return laps


def _average(values: list[Optional[float]]) -> Optional[float]:
    present = [v for v in values if v is not None]
    return sum(present) / len(present) if present else None


def _max(values: list[Optional[float]]) -> Optional[float]:
    return max((v for v in values if v is not None), default=None)


def to_fit(workout: Workout) -> bytes:
    """Encode a workout as a FIT activity file."""
    records = build_records(workout)
    sport, sub_sport = fit_writer.sport_codes(workout.sport, workout.sub_sport)
    start, end = workout.start, workout.end
    elapsed = (end - start).total_seconds()
    timer = min(workout.duration or elapsed, elapsed)

    writer = fit_writer.FitWriter()
    writer.write(
        "file_id", type=4, manufacturer=255, product=0, serial_number=1, time_created=start
    )
    writer.write_sport(sport, sub_sport, workout.name)
    writer.write("event", timestamp=start, event=0, event_type=0)
    for record in records:
        lat, lon = record["lat"], record["lon"]
        writer.write(
            "record",
            timestamp=start + timedelta(seconds=record["t"]),
            position_lat=lat * fit_writer.DEG_TO_SEMICIRCLES if lat is not None else None,
            position_long=lon * fit_writer.DEG_TO_SEMICIRCLES if lon is not None else None,
            heart_rate=record["heart_rate"],
            cadence=record["cadence"],
            distance=record["distance"],
            power=record["power"],
            enhanced_speed=record["speed"],
            enhanced_altitude=record["altitude"],
        )
    writer.write("event", timestamp=end, event=0, event_type=4)

    if workout.legs:
        _write_legs(writer, workout, records, timer)
        return writer.to_bytes()

    laps = _laps(workout, records)
    for index, (first, last) in enumerate(laps):
        chunk = records[first : last + 1]
        lap_start = start + timedelta(seconds=chunk[0]["t"]) if index else start
        lap_end = start + timedelta(seconds=chunk[-1]["t"]) if index < len(laps) - 1 else end
        lap_seconds = (lap_end - lap_start).total_seconds()
        lap_distance = None
        if chunk[-1]["distance"] is not None and chunk[0]["distance"] is not None:
            lap_distance = chunk[-1]["distance"] - (chunk[0]["distance"] if index else 0.0)
            if index == len(laps) - 1 and workout.distance and len(laps) > 1:
                lap_distance = max(lap_distance, workout.distance - chunk[0]["distance"])
        writer.write(
            "lap",
            timestamp=lap_end,
            message_index=index,
            event=9,
            event_type=1,
            start_time=lap_start,
            total_elapsed_time=lap_seconds,
            total_timer_time=lap_seconds,
            total_distance=lap_distance,
            avg_speed=lap_distance / lap_seconds if lap_distance and lap_seconds > 0 else None,
            avg_heart_rate=_average([r["heart_rate"] for r in chunk]),
            max_heart_rate=_max([r["heart_rate"] for r in chunk]),
            total_ascent=_ascent([r["altitude"] for r in chunk]),
            sport=sport,
        )

    distance = workout.distance
    if distance is None and records and records[-1]["distance"] is not None:
        distance = records[-1]["distance"]
    speeds = [r["speed"] for r in records]
    step_sport = workout.sport in ("running", "walking", "hiking")
    cadence = workout.step_cadence / 2 if step_sport and workout.step_cadence else None
    writer.write(
        "session",
        timestamp=end,
        message_index=0,
        event=8,
        event_type=1,
        start_time=start,
        sport=sport,
        sub_sport=sub_sport,
        total_elapsed_time=elapsed,
        total_timer_time=timer,
        total_distance=distance,
        total_calories=workout.calories,
        avg_speed=distance / timer if distance and timer > 0 else None,
        max_speed=_max(speeds),
        avg_heart_rate=workout.avg_heart_rate or _average([r["heart_rate"] for r in records]),
        max_heart_rate=workout.max_heart_rate or _max([r["heart_rate"] for r in records]),
        avg_cadence=cadence or _average([r["cadence"] for r in records]),
        avg_power=_average([r["power"] for r in records]),
        total_ascent=workout.ascent
        if workout.ascent is not None
        else _ascent([r["altitude"] for r in records]),
        total_descent=workout.descent,
        first_lap_index=0,
        num_laps=len(laps),
        pool_length=workout.lap_length if workout.sub_sport == "lap_swimming" else None,
    )
    writer.write(
        "activity",
        timestamp=end,
        total_timer_time=timer,
        num_sessions=1,
        type=0,
        event=26,
        event_type=1,
    )
    return writer.to_bytes()


def _segments(workout: Workout) -> list[Leg]:
    """The legs, with a transition filling every gap between two of them."""
    segments: list[Leg] = []
    for leg in workout.legs:
        previous_end = segments[-1].end if segments else workout.start
        if (leg.start - previous_end).total_seconds() >= 1:
            segments.append(Leg("Transition", previous_end, leg.start, "transition"))
        segments.append(leg)
    return segments


def _write_legs(
    writer: fit_writer.FitWriter, workout: Workout, records: list[dict], timer: float
) -> None:
    """One lap and one session per leg and transition, tagged as a multisport activity, so
    the parser turns it into an event with its legs, like a watch's triathlon."""
    start = workout.start
    segments = _segments(workout)
    sport_seconds = sum(
        (leg.end - leg.start).total_seconds() for leg in segments if leg.sport != "transition"
    )
    for index, leg in enumerate(segments):
        first = (leg.start - start).total_seconds()
        last = (leg.end - start).total_seconds()
        chunk = [r for r in records if first <= r["t"] <= last]
        seconds = last - first
        distance = leg.distance
        known = [r["distance"] for r in chunk if r["distance"] is not None]
        if distance is None and len(known) > 1:
            distance = known[-1] - known[0]
        if leg.sport == "transition":
            distance = None
        # Apple keeps the energy of the whole workout; share it out over the legs by time
        calories = None
        if workout.calories and sport_seconds > 0 and leg.sport != "transition":
            calories = workout.calories * seconds / sport_seconds
        sport, sub_sport = fit_writer.sport_codes(leg.sport, leg.sub_sport)
        heart = [r["heart_rate"] for r in chunk]
        common = dict(
            timestamp=leg.end,
            message_index=index,
            start_time=leg.start,
            total_elapsed_time=seconds,
            total_timer_time=seconds,
            total_distance=distance,
            avg_speed=distance / seconds if distance and seconds > 0 else None,
            avg_heart_rate=_average(heart),
            max_heart_rate=_max(heart),
            total_ascent=_ascent([r["altitude"] for r in chunk]),
            sport=sport,
        )
        writer.write("lap", event=9, event_type=1, **common)
        writer.write(
            "session",
            event=8,
            event_type=1,
            sub_sport=sub_sport,
            total_calories=calories,
            max_speed=_max([r["speed"] for r in chunk]),
            avg_power=_average([r["power"] for r in chunk]),
            first_lap_index=index,
            num_laps=1,
            pool_length=leg.lap_length if leg.sub_sport == "lap_swimming" else None,
            **common,
        )
    writer.write(
        "activity",
        timestamp=workout.end,
        total_timer_time=timer,
        num_sessions=len(segments),
        type=1,  # auto_multi_sport
        event=26,
        event_type=1,
    )


# ── Import ────────────────────────────────────────────────────────────────────


def _family(sport: SportType) -> SportType:
    return _FAMILIES.get(sport, sport)


MULTISPORT = (SportType.triathlon, SportType.duathlon, SportType.multisport)


def is_duplicate(workout: Workout) -> bool:
    """Whether an activity of the same sport already starts within a minute of the workout."""
    if workout.legs:
        return any(activity_exists_near(workout.start, sport) for sport in MULTISPORT)
    return activity_exists_near(workout.start, workout.sport_type)


def activity_exists_near(start: datetime, sport: SportType) -> bool:
    """Whether an activity of the same sport family starts within a minute of ``start``."""
    if start.tzinfo is not None:
        start = start.astimezone(timezone.utc)
    start = start.replace(tzinfo=None)  # stored as naive UTC
    family = _family(sport)
    with Session(engine) as session:
        sports = session.exec(
            select(Activity.sport).where(
                col(Activity.date) >= start - DUPLICATE_WINDOW,
                col(Activity.date) <= start + DUPLICATE_WINDOW,
            )
        ).all()
    return any(_family(SportType(sport)) == family for sport in sports)


def import_workouts(items: Any) -> dict:
    """Convert and import a list of workouts; returns counts and per-workout errors."""
    from app.garmin_sync import import_fit_bytes

    if not isinstance(items, list):
        raise WorkoutError("Expected a list of workouts")
    if len(items) > MAX_WORKOUTS_PER_REQUEST:
        raise WorkoutError(f"Send at most {MAX_WORKOUTS_PER_REQUEST} workouts per request")
    result: dict[str, Any] = {"imported": [], "skipped": 0, "errors": []}
    for index, item in enumerate(items):
        try:
            workout = parse_workout(item)
            if is_duplicate(workout):
                result["skipped"] += 1
                continue
            result["imported"].append(import_fit_bytes(to_fit(workout)))
        except Exception as exc:  # one bad workout must not stop the rest
            label = item.get("name") if isinstance(item, dict) else None
            message = public_message(
                exc, "Could not import this workout", f"Apple Health workout {index} not imported"
            )
            result["errors"].append({"index": index, "name": label, "error": message[:200]})
    return result


def workouts_from_payload(payload: Any) -> list:
    """The workouts of a Health Auto Export payload (``{"data": {"workouts": [...]}}``)."""
    if isinstance(payload, dict):
        data = payload.get("data", payload)
        if isinstance(data, dict):
            workouts = data.get("workouts", [])
            if isinstance(workouts, list):
                return workouts
    raise WorkoutError('Expected a JSON body like {"data": {"workouts": [...]}}')
