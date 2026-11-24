import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from app import streams
from tests.fit_samples import write_sample_run


class StreamTests(unittest.TestCase):
    def setUp(self):
        workdir = tempfile.TemporaryDirectory()
        self.addCleanup(workdir.cleanup)
        self.uploads = Path(workdir.name) / "uploads"
        self.uploads.mkdir()
        self.fit = write_sample_run(self.uploads / "sample.fit")
        self.outside = write_sample_run(Path(workdir.name) / "outside.fit")
        patcher = patch.object(streams, "UPLOAD_DIR", self.uploads)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_files_are_found_by_name_in_the_uploads_folder(self):
        found = self.fit.resolve()
        self.assertEqual(streams.fit_path_for(str(self.fit)), found)
        # The stored path may come from another working directory or OS
        self.assertEqual(streams.fit_path_for("uploads\\sample.fit"), found)
        self.assertEqual(streams.fit_path_for("/old/server/uploads/sample.fit"), found)
        self.assertIsNone(streams.fit_path_for(None))
        self.assertIsNone(streams.fit_path_for("uploads/missing.fit"))
        self.assertIsNone(streams.fit_path_for(str(self.outside)))  # not in the uploads folder
        self.assertIsNone(streams.fit_path_for("uploads/.."))

    def test_streams_are_downsampled_and_aligned(self):
        data = streams.read_streams(self.fit, "running")
        points = data["points"]
        length = len(points["t"])
        self.assertTrue(0 < length <= streams.MAX_POINTS)
        self.assertTrue(all(len(values) == length for values in points.values()))
        self.assertEqual(points["t"], sorted(points["t"]))
        distances = [d for d in points["distance"] if d is not None]
        self.assertLess(distances[0], distances[-1])
        # Positions are converted from semicircles to degrees and keep their precision
        lats = [v for v in points["lat"] if v is not None]
        lons = [v for v in points["lon"] if v is not None]
        self.assertTrue(lats and lons)
        self.assertTrue(all(-90 <= v <= 90 for v in lats))
        self.assertTrue(all(-180 <= v <= 180 for v in lons))
        self.assertTrue(any(round(v, 2) != v for v in lats))

    def test_zones_use_the_watch_maximum_heart_rate_when_set(self):
        settings = streams.read_fit(self.fit).settings
        data = streams.read_streams(self.fit, "running", max_hr=250)
        expected = settings.get("max_hr", 250)
        self.assertEqual(data["zone_max_hr"], round(expected))
        self.assertEqual(data["zone_source"], "watch" if "max_hr" in settings else "estimate")
        self.assertEqual([z["zone"] for z in data["zones"]], ["Z1", "Z2", "Z3", "Z4", "Z5"])
        self.assertEqual(data["zones"][0]["low"], round(0.5 * expected))
        total = sum(z["seconds"] for z in data["zones"])
        duration = data["points"]["t"][-1]
        self.assertLessEqual(total, duration + 1)

    def test_watch_settings_are_plausible(self):
        settings = streams.read_fit(self.fit).settings
        for key, (low, high) in {
            "max_hr": (120, 230), "threshold_hr": (100, 220), "ftp": (50, 600), "weight": (30, 200),
        }.items():
            if key in settings:
                self.assertTrue(low <= settings[key] <= high, (key, settings[key]))

    def test_summary_and_extra_fields(self):
        data = streams.read_streams(self.fit, "running")
        self.assertIn("summary", data)
        self.assertIn("climbs", data)
        self.assertEqual(len(data["points"]["grade_adjusted_speed"]), len(data["points"]["t"]))
        for climb in data["climbs"]:
            self.assertGreaterEqual(climb["gain_m"], 20)
            self.assertLess(climb["start_m"], climb["end_m"])

    def test_time_window_limits_records_to_a_leg(self):
        full = streams.read_streams(self.fit, "running")
        records = streams.read_fit(self.fit).records
        start = next(r["timestamp"] for r in records if isinstance(r.get("timestamp"), datetime))
        leg = streams.read_streams(self.fit, "running", start + timedelta(minutes=10), 300)
        self.assertLess(leg["points"]["t"][-1], full["points"]["t"][-1])
        self.assertLessEqual(leg["points"]["t"][-1], 300 + 65)


if __name__ == "__main__":
    unittest.main()
