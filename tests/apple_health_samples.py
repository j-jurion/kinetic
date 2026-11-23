"""Health Auto Export (version 2) workouts for the Apple Health tests."""

import math
from datetime import datetime, timedelta, timezone

START = datetime(2026, 11, 20, 7, 0, tzinfo=timezone(timedelta(hours=1)))


def fmt(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%d %H:%M:%S %z")


def outdoor_run(start: datetime = START, seconds: int = 1800) -> dict:
    """A 6 km run at 3.33 m/s with a GPS route and heart rate every 5 seconds."""
    route = [
        {
            "latitude": 50.88 + s * 3.0e-5,
            "longitude": 4.70,
            "altitude": 30 + 10 * math.sin(s / 200),
            "timestamp": fmt(start + timedelta(seconds=s)),
            "speed": 3.33,
        }
        for s in range(seconds)
    ]
    heart = [
        {"date": fmt(start + timedelta(seconds=s)), "Min": 140, "Avg": 140 + s / 60, "Max": 150}
        for s in range(0, seconds, 5)
    ]
    return {
        "id": "A1B2",
        "name": "Outdoor Run",
        "start": fmt(start),
        "end": fmt(start + timedelta(seconds=seconds)),
        "duration": seconds,
        "location": "Outdoor",
        "isIndoor": False,
        "distance": {"qty": 6.0, "units": "km"},
        "activeEnergyBurned": {"qty": 400, "units": "kcal"},
        "elevationUp": {"qty": 42, "units": "m"},
        "heartRate": {"avg": {"qty": 155, "units": "bpm"}, "max": {"qty": 172, "units": "bpm"}},
        "stepCadence": {"qty": 170, "units": "spm"},
        "heartRateData": heart,
        "route": route,
    }


def treadmill_run(start: datetime = START) -> dict:
    """An indoor run without a route: distance comes from walkingAndRunningDistance."""
    distance = [
        {"date": fmt(start + timedelta(seconds=s)), "qty": 0.1, "units": "km"}
        for s in range(30, 1230, 30)
    ]
    return {
        "name": "Indoor Run",
        "start": fmt(start),
        "end": fmt(start + timedelta(seconds=1200)),
        "duration": 1200,
        "isIndoor": True,
        "distance": {"qty": 4.0, "units": "km"},
        "walkingAndRunningDistance": distance,
        "heartRateData": [
            {"date": fmt(start + timedelta(seconds=s)), "Avg": 150} for s in range(0, 1200, 5)
        ],
    }
