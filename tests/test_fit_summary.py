"""The quick FIT summary reader against fitparse."""

import tempfile
import unittest
from pathlib import Path

import fitparse

from app import apple_health
from app.fit_summary import FitSummaryError, read_summaries
from tests.apple_health_samples import outdoor_run, swim_bike_run
from tests.fit_samples import sample_run_bytes, write_sessions_fit

KEYS = ("total_elapsed_time", "total_timer_time", "total_distance", "sport", "sub_sport")


def with_fitparse(data: bytes) -> tuple[list[dict], list[dict]]:
    sessions, laps = [], []
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "file.fit"
        path.write_bytes(data)
        for message in fitparse.FitFile(str(path)).get_messages(["session", "lap"]):
            values = {f.name: f.value for f in message.fields}
            (sessions if message.name == "session" else laps).append(values)
    return sessions, laps


def picked(messages: list[dict], keys=KEYS) -> list[dict]:
    return [{k: m[k] for k in keys if m.get(k) is not None} for m in messages]


class FitSummaryTests(unittest.TestCase):
    def assert_same_as_fitparse(self, data: bytes):
        sessions, laps = read_summaries(data)
        want_sessions, want_laps = with_fitparse(data)
        self.assertEqual(picked(sessions), picked(want_sessions))
        # Laps are read for their times and distance only
        self.assertEqual(picked(laps, KEYS[:3]), picked(want_laps, KEYS[:3]))
        return sessions, laps

    def test_matches_fitparse(self):
        cases = {
            "watch run": sample_run_bytes(manufacturer=1),
            "apple run": apple_health.to_fit(apple_health.parse_workout(outdoor_run())),
            "apple triathlon": apple_health.to_fit(apple_health.parse_workout(swim_bike_run())),
        }
        for label, data in cases.items():
            with self.subTest(label):
                sessions, _ = self.assert_same_as_fitparse(data)
                self.assertTrue(sessions)

    def test_paused_run(self):
        with tempfile.TemporaryDirectory() as folder:
            path = write_sessions_fit(Path(folder) / "run.fit", [("running", 0, 2141, 1652)])
            sessions, _ = self.assert_same_as_fitparse(path.read_bytes())
        self.assertEqual(sessions[0]["total_timer_time"], 1652)
        self.assertEqual(sessions[0]["sport"], "running")

    def test_rejects_what_it_cannot_follow(self):
        for data in (b"", b"not a FIT file at all", sample_run_bytes()[:200]):
            with self.assertRaises(FitSummaryError):
                read_summaries(data)


if __name__ == "__main__":
    unittest.main()
