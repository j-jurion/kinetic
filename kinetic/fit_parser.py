import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from kinetic.models import Activity, ActivityKind, BestEffort, Lap, SportType
from kinetic.ui_helpers import DATE_FORMAT

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

# FIT sub_sport values that refine the recorded sport
SUB_SPORT_MAP: dict[tuple[str, str], SportType] = {
    ("running", "trail"): SportType.trail_running,
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
    data_points: list[dict] = []

    message: Any
    for message in fitfile.get_messages():
        msg_name = message.name
        record = {f.name: f for f in message.fields}

        if msg_name == "session":
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
        elif msg_name == "record":
            data_points.append({k: _safe_val(record, k) for k in record})

    if is_multisport and len(sessions_data) > 1:
        return _build_multisport(fit_path, sessions_data, lap_records, data_points)

    # ── Single-sport path ─────────────────────────────────────────────────────
    session_data = sessions_data[-1] if sessions_data else {}
    activity, laps, best_efforts = _build_single_activity(
        fit_path, session_data, lap_records, data_points, activity_name_hint
    )
    return activity, laps, best_efforts, []


def _build_single_activity(
    fit_path: Path,
    session_data: dict,
    lap_records: list[dict],
    data_points: list[dict],
    activity_name_hint: str | None,
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

    total_elapsed = (
        session_data.get("total_elapsed_time") or session_data.get("total_timer_time") or 0
    )
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
        duration_seconds=float(total_elapsed),
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
                duration_seconds=float(lr["total_elapsed_time"])
                if lr.get("total_elapsed_time")
                else None,
                distance_meters=float(lr["total_distance"]) if lr.get("total_distance") else None,
                avg_speed_ms=float(lr["avg_speed"]) if lr.get("avg_speed") else None,
                avg_heart_rate=int(lr["avg_heart_rate"]) if lr.get("avg_heart_rate") else None,
                elevation_gain=float(lr["total_ascent"]) if lr.get("total_ascent") else None,
            )
        )

    best_efforts = _extract_best_efforts(activity, data_points)
    _attach_route(activity, data_points)
    return activity, laps, best_efforts


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

    total_time = sum(
        float(s.get("total_timer_time") or s.get("total_elapsed_time") or 0) for s in sessions
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

        duration = float(session.get("total_timer_time") or session.get("total_elapsed_time") or 0)
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


def _extract_best_efforts(activity: Activity, data_points: list[dict]) -> list[BestEffort]:
    """Sliding window best-effort extraction from GPS records."""
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
    for target_dist in target_distances:
        best_time: Optional[float] = None
        j = 0
        for i in range(len(distances)):
            while j < len(distances) and distances[j] - distances[i] < target_dist:
                j += 1
            if j >= len(distances):
                break
            elapsed = timestamps[j] - timestamps[i]
            if elapsed > 0 and (best_time is None or elapsed < best_time):
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
