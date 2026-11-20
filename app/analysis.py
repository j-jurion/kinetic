"""Training calculations on the per-second rows of one activity.

Every function takes plain rows (dicts with ``t`` in seconds since the start, ``distance`` in
metres, ``heart_rate``, ``speed`` in m/s, ``altitude`` in metres, ``power`` in watts, …), so
they can be tested without FIT files. ``None`` marks a missing value.
"""

import math
from collections import Counter
from typing import Optional

# Gaps between records longer than this are pauses
MAX_GAP_SECONDS = 10
# Heart-rate zones as fractions of the maximum heart rate (Garmin's default "% of max")
HR_ZONES = [
    ("Z1", 0.5, 0.6),
    ("Z2", 0.6, 0.7),
    ("Z3", 0.7, 0.8),
    ("Z4", 0.8, 0.9),
    ("Z5", 0.9, 10.0),
]
HR_ZONE_NAMES = ["Recovery", "Endurance", "Tempo", "Threshold", "Maximum"]
# Coggan power zones as fractions of FTP
POWER_ZONES = [
    ("Z1", 0.0, 0.55, "Active recovery"),
    ("Z2", 0.55, 0.75, "Endurance"),
    ("Z3", 0.75, 0.90, "Tempo"),
    ("Z4", 0.90, 1.05, "Threshold"),
    ("Z5", 1.05, 1.20, "VO2 max"),
    ("Z6", 1.20, 1.50, "Anaerobic"),
    ("Z7", 1.50, 100.0, "Neuromuscular"),
]
# Durations of the power curve, in seconds
POWER_CURVE_DURATIONS = [5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600]


def _timed_pairs(rows: list[dict], field: str):
    """(value, seconds it lasted) for each row, skipping pauses and missing values."""
    for previous, current in zip(rows, rows[1:]):
        gap = current["t"] - previous["t"]
        value = previous.get(field)
        if value is None or gap <= 0 or gap > MAX_GAP_SECONDS:
            continue
        yield value, gap


def hr_histogram(rows: list[dict]) -> dict[int, float]:
    """Seconds spent at each heart rate (bpm)."""
    histogram: Counter = Counter()
    for hr, seconds in _timed_pairs(rows, "heart_rate"):
        if hr > 0:
            histogram[int(round(hr))] += seconds
    return {bpm: round(s, 1) for bpm, s in sorted(histogram.items())}


def hr_zone_seconds(histogram: dict[int, float], max_hr: float) -> list[float]:
    """Seconds per heart-rate zone (Z1–Z5) for a maximum heart rate."""
    seconds = [0.0] * len(HR_ZONES)
    for bpm, s in histogram.items():
        for i, (_, low, high) in enumerate(HR_ZONES):
            if low * max_hr <= bpm < high * max_hr:
                seconds[i] += s
                break
    return [round(s) for s in seconds]


def hr_load(histogram: dict[int, float], threshold_hr: float) -> float:
    """Heart-rate training load (hrTSS-like): one hour at threshold heart rate is 100."""
    return round(sum(s * (bpm / threshold_hr) ** 2 for bpm, s in histogram.items()) / 36, 1)


def power_series(rows: list[dict]) -> list[float]:
    """Power resampled to one value per second; pauses count as zero watts."""
    timed = [(r["t"], r.get("power")) for r in rows]
    if not timed or all(p is None for _, p in timed):
        return []
    end = int(timed[-1][0])
    series = [0.0] * (end + 1)
    for (t, watts), (next_t, _) in zip(timed, timed[1:] + [(timed[-1][0] + 1, None)]):
        if watts is None:
            continue
        # Hold each sample until the next one, but never across a pause
        until = min(int(next_t), int(t) + MAX_GAP_SECONDS, end + 1)
        for second in range(int(t), max(until, int(t) + 1)):
            if second <= end:
                series[second] = float(watts)
    return series


def power_curve(series: list[float]) -> dict[int, float]:
    """Best average power for each duration of the power curve."""
    if not series:
        return {}
    prefix = [0.0]
    for watts in series:
        prefix.append(prefix[-1] + watts)
    curve = {}
    for duration in POWER_CURVE_DURATIONS:
        if duration > len(series):
            break
        best = max(prefix[i + duration] - prefix[i] for i in range(len(series) - duration + 1))
        curve[duration] = round(best / duration, 1)
    return curve


def normalized_power(series: list[float]) -> Optional[float]:
    """Normalized Power: the fourth-power mean of 30-second rolling averages."""
    if len(series) < 30:
        return None
    window = sum(series[:30])
    rolling = [window / 30]
    for i in range(30, len(series)):
        window += series[i] - series[i - 30]
        rolling.append(window / 30)
    return round((sum(p**4 for p in rolling) / len(rolling)) ** 0.25, 1)


def power_zone_seconds(series: list[float], ftp: float) -> list[float]:
    """Seconds per Coggan power zone (Z1–Z7) for an FTP; zero-watt seconds are left out."""
    seconds = [0.0] * len(POWER_ZONES)
    for watts in series:
        if watts <= 0:
            continue
        for i, (_, low, high, _) in enumerate(POWER_ZONES):
            if low * ftp <= watts < high * ftp:
                seconds[i] += 1
                break
    return seconds


def _minetti_cost(grade: float) -> float:
    """Energy cost of running (J/kg/m) at a grade (fraction), from Minetti et al. (2002)."""
    g = max(-0.45, min(0.45, grade))
    return 155.4 * g**5 - 30.4 * g**4 - 43.3 * g**3 + 46.3 * g**2 + 19.5 * g + 3.6


_FLAT_COST = _minetti_cost(0.0)


def grades(rows: list[dict], window_m: float = 40.0) -> list[Optional[float]]:
    """Grade (rise over run) at each row, measured over about ``window_m`` metres."""
    points = [
        (i, r["distance"], r["altitude"])
        for i, r in enumerate(rows)
        if r.get("distance") is not None and r.get("altitude") is not None
    ]
    result: list[Optional[float]] = [None] * len(rows)
    j = 0
    for k, (i, distance, altitude) in enumerate(points):
        # The point about window_m behind this one
        while j < k and distance - points[j][1] > window_m:
            j += 1
        start = max(0, j - 1)
        run = distance - points[start][1]
        if run >= window_m / 2:
            result[i] = (altitude - points[start][2]) / run
    return result


def grade_adjusted_speeds(rows: list[dict]) -> list[Optional[float]]:
    """Equivalent flat running speed at each row (m/s), adjusting for the grade."""
    adjusted: list[Optional[float]] = []
    for row, grade in zip(rows, grades(rows)):
        speed = row.get("speed")
        if speed is None:
            adjusted.append(None)
        else:
            factor = _minetti_cost(grade) / _FLAT_COST if grade is not None else 1.0
            adjusted.append(speed * factor)
    return adjusted


def moving_seconds(rows: list[dict]) -> float:
    """Time spent moving: record gaps up to the pause limit, without standing still."""
    total = 0.0
    for previous, current in zip(rows, rows[1:]):
        gap = current["t"] - previous["t"]
        speed = previous.get("speed")
        if 0 < gap <= MAX_GAP_SECONDS and (speed is None or speed >= 0.5):
            total += gap
    return round(total)


def average_moving(rows: list[dict], field: str, minimum: float = 0.0) -> Optional[float]:
    """Time-weighted average of a field over the moving time."""
    total = weight = 0.0
    for previous, current in zip(rows, rows[1:]):
        gap = current["t"] - previous["t"]
        value = previous.get(field)
        speed = previous.get("speed")
        if (
            value is None
            or gap <= 0
            or gap > MAX_GAP_SECONDS
            or (speed is not None and speed < 0.5)
        ):
            continue
        if value <= minimum:
            continue
        total += value * gap
        weight += gap
    return total / weight if weight else None


def average_grade_adjusted_speed(rows: list[dict]) -> Optional[float]:
    """Average grade-adjusted speed over the moving time (m/s)."""
    adjusted = grade_adjusted_speeds(rows)
    with_gap = [{**r, "gap": g} for r, g in zip(rows, adjusted)]
    return average_moving(with_gap, "gap")


def decoupling(rows: list[dict], use_power: bool) -> Optional[float]:
    """Aerobic decoupling (%): how much output per heartbeat drops from the first to the
    second half. Under 5% is a sign of good endurance. Needs 20 minutes of data."""
    output = "power" if use_power else "speed"
    usable = [r for r in rows if r.get("heart_rate") and r.get(output) is not None]
    if len(usable) < 2 or usable[-1]["t"] - usable[0]["t"] < 20 * 60:
        return None
    middle = usable[0]["t"] + (usable[-1]["t"] - usable[0]["t"]) / 2

    def efficiency(part: list[dict]) -> Optional[float]:
        out = average_moving(part, output)
        hr = average_moving(part, "heart_rate")
        return out / hr if out and hr else None

    first = efficiency([r for r in usable if r["t"] <= middle])
    second = efficiency([r for r in usable if r["t"] > middle])
    if not first or not second:
        return None
    return round((first - second) / first * 100, 1)


def climbs(rows: list[dict], min_gain: float = 20.0, min_grade: float = 0.03) -> list[dict]:
    """Climbs: stretches gaining at least ``min_gain`` m at ``min_grade`` or steeper.

    A climb ends once the route drops 10 m below its highest point, so short dips along the
    way do not split it.
    """
    points = [r for r in rows if r.get("distance") is not None and r.get("altitude") is not None]
    if len(points) < 3:
        return []
    # Smooth the altitude over a few points to ignore barometer noise
    smoothed = []
    for i in range(len(points)):
        window = points[max(0, i - 2) : i + 3]
        smoothed.append(sum(p["altitude"] for p in window) / len(window))

    found = []
    start = 0
    peak = 0
    for i in range(1, len(points)):
        if smoothed[i] > smoothed[peak]:
            peak = i
        # A climb starts at the last low point, so flat road before it does not dilute the grade
        if smoothed[i] <= smoothed[start]:
            start = peak = i
        elif smoothed[peak] - smoothed[i] >= 10 or i == len(points) - 1:
            gain = smoothed[peak] - smoothed[start]
            length = points[peak]["distance"] - points[start]["distance"]
            if gain >= min_gain and length > 0 and gain / length >= min_grade:
                seconds = points[peak]["t"] - points[start]["t"]
                found.append(
                    {
                        "start_m": round(points[start]["distance"]),
                        "end_m": round(points[peak]["distance"]),
                        "length_m": round(length),
                        "gain_m": round(gain),
                        "grade_pct": round(gain / length * 100, 1),
                        "seconds": round(seconds),
                        # VAM: metres climbed per hour
                        "vam": round(gain / seconds * 3600) if seconds > 0 else None,
                    }
                )
            start = peak = i
    return found


def swim_lengths(lengths: list[dict]) -> list[dict]:
    """Per pool length: time, strokes, stroke rate and SWOLF (seconds + strokes)."""
    result = []
    for number, length in enumerate(lengths, start=1):
        if str(length.get("length_type", "active")) != "active":
            continue
        seconds = length.get("total_timer_time") or length.get("total_elapsed_time")
        if not seconds:
            continue
        strokes = length.get("total_strokes")
        result.append(
            {
                "length": number,
                "seconds": round(float(seconds), 1),
                "strokes": int(strokes) if strokes is not None else None,
                "stroke_rate": length.get("avg_swimming_cadence"),
                "stroke": str(length["swim_stroke"]) if length.get("swim_stroke") else None,
                "swolf": round(float(seconds) + strokes) if strokes is not None else None,
            }
        )
    return result


def mean(values: list[Optional[float]]) -> Optional[float]:
    present = [v for v in values if v is not None and not math.isnan(v)]
    return sum(present) / len(present) if present else None
