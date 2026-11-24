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


def swim_bike_run(start: datetime = START) -> dict:
    """Apple's multisport workout: a 500 m open-water swim (0-10 min), a transition, a
    6 km ride (11-21 min), a transition and a 1.5 km run (22-30 min), with one GPS route."""
    route = [
        {
            "latitude": 50.88 + s * 3.0e-5,
            "longitude": 4.70,
            "timestamp": fmt(start + timedelta(seconds=s)),
        }
        for s in range(1800)
    ]

    def leg(name: str, first: int, last: int, km: float, **extra) -> dict:
        return {
            "name": name,
            "start": fmt(start + timedelta(seconds=first)),
            "end": fmt(start + timedelta(seconds=last)),
            "distance": {"qty": km, "units": "km"},
            **extra,
        }

    def distance(first: int, last: int, metres: float) -> list[dict]:
        per = metres / ((last - first) // 10)
        return [
            {"date": fmt(start + timedelta(seconds=t)), "qty": per, "units": "m"}
            for t in range(first + 10, last + 1, 10)
        ]

    return {
        "name": "Swim Bike Run",
        "start": fmt(start),
        "end": fmt(start + timedelta(seconds=1800)),
        "duration": 1800,
        "location": "Outdoor",
        "isIndoor": False,
        "distance": {"qty": 0.5, "units": "km"},  # Apple's first statistic: the swim's
        "activeEnergyBurned": {"qty": 600, "units": "kcal"},
        "heartRateData": [
            {"date": fmt(start + timedelta(seconds=s)), "Avg": 150} for s in range(0, 1800, 5)
        ],
        "swimDistance": distance(0, 600, 500),
        "cyclingDistance": distance(660, 1260, 6000),
        "walkingAndRunningDistance": distance(1320, 1800, 1500),
        "route": route,
        "legs": [
            leg("Open Water Swim", 0, 600, 0.5, location="Open Water"),
            leg("Outdoor Cycle", 660, 1260, 6.0),
            leg("Outdoor Run", 1320, 1800, 1.5),
        ],
    }
