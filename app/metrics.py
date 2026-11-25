"""Per-activity training metrics and the account-wide training overview.

Charts across many activities (fitness and form, power curve, efficiency trends, …) cannot
re-read hundreds of FIT files per visit, so a few numbers per activity are computed once and
stored in ``ActivityMetrics``: when an activity is imported, and in a one-time backfill.
"""

import json
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any, Optional

from loguru import logger
from sqlmodel import col, select

from app import analysis, streams
from app.database import engine
from app.models import Activity, ActivityMetrics
from app.ownership import UserSession as Session

# Bump when the stored metrics change, so the backfill recomputes them
METRICS_VERSION = 3
# A recorded duration longer than this is a broken file (a watch left running for weeks)
MAX_PLAUSIBLE_SECONDS = 24 * 3600
# Without a threshold heart rate, assume it is this share of the maximum heart rate
THRESHOLD_SHARE_OF_MAX = 0.89
# Load of an hour without heart rate or power: a steady, moderate effort
LOAD_PER_HOUR_WITHOUT_DATA = 50


def _round(value: Optional[float], digits: int = 1) -> Optional[float]:
    return round(value, digits) if value is not None else None


def compute(activity: Activity) -> ActivityMetrics:
    """The metrics of one activity, read from its FIT file (not yet saved)."""
    metrics = ActivityMetrics(activity_id=activity.id, version=METRICS_VERSION)
    path = streams.fit_path_for(activity.fit_file_path)
    if path is None:
        return metrics
    data = streams.read_fit(path)
    leg = activity.parent_id is not None
    sport = activity.sport.value
    rows = streams.activity_rows(
        data, sport, activity.date if leg else None, activity.duration_seconds if leg else None
    )
    metrics.has_fit = True
    settings = data.settings
    metrics.max_hr_setting = settings.get("max_hr")
    metrics.threshold_hr_setting = settings.get("threshold_hr")
    metrics.ftp_setting = settings.get("ftp")
    metrics.weight_kg = settings.get("weight")
    if not rows:
        return metrics

    metrics.moving_seconds = analysis.moving_seconds(rows)
    histogram = analysis.hr_histogram(rows)
    metrics.hr_histogram = json.dumps(histogram) if histogram else None
    series = analysis.power_series(rows)
    curve = analysis.power_curve(series)
    metrics.power_curve = json.dumps(curve) if curve else None
    metrics.normalized_power = analysis.normalized_power(series)
    metrics.avg_temperature = _round(analysis.average_moving(rows, "temperature", minimum=-100))
    if sport in streams.RUNNING_SPORTS:
        metrics.grade_adjusted_speed = _round(analysis.average_grade_adjusted_speed(rows), 3)
    metrics.decoupling_pct = analysis.decoupling(
        rows, use_power=bool(series) and sport == "cycling"
    )
    metrics.avg_step_length = _round(analysis.average_moving(rows, "step_length"), 3)
    metrics.avg_ground_contact = _round(analysis.average_moving(rows, "ground_contact"))
    metrics.avg_vertical_oscillation = _round(analysis.average_moving(rows, "vertical_oscillation"))
    metrics.avg_vertical_ratio = _round(analysis.average_moving(rows, "vertical_ratio"))

    lengths = analysis.swim_lengths(
        streams.activity_lengths(
            data, activity.date if leg else None, activity.duration_seconds if leg else None
        )
    )
    metrics.avg_swolf = _round(analysis.mean([length["swolf"] for length in lengths]))
    metrics.avg_stroke_rate = _round(analysis.mean([length["stroke_rate"] for length in lengths]))
    return metrics


def store(session, activity: Activity) -> ActivityMetrics:
    """Compute and save the metrics of an activity, replacing older ones."""
    fresh = compute(activity)
    existing = session.get(ActivityMetrics, activity.id)
    if existing:
        for key, value in fresh.model_dump(exclude={"activity_id"}).items():
            setattr(existing, key, value)
        fresh = existing
    fresh.computed_at = datetime.now(timezone.utc)
    session.add(fresh)
    session.commit()
    return fresh


def store_quietly(activity_ids: list[int]) -> None:
    """Compute metrics after an import; a failure must never fail the import itself."""
    with Session(engine) as session:
        for activity_id in activity_ids:
            activity = session.get(Activity, activity_id)
            if activity is None:
                continue
            try:
                store(session, activity)
            except Exception:
                session.rollback()
                logger.exception("Could not compute metrics for activity {}", activity_id)


def _needs_update(activity: Activity, metrics: Optional[ActivityMetrics]) -> bool:
    if metrics is None or metrics.version < METRICS_VERSION:
        return True
    # A FIT file may have become available since (for example a new upload folder)
    return not metrics.has_fit and streams.fit_path_for(activity.fit_file_path) is not None


def pending_ids() -> list[int]:
    """Activities of the account whose metrics are missing or outdated."""
    with Session(engine) as session:
        activities = session.exec(select(Activity)).all()
        stored = {m.activity_id: m for m in session.exec(select(ActivityMetrics)).all()}
        return [a.id for a in activities if a.id is not None and _needs_update(a, stored.get(a.id))]


def backfill(progress: Callable[[int, int, str], None]) -> dict:
    """Compute the missing metrics of the account, reporting (done, total, name) as it goes."""
    ids = pending_ids()
    failed = 0
    with Session(engine) as session:
        for done, activity_id in enumerate(ids, start=1):
            activity = session.get(Activity, activity_id)
            if activity is None:
                continue
            try:
                store(session, activity)
            except Exception:
                session.rollback()
                failed += 1
                logger.exception("Could not compute metrics for activity {}", activity_id)
            progress(done, len(ids), activity.name)
    return {"computed": len(ids) - failed, "failed": failed}


# ── Training overview ─────────────────────────────────────────────────────────


def _latest(
    rows: list[tuple[Activity, Optional[ActivityMetrics]]],
    field: str,
    sports: Optional[set[str]] = None,
    with_power: bool = False,
) -> Optional[float]:
    """The most recent watch setting, optionally only from activities of some sports.

    ``with_power`` only trusts activities that recorded power: watches store their FTP in
    every file, so a ride without a power meter would otherwise report the running FTP.
    """
    for activity, metrics in sorted(rows, key=lambda r: r[0].date, reverse=True):
        if sports and activity.sport.value not in sports:
            continue
        if with_power and not (metrics and metrics.power_curve):
            continue
        value = getattr(metrics, field, None) if metrics else None
        if value:
            return value
    return None


def thresholds(rows: list[tuple[Activity, Optional[ActivityMetrics]]]) -> dict[str, Any]:
    """Heart rate, power and weight values the charts use, and where they come from."""
    max_hr = _latest(rows, "max_hr_setting")
    max_hr_source = "watch"
    if not max_hr:
        max_hr = max((a.max_heart_rate for a, _ in rows if a.max_heart_rate), default=None)
        max_hr_source = "highest recorded"
    threshold_hr = _latest(rows, "threshold_hr_setting")
    threshold_source = "watch"
    if not threshold_hr and max_hr:
        threshold_hr = round(max_hr * THRESHOLD_SHARE_OF_MAX)
        threshold_source = f"estimated as {round(THRESHOLD_SHARE_OF_MAX * 100)}% of max"
    return {
        "max_hr": max_hr,
        "max_hr_source": max_hr_source if max_hr else None,
        "threshold_hr": threshold_hr,
        "threshold_hr_source": threshold_source if threshold_hr else None,
        "ftp_running": _latest(rows, "ftp_setting", streams.RUNNING_SPORTS, with_power=True),
        "ftp_cycling": _latest(rows, "ftp_setting", {"cycling"}, with_power=True),
        "weight_kg": _latest(rows, "weight_kg"),
    }


def _load(
    activity: Activity,
    metrics: Optional[ActivityMetrics],
    histogram: dict[int, float],
    limits: dict,
) -> tuple[float, str]:
    """Training load of one activity, and what it was based on.

    One hour at threshold is 100. Power is used for rides, then the per-second heart rate,
    then the average heart rate, then a moderate effort for the time spent moving.
    """
    # Moving time from the records beats the file's total, which can be broken
    seconds = (metrics.moving_seconds if metrics else None) or activity.duration_seconds or 0
    if seconds > MAX_PLAUSIBLE_SECONDS:
        return 0.0, "unknown (implausible duration)"
    hours = seconds / 3600
    ftp = (metrics.ftp_setting if metrics else None) or limits["ftp_cycling"]
    if activity.sport.value == "cycling" and metrics and metrics.normalized_power and ftp:
        intensity = metrics.normalized_power / ftp
        return round(hours * intensity**2 * 100, 1), "power"
    threshold = (metrics.threshold_hr_setting if metrics else None) or limits["threshold_hr"]
    if histogram and threshold:
        return analysis.hr_load(histogram, threshold), "heart rate"
    if activity.avg_heart_rate and threshold:
        intensity = activity.avg_heart_rate / threshold
        return round(hours * intensity**2 * 100, 1), "average heart rate"
    return round(hours * LOAD_PER_HOUR_WITHOUT_DATA, 1), "duration"


def _training_seconds(activity: Activity, metrics: Optional[ActivityMetrics]) -> float:
    """Moving time when known, else the recorded duration; 0 for an implausible duration."""
    seconds = (metrics.moving_seconds if metrics else None) or activity.duration_seconds or 0
    return seconds if seconds <= MAX_PLAUSIBLE_SECONDS else 0


def overview() -> dict[str, Any]:
    """Every activity of the account with its metrics, load and zones, for the Training page."""
    with Session(engine) as session:
        activities = session.exec(select(Activity).order_by(col(Activity.date))).all()
        stored = {m.activity_id: m for m in session.exec(select(ActivityMetrics)).all()}
    rows = [(a, stored.get(a.id)) for a in activities]
    limits = thresholds(rows)
    result = []
    for activity, metrics in rows:
        histogram = (
            {int(k): v for k, v in json.loads(metrics.hr_histogram).items()}
            if metrics and metrics.hr_histogram
            else {}
        )
        load, load_source = _load(activity, metrics, histogram, limits)
        max_hr = (metrics.max_hr_setting if metrics else None) or limits["max_hr"]
        zones = None
        if histogram and max_hr:
            zones = analysis.hr_zone_seconds(histogram, max_hr)
        elif activity.avg_heart_rate and max_hr:
            # Without per-second data, count the whole activity in its average's zone
            zones = analysis.hr_zone_seconds(
                {activity.avg_heart_rate: _training_seconds(activity, metrics)}, max_hr
            )
        curve = json.loads(metrics.power_curve) if metrics and metrics.power_curve else None
        result.append(
            {
                "id": activity.id,
                "name": activity.name,
                "date": activity.date.isoformat(),
                "sport": activity.sport.value,
                "kind": activity.kind.value,
                "parent_id": activity.parent_id,
                "duration_seconds": activity.duration_seconds,
                # Time actually moving; use this for totals, durations in files can be broken
                "moving_seconds": _training_seconds(activity, metrics),
                "distance_meters": activity.distance_meters,
                "elevation_gain_meters": activity.elevation_gain_meters,
                "avg_heart_rate": activity.avg_heart_rate,
                "avg_speed_ms": activity.avg_speed_ms,
                "avg_cadence": activity.avg_cadence,
                "avg_power": activity.avg_power,
                "load": load,
                "load_source": load_source,
                "zone_seconds": zones,
                "zones_estimated": not histogram,
                "has_metrics": metrics is not None and metrics.has_fit,
                "power_curve": curve,
                "normalized_power": metrics.normalized_power if metrics else None,
                "ftp_setting": metrics.ftp_setting if metrics else None,
                "weight_kg": metrics.weight_kg if metrics else None,
                "avg_temperature": metrics.avg_temperature if metrics else None,
                "grade_adjusted_speed": metrics.grade_adjusted_speed if metrics else None,
                "decoupling_pct": metrics.decoupling_pct if metrics else None,
                "avg_step_length": metrics.avg_step_length if metrics else None,
                "avg_ground_contact": metrics.avg_ground_contact if metrics else None,
                "avg_vertical_oscillation": metrics.avg_vertical_oscillation if metrics else None,
                "avg_vertical_ratio": metrics.avg_vertical_ratio if metrics else None,
                "avg_swolf": metrics.avg_swolf if metrics else None,
                "avg_stroke_rate": metrics.avg_stroke_rate if metrics else None,
            }
        )
    pending = sum(1 for a, m in rows if _needs_update(a, m))
    return {
        "activities": result,
        "thresholds": limits,
        "pending": pending,
        "zones": [
            {"zone": z, "name": n, "low": lo, "high": min(hi, 1.0)}
            for (z, lo, hi), n in zip(analysis.HR_ZONES, analysis.HR_ZONE_NAMES)
        ],
    }
