import unittest
from datetime import datetime, timedelta

from app.api import _leg_segments
from app.models import Activity, SportType

START = datetime(2026, 7, 25, 14, 0, 0)


def leg(sport: SportType, start_offset: float, duration: float) -> Activity:
    return Activity(
        name=sport.value,
        sport=sport,
        date=START + timedelta(seconds=start_offset),
        duration_seconds=duration,
    )


class LegSegmentTests(unittest.TestCase):
    def test_triathlon_gets_transitions_between_legs(self):
        segments = _leg_segments(
            [
                leg(SportType.swimming, 0, 900),
                leg(SportType.cycling, 1000, 3600),  # 100 s after the swim ended
                leg(SportType.running, 4660, 2400),  # 60 s after the ride ended
            ]
        )
        self.assertEqual(
            [(s["label"], s["kind"], s["seconds"]) for s in segments],
            [
                ("Swim", "swim", 900),
                ("T1", "t1", 100),
                ("Bike", "bike", 3600),
                ("T2", "t2", 60),
                ("Run", "run", 2400),
            ],
        )

    def test_duathlon_numbers_repeated_runs_and_skips_tiny_gaps(self):
        segments = _leg_segments(
            [
                leg(SportType.running, 0, 600),
                leg(SportType.cycling, 602, 3000),  # a 2 s gap is clock jitter
                leg(SportType.running, 3700, 1500),
            ]
        )
        self.assertEqual(
            [s["label"] for s in segments], ["Run 1", "Bike", "T1", "Run 2"]
        )


if __name__ == "__main__":
    unittest.main()
