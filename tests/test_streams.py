import shutil
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from app import streams

SAMPLE = Path(__file__).resolve().parent.parent / "data" / "2025-03-18-17-53-59.fit"


class StreamTests(unittest.TestCase):
    def setUp(self):
        workdir = tempfile.TemporaryDirectory()
        self.addCleanup(workdir.cleanup)
        self.uploads = Path(workdir.name) / "uploads"
        self.uploads.mkdir()
        self.fit = self.uploads / "sample.fit"
        shutil.copy(SAMPLE, self.fit)
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
        self.assertIsNone(streams.fit_path_for(str(SAMPLE)))  # not in the uploads folder
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

    def test_zone_time_matches_heart_rate_reference(self):
        data = streams.read_streams(self.fit, "running", max_hr=250)
        self.assertEqual(data["zone_max_hr"], 250)
        self.assertEqual([z["zone"] for z in data["zones"]], ["Z1", "Z2", "Z3", "Z4", "Z5"])
        self.assertEqual(data["zones"][0]["low"], 125)
        total = sum(z["seconds"] for z in data["zones"])
        duration = data["points"]["t"][-1]
        self.assertLessEqual(total, duration + 1)

    def test_time_window_limits_records_to_a_leg(self):
        full = streams.read_streams(self.fit, "running")
        records = streams._read_records(str(self.fit), self.fit.stat().st_mtime)
        start = next(r["timestamp"] for r in records if isinstance(r.get("timestamp"), datetime))
        leg = streams.read_streams(self.fit, "running", start + timedelta(minutes=10), 300)
        self.assertLess(leg["points"]["t"][-1], full["points"]["t"][-1])
        self.assertLessEqual(leg["points"]["t"][-1], 300 + 65)


if __name__ == "__main__":
    unittest.main()
