import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app import fit_writer
from app.api import _leg_segments
from app.fit_parser import parse_fit_file
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
        self.assertEqual([s["label"] for s in segments], ["Run 1", "Bike", "T1", "Run 2"])


def triathlon_fit(path: Path) -> Path:
    """A triathlon whose swim timer ran for only 74 s of its 1200 s (watch auto-pause)."""
    start = datetime(2026, 5, 10, 11, 0, tzinfo=timezone.utc)
    # sport, offset, elapsed seconds, timer seconds
    legs = [
        ("swimming", 0, 1200, 74),
        ("transition", 1200, 60, 60),
        ("cycling", 1260, 1800, 1800),
        ("transition", 3060, 60, 60),
        ("running", 3120, 1200, 1200),
    ]
    writer = fit_writer.FitWriter()
    writer.write(
        "file_id", type=4, manufacturer=255, product=0, serial_number=1, time_created=start
    )
    for t in range(0, 4320, 10):  # one GPS point every 10 s, moving east
        writer.write(
            "record",
            timestamp=start + timedelta(seconds=t),
            position_lat=51.0 * fit_writer.DEG_TO_SEMICIRCLES,
            position_long=(4.0 + t / 100000) * fit_writer.DEG_TO_SEMICIRCLES,
            distance=t * 5.0,
        )
    for index, (sport, offset, elapsed, timer) in enumerate(legs):
        code = 3 if sport == "transition" else fit_writer.sport_codes(sport)[0]  # 3: transition
        writer.write(
            "session",
            timestamp=start + timedelta(seconds=offset + elapsed),
            message_index=index,
            event=9,
            event_type=1,
            start_time=start + timedelta(seconds=offset),
            sport=code,
            sub_sport=0,
            total_elapsed_time=elapsed,
            total_timer_time=timer,
        )
    path.write_bytes(writer.to_bytes())
    return path


class MultisportImportTests(unittest.TestCase):
    def test_legs_use_elapsed_time_like_single_activities(self):
        with tempfile.TemporaryDirectory() as folder:
            fit = triathlon_fit(Path(folder) / "tri.fit")
            parent, _, _, children = parse_fit_file(fit)
        self.assertEqual(parent.sport, SportType.triathlon)
        self.assertEqual(parent.duration_seconds, 4320)
        legs = [(c.sport, c.duration_seconds, len(json.loads(c.route_json))) for c, *_ in children]
        self.assertEqual(
            [(sport, seconds) for sport, seconds, _ in legs],
            [(SportType.swimming, 1200), (SportType.cycling, 1800), (SportType.running, 1200)],
        )
        # The swim's route covers the whole swim, not just the 74 s the timer ran
        self.assertGreaterEqual(legs[0][2], 120)


if __name__ == "__main__":
    unittest.main()
