"""A synthetic FIT run for tests, so the repository holds no real GPS recordings."""

import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app import fit_writer

START = datetime(2025, 3, 18, 17, 53, tzinfo=timezone.utc)
DURATION_SECONDS = 1800
# An arbitrary point in open water; the route is a made-up loop around it.
ORIGIN_LAT, ORIGIN_LON = 50.123456, 3.654321


def sample_run_bytes() -> bytes:
    """A 30-minute run at ~3 m/s with heart rate, cadence and a 40 m climb in the middle."""
    writer = fit_writer.FitWriter()
    sport, sub_sport = fit_writer.sport_codes("running")
    writer.write("file_id", type=4, manufacturer=255, product=0, serial_number=1,
                 time_created=START)
    writer.write_sport(sport, sub_sport, "Synthetic run")
    writer.write("event", timestamp=START, event=0, event_type=0)

    distance = 0.0
    ascent = 0.0
    previous_altitude = None
    heart_rates = []
    for t in range(DURATION_SECONDS + 1):
        speed = 3.0 + 0.3 * math.sin(t / 60)
        distance += speed if t else 0.0
        # Flat, then a steady 40 m climb between minutes 10 and 15, then a descent
        if t < 600:
            altitude = 20.0
        elif t < 900:
            altitude = 20.0 + 40.0 * (t - 600) / 300
        elif t < 1200:
            altitude = 60.0 - 40.0 * (t - 900) / 300
        else:
            altitude = 20.0
        if previous_altitude is not None and altitude > previous_altitude:
            ascent += altitude - previous_altitude
        previous_altitude = altitude
        heart_rate = round(min(185, 110 + t / 30 + (15 if 600 <= t < 900 else 0)))
        heart_rates.append(heart_rate)
        angle = distance / 2000 * 2 * math.pi
        lat = ORIGIN_LAT + 0.004 * math.sin(angle)
        lon = ORIGIN_LON + 0.006 * (1 - math.cos(angle))
        writer.write(
            "record",
            timestamp=START + timedelta(seconds=t),
            position_lat=lat * fit_writer.DEG_TO_SEMICIRCLES,
            position_long=lon * fit_writer.DEG_TO_SEMICIRCLES,
            heart_rate=heart_rate,
            cadence=85,
            distance=distance,
            enhanced_speed=speed,
            enhanced_altitude=altitude,
        )

    end = START + timedelta(seconds=DURATION_SECONDS)
    writer.write("event", timestamp=end, event=0, event_type=4)
    avg_hr = round(sum(heart_rates) / len(heart_rates))
    common = dict(
        timestamp=end, message_index=0, event=9, event_type=1, start_time=START,
        total_elapsed_time=DURATION_SECONDS, total_timer_time=DURATION_SECONDS,
        total_distance=distance, avg_heart_rate=avg_hr, max_heart_rate=max(heart_rates),
        total_ascent=ascent, sport=sport,
    )
    writer.write("lap", avg_speed=distance / DURATION_SECONDS, **common)
    writer.write(
        "session", sub_sport=sub_sport, avg_speed=distance / DURATION_SECONDS,
        max_speed=3.3, avg_cadence=85, total_descent=ascent, first_lap_index=0, num_laps=1,
        **common,
    )
    writer.write("activity", timestamp=end, total_timer_time=DURATION_SECONDS, num_sessions=1,
                 type=0, event=26, event_type=1)
    return writer.to_bytes()


def write_sample_run(path: Path) -> Path:
    path.write_bytes(sample_run_bytes())
    return path
