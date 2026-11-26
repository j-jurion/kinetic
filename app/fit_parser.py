import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from app.formatting import DATE_FORMAT
from app.models import Activity, ActivityKind, BestEffort, Lap, SportType

_SEMICIRCLES_TO_DEG = 180.0 / (2**31)

# Standard best-effort distances per sport (meters)
_RUNNING_DISTANCES = [1000, 5000, 10000, 15000, 30000, 21097.5, 42195]
BEST_EFFORT_DISTANCES: dict[SportType, list[float]] = {
    SportType.running: _RUNNING_DISTANCES,
    SportType.trail_running: _RUNNING_DISTANCES,
    SportType.cycling: [1000, 5000, 10000, 20000, 40000, 50000, 100000],
    SportType.swimming: [100, 200, 400, 800, 1500, 3000],
}

SPORT_MAP: dict[str, SportType] = {
    "running": SportType.running,
    "trail_running": SportType.trail_running,
    "cycling": SportType.cycling,
    "biking": SportType.cycling,
    "swimming": SportType.swimming,
    "hiking": SportType.hiking,
    "walking": SportType.walking,
    "open_water_swimming": SportType.swimming,
    "triathlon": SportType.triathlon,
    "strength_training": SportType.strength,
}

# A length faster than the 100 m freestyle world record (~2.13 m/s) is a device artifact
_MAX_SWIM_SPEED_MS = 2.2
# How far a measuring window may overshoot its target distance before it is unusable
_MAX_OVERSHOOT = 0.05
# A best effort faster than the world record over 1 km is a data artifact (running: 2:11.96,
# 7.58 m/s; cycling: well above any 1 km time trial, even downhill)
MAX_EFFORT_SPEED_MS: dict[SportType, float] = {
    SportType.running: 7.6,
    SportType.trail_running: 7.6,
    SportType.cycling: 25.0,
    SportType.swimming: _MAX_SWIM_SPEED_MS,
}
# In files Kinetic writes itself (Apple Health and Strava imports), distance comes from raw
# GPS or batched samples. Faster than this between two points is a jump in that data, not
# movement: a GPS fix that lands far away, or distance that arrives in one batch after a
# pause. A watch's own distance is filtered on the watch; its catch-up after a GPS gap (tens
# of metres in a second) is real distance and is kept.
_MAX_STEP_SPEED_MS: dict[SportType, float] = {
    SportType.running: 12.0,
    SportType.trail_running: 12.0,
    SportType.cycling: 35.0,
}


def moving_duration(summary: dict, sport: Optional[SportType] = None) -> float:
    """The time of a session or lap without its pauses: the timer time, when it is usable.

    Watches and apps stop the timer when the athlete pauses (or auto-pause kicks in), so the
    timer time is what they show as the workout's time and base its pace on. The elapsed time
    also counts the pauses, and can run on for weeks: a Garmin activity saved with "resume
    later", or a watch whose clock jumped, shows hundreds of hours for an hour's ride. The
    elapsed time is used only when the file has no timer time, or when the timer time cannot
    be right: longer than the elapsed time, or faster than a world record over the distance.
    (Open-water swims, where the watch pauses itself under water, are handled by
    ``activity_duration``.)
    """
    elapsed = float(summary.get("total_elapsed_time") or 0)
    timer = float(summary.get("total_timer_time") or 0)
    if timer <= 0 or elapsed <= 0:
        return timer or elapsed
    if timer > elapsed:
        return elapsed
    distance = float(summary.get("total_distance") or 0)
    limit = MAX_EFFORT_SPEED_MS.get(sport) if sport else None
    if limit and distance / timer > limit:
        return elapsed
    return timer


def activity_duration(summary: dict, sport: SportType, session: dict) -> float:
    """The duration of a single-sport activity, or of one of its laps (``summary``).

    Pace and duration leave out the pauses, as on the watch or app that recorded it. Not in
    open water: there the watch pauses by itself whenever the wrist is under water.
    """
    if str(session.get("sub_sport", "")).lower() == "open_water":
        return float(summary.get("total_elapsed_time") or summary.get("total_timer_time") or 0)
    return moving_duration(summary, sport)


# FIT sub_sport values that refine the recorded sport
SUB_SPORT_MAP: dict[tuple[str, str], SportType] = {
    ("running", "trail"): SportType.trail_running,
    ("training", "strength_training"): SportType.strength,
    ("training", "yoga"): SportType.yoga,
}


def resolve_sport(sport_raw: Optional[str], sub_sport_raw: Optional[str] = None) -> SportType:
    """Map a FIT sport (refined by its sub_sport) onto a SportType."""
    sport = str(sport_raw or "other").lower()
    sub_sport = str(sub_sport_raw or "").lower()
    refined = SUB_SPORT_MAP.get((sport, sub_sport))
    if refined:
        return refined
    return SPORT_MAP.get(sport, SportType.other)


def _safe_val(record: dict, key: str) -> Optional[float | int | str | datetime]:
    v = record.get(key)
    return getattr(v, "value", v)


def parse_fit_file(
    fit_path: Path,
) -> tuple[
    Activity, list[Lap], list[BestEffort], list[tuple[Activity, list[Lap], list[BestEffort]]]
]:
    """Parse a .fit file.

    Returns (activity, laps, best_efforts, children).
    For single-sport files children == [].
    For multi-sport (triathlon) files the parent activity has sport=triathlon and children
    holds one entry per non-transition sub-sport.
    """
    try:
        import fitparse
    except ImportError as e:
        raise RuntimeError("fitparse not installed") from e

    fitfile = fitparse.FitFile(str(fit_path))

    is_multisport = False
    activity_name_hint: str | None = None
    sessions_data: list[dict] = []
    lap_records: list[dict] = []
    length_records: list[dict] = []
    data_points: list[dict] = []

    written_by_kinetic = False
    message: Any
    for message in fitfile.get_messages():
        msg_name = message.name
        record = {f.name: f for f in message.fields}

        if msg_name == "file_id":
            written_by_kinetic = _safe_val(record, "manufacturer") in ("development", 255)
        elif msg_name == "session":
            sessions_data.append({k: _safe_val(record, k) for k in record})
        elif msg_name == "activity":
            atype = _safe_val(record, "type")
            if atype == "auto_multi_sport":
                is_multisport = True
            name_val = _safe_val(record, "name")
            if name_val:
                activity_name_hint = str(name_val)
        elif msg_name == "sport":
            if not activity_name_hint:
                name_val = _safe_val(record, "name")
                if name_val:
                    activity_name_hint = str(name_val)
        elif msg_name == "lap":
            lap_records.append({k: _safe_val(record, k) for k in record})
        elif msg_name == "length":
            length_records.append({k: _safe_val(record, k) for k in record})
        elif msg_name == "record":
            data_points.append({k: _safe_val(record, k) for k in record})

    if written_by_kinetic and sessions_data:
        main = _main_session(sessions_data)
        cap = _MAX_STEP_SPEED_MS.get(resolve_sport(main.get("sport"), main.get("sub_sport")))
        if cap is not None:
            _remove_distance_jumps(data_points, cap)

    if _is_multisport(sessions_data, flagged=is_multisport):
        return _build_multisport(fit_path, sessions_data, lap_records, data_points)

    # ── Single-sport path ─────────────────────────────────────────────────────
    session_data = _main_session(sessions_data)
    activity, laps, best_efforts = _build_single_activity(
        fit_path, session_data, lap_records, data_points, activity_name_hint, length_records
    )
    return activity, laps, best_efforts, []


def _build_single_activity(
    fit_path: Path,
    session_data: dict,
    lap_records: list[dict],
    data_points: list[dict],
    activity_name_hint: str | None,
    length_records: Optional[list[dict]] = None,
) -> tuple[Activity, list[Lap], list[BestEffort]]:
    sport_raw = str(session_data.get("sport", "other")).lower()
    sport = resolve_sport(sport_raw, session_data.get("sub_sport"))

    start_time = session_data.get("start_time")
    if isinstance(start_time, str):
        start_time = datetime.fromisoformat(start_time)

    activity_date = start_time or datetime.now(timezone.utc)
    date_str = activity_date.strftime(DATE_FORMAT)
    if activity_name_hint:
        activity_name = f"{activity_name_hint} {date_str}"
    else:
        activity_name = f"{sport.value.capitalize()} {date_str}"

    duration = activity_duration(session_data, sport, session_data)
    distance_m = session_data.get("total_distance")
    elevation = session_data.get("total_ascent")
    avg_hr = session_data.get("avg_heart_rate")
    max_hr = session_data.get("max_heart_rate")
    avg_speed = session_data.get("avg_speed") or session_data.get("enhanced_avg_speed")
    max_speed = session_data.get("max_speed") or session_data.get("enhanced_max_speed")
    avg_cadence = session_data.get("avg_cadence") or session_data.get("avg_running_cadence")
    avg_power = session_data.get("avg_power")
    calories = session_data.get("total_calories")

    activity = Activity(
        name=activity_name,
        sport=sport,
        kind=ActivityKind.training,
        date=activity_date,
        duration_seconds=duration,
        distance_meters=float(distance_m) if distance_m is not None else None,
        elevation_gain_meters=float(elevation) if elevation is not None else None,
        avg_heart_rate=int(avg_hr) if avg_hr is not None else None,
        max_heart_rate=int(max_hr) if max_hr is not None else None,
        avg_speed_ms=float(avg_speed) if avg_speed is not None else None,
        max_speed_ms=float(max_speed) if max_speed is not None else None,
        avg_cadence=int(avg_cadence) if avg_cadence is not None else None,
        avg_power=int(avg_power) if avg_power is not None else None,
        calories=int(calories) if calories is not None else None,
        fit_file_path=str(fit_path),
    )

    laps: list[Lap] = []
    for i, lr in enumerate(lap_records):
        laps.append(
            Lap(
                activity_id=0,  # filled after DB insert
                lap_number=i + 1,
                start_time=lr.get("start_time"),
                duration_seconds=activity_duration(lr, sport, session_data) or None,
                distance_meters=float(lr["total_distance"]) if lr.get("total_distance") else None,
                avg_speed_ms=float(lr["avg_speed"]) if lr.get("avg_speed") else None,
                avg_heart_rate=int(lr["avg_heart_rate"]) if lr.get("avg_heart_rate") else None,
                elevation_gain=float(lr["total_ascent"]) if lr.get("total_ascent") else None,
            )
        )

    best_efforts = _extract_best_efforts(activity, data_points)
    if not best_efforts and length_records:
        # Pool swims keep no distance in the record stream — rebuild it from the lengths
        best_efforts = best_efforts_from_segments(
            activity, pool_swim_segments(length_records, session_data.get("pool_length"))
        )
    _attach_route(activity, data_points)
    return activity, laps, best_efforts


def _is_multisport(sessions: list[dict], flagged: bool = False) -> bool:
    """Whether the sessions describe one event made of several legs.

    It takes at least two legs (sessions other than transitions). Watches tag a file as
    ``auto_multi_sport`` (``flagged``) whenever a multisport activity profile was used, even
    when only one leg was recorded, so the tag alone is not enough: a single swim or run
    is a normal activity. Starting each leg by hand produces a ``manual`` activity with one
    session per leg, so the sessions themselves have to be inspected: a transition leg or
    two different sports mean multisport, while repeated sessions of the same sport (a
    paused or resumed workout) do not, unless the watch tagged them as multisport.
    """
    sports = [str(s.get("sport", "")).lower() for s in sessions if s.get("sport")]
    legs = [sport for sport in sports if sport != "transition"]
    if len(legs) < 2:
        return False
    return flagged or len(set(legs)) > 1 or "transition" in sports


def _main_session(sessions: list[dict]) -> dict:
    """The session of a single-sport file: the longest one that is not a transition."""
    legs = [s for s in sessions if str(s.get("sport", "")).lower() != "transition"] or sessions
    if not legs:
        return {}
    return max(
        legs, key=lambda s: float(s.get("total_elapsed_time") or s.get("total_timer_time") or 0)
    )


def _detect_multisport_type(sport_sessions: list[dict]) -> SportType:
    sub_sports = {str(s.get("sport", "")).lower() for s in sport_sessions}
    has_swim = "swimming" in sub_sports or "open_water_swimming" in sub_sports
    has_cycle = "cycling" in sub_sports or "biking" in sub_sports
    has_run = "running" in sub_sports
    if has_swim and has_cycle and has_run:
        return SportType.triathlon
    if has_run and has_cycle and not has_swim:
        return SportType.duathlon
    return SportType.multisport


def _build_multisport(
    fit_path: Path,
    sessions: list[dict],
    lap_records: list[dict],
    data_points: list[dict],
) -> tuple[
    Activity, list[Lap], list[BestEffort], list[tuple[Activity, list[Lap], list[BestEffort]]]
]:
    """Build a multisport parent activity and its non-transition children."""
    # Determine start time from the first session
    first_start = sessions[0].get("start_time") if sessions else None
    if isinstance(first_start, str):
        first_start = datetime.fromisoformat(first_start)
    activity_date = first_start or datetime.now(timezone.utc)
    date_str = activity_date.strftime(DATE_FORMAT)

    sport_sessions = [s for s in sessions if str(s.get("sport", "")).lower() != "transition"]

    parent_sport = _detect_multisport_type(sport_sessions)
    activity_label = {
        SportType.triathlon: "Triathlon",
        SportType.duathlon: "Duathlon",
        SportType.multisport: "Multisport",
    }[parent_sport]

    # Elapsed time, unlike single activities: a leg's timer stops when the watch auto-pauses
    # (an open-water swim can show a minute of timer time), but the race clock does not.
    total_time = sum(
        float(s.get("total_elapsed_time") or s.get("total_timer_time") or 0) for s in sessions
    )
    total_dist = sum(float(s.get("total_distance") or 0) for s in sport_sessions)
    total_elev = sum(float(s.get("total_ascent") or 0) for s in sessions)
    total_cals = sum(int(s.get("total_calories") or 0) for s in sessions)

    parent = Activity(
        name=f"{activity_label} {date_str}",
        sport=parent_sport,
        kind=ActivityKind.training,
        date=activity_date,
        duration_seconds=total_time,
        distance_meters=total_dist if total_dist else None,
        elevation_gain_meters=total_elev if total_elev else None,
        calories=total_cals if total_cals else None,
        fit_file_path=str(fit_path),
    )
    _attach_route(parent, data_points)

    children: list[tuple[Activity, list[Lap], list[BestEffort]]] = []
    for session in sessions:
        sport_raw = str(session.get("sport", "other")).lower()
        if sport_raw == "transition":
            continue

        sport = resolve_sport(sport_raw, session.get("sub_sport"))
        start_time = session.get("start_time")
        if isinstance(start_time, str):
            start_time = datetime.fromisoformat(start_time)

        duration = float(session.get("total_elapsed_time") or session.get("total_timer_time") or 0)
        sub_label = session.get("unknown_110") or sport.value.capitalize()
        child_name = f"{sub_label} {date_str}"

        child = Activity(
            name=child_name,
            sport=sport,
            kind=ActivityKind.training,
            date=start_time or activity_date,
            duration_seconds=duration,
            distance_meters=float(session["total_distance"])
            if session.get("total_distance")
            else None,
            elevation_gain_meters=float(session["total_ascent"])
            if session.get("total_ascent")
            else None,
            avg_heart_rate=int(session["avg_heart_rate"])
            if session.get("avg_heart_rate")
            else None,
            max_heart_rate=int(session["max_heart_rate"])
            if session.get("max_heart_rate")
            else None,
            avg_speed_ms=float(session.get("enhanced_avg_speed") or session.get("avg_speed") or 0)
            or None,
            avg_cadence=int(session.get("avg_running_cadence") or session.get("avg_cadence") or 0)
            or None,
            avg_power=int(session["avg_power"]) if session.get("avg_power") else None,
            calories=int(session["total_calories"]) if session.get("total_calories") else None,
            fit_file_path=str(fit_path),
        )

        # Partition GPS points by session time window
        if start_time:
            end_ts = start_time.timestamp() + duration + 60
            start_ts = start_time.timestamp() - 5
            session_dps = [
                dp
                for dp in data_points
                if dp.get("timestamp") and start_ts <= dp["timestamp"].timestamp() <= end_ts
            ]
        else:
            session_dps = data_points

        _attach_route(child, session_dps)
        child_bes = _extract_best_efforts(child, session_dps)
        children.append((child, [], child_bes))

    return parent, [], [], children


def _attach_route(activity: Activity, data_points: list[dict]) -> None:
    coords: list[tuple[float, float]] = []
    for dp in data_points:
        lat = dp.get("position_lat")
        lon = dp.get("position_long")
        if lat is not None and lon is not None:
            coords.append(
                (round(lat * _SEMICIRCLES_TO_DEG, 6), round(lon * _SEMICIRCLES_TO_DEG, 6))
            )
    if coords:
        if len(coords) > 2000:
            step = len(coords) / 2000
            coords = [coords[int(i * step)] for i in range(2000)]
        activity.route_json = json.dumps(coords)


def pool_swim_segments(
    length_records: list[dict], pool_length: Optional[float]
) -> list[list[dict]]:
    """Rebuild (timestamp, cumulative distance) runs for a pool swim.

    Pool swim files record distance per length instead of in the record stream, so the
    series is reconstructed by adding one pool length per active length. Rest ("idle")
    lengths advance the clock without adding distance, exactly as they should.

    Watches sometimes split a length in two on a false turn, crediting a full length to a
    few seconds of swimming. Such a length is dropped and ends the current run, so no
    measuring window can span the stretch whose distance cannot be trusted.
    """
    if not pool_length or not length_records:
        return []

    def start_of(item: dict) -> Optional[datetime]:
        value = item.get("start_time") or item.get("timestamp")
        if isinstance(value, str):
            return datetime.fromisoformat(value)
        return value if isinstance(value, datetime) else None

    ordered = sorted(
        (item for item in length_records if start_of(item) is not None),
        key=lambda item: start_of(item),  # type: ignore[arg-type, return-value]
    )

    segments: list[list[dict]] = []
    current: list[dict] = []
    distance = 0.0
    for item in ordered:
        start = start_of(item)
        if start is None:
            continue
        elapsed = float(item.get("total_elapsed_time") or item.get("total_timer_time") or 0)
        active = str(item.get("length_type", "")).lower() == "active"
        if active and (elapsed <= 0 or float(pool_length) / elapsed > _MAX_SWIM_SPEED_MS):
            if len(current) > 1:
                segments.append(current)
            current, distance = [], 0.0
            continue
        if not current:
            current.append({"timestamp": start, "distance": 0.0})
        if active:
            distance += float(pool_length)
        current.append({"timestamp": start + timedelta(seconds=elapsed), "distance": distance})
    if len(current) > 1:
        segments.append(current)
    return segments


def _remove_distance_jumps(data_points: list[dict], max_speed: float) -> None:
    """Let no step add more distance than ``max_speed`` covers in its time, in place.

    What a jump added is taken off every later point, so the rest of the activity keeps its
    own pace and a window across the jump measures only the running around it.
    """
    removed = 0.0
    previous: Optional[tuple[float, float]] = None
    for dp in data_points:
        t, d = dp.get("timestamp"), dp.get("distance")
        if t is None or d is None:
            continue
        ts = t.timestamp() if hasattr(t, "timestamp") else float(t)
        raw = float(d)
        if previous is not None:
            step = raw - previous[1]
            allowed = max_speed * max(ts - previous[0], 0.0)
            if step > allowed:
                removed += step - allowed
        previous = (ts, raw)
        dp["distance"] = raw - removed


def best_efforts_from_segments(
    activity: Activity, segments: list[list[dict]]
) -> list[BestEffort]:
    """Fastest effort per distance across several independent runs of data points."""
    best: dict[float, BestEffort] = {}
    for segment in segments:
        for effort in _extract_best_efforts(activity, segment):
            current = best.get(effort.distance_meters)
            if current is None or effort.duration_seconds < current.duration_seconds:
                best[effort.distance_meters] = effort
    return [best[distance] for distance in sorted(best)]


def _extract_best_efforts(activity: Activity, data_points: list[dict]) -> list[BestEffort]:
    """Sliding window best-effort extraction from a (timestamp, distance) series.

    A window that overshoots the target by more than `_MAX_OVERSHOOT` is skipped: its
    split time cannot be derived, which happens across data gaps and in pools whose
    length does not divide the target distance.

    A window faster than the sport's record is dropped: it measured a jump in the data.
    """
    target_distances = BEST_EFFORT_DISTANCES.get(activity.sport, [])
    if not target_distances or not data_points:
        return []

    # Build cumulative distance + time arrays
    timestamps: list[float] = []
    distances: list[float] = []

    for dp in data_points:
        t = dp.get("timestamp")
        d = dp.get("distance")
        if t is None or d is None:
            continue
        ts = t.timestamp() if hasattr(t, "timestamp") else float(t)
        timestamps.append(ts)
        distances.append(float(d))

    if len(timestamps) < 2:
        return []

    efforts: list[BestEffort] = []
    # Open-water GPS drifts badly, and data jumps on land; reject windows nobody could do
    max_speed = MAX_EFFORT_SPEED_MS.get(activity.sport)
    for target_dist in target_distances:
        best_time: Optional[float] = None
        j = 0
        for i in range(len(distances)):
            while j < len(distances) and distances[j] - distances[i] < target_dist:
                j += 1
            if j >= len(distances):
                break
            covered = distances[j] - distances[i]
            if covered > target_dist * (1 + _MAX_OVERSHOOT):
                continue
            elapsed = timestamps[j] - timestamps[i]
            if elapsed <= 0 or (max_speed and covered / elapsed > max_speed):
                continue
            if best_time is None or elapsed < best_time:
                best_time = elapsed

        if best_time is not None:
            efforts.append(
                BestEffort(
                    activity_id=0,  # filled after DB insert
                    sport=activity.sport,
                    distance_meters=target_dist,
                    duration_seconds=best_time,
                    date=activity.date,
                    year=activity.date.year,
                )
            )
    return efforts
