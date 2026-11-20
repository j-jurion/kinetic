import shutil
import tempfile
import unittest
import uuid
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, create_engine

from app import metrics, streams
from app.models import Activity, ActivityMetrics, SportType
from app.ownership import UserSession, current_owner

SAMPLE = Path(__file__).resolve().parent.parent / "data" / "2025-03-18-17-53-59.fit"
ALICE, BOB = str(uuid.uuid4()), str(uuid.uuid4())


class MetricsTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        SQLModel.metadata.create_all(self.engine)
        self.addCleanup(self.engine.dispose)
        workdir = tempfile.TemporaryDirectory()
        self.addCleanup(workdir.cleanup)
        uploads = Path(workdir.name) / "uploads"
        uploads.mkdir()
        shutil.copy(SAMPLE, uploads / "run.fit")
        for patcher in (
            patch.object(metrics, "engine", self.engine),
            patch.object(streams, "UPLOAD_DIR", uploads),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def as_owner(self, owner_id):
        token = current_owner.set(owner_id)
        self.addCleanup(current_owner.reset, token)

    def add_activity(self, name, fit="uploads/run.fit", avg_hr=None):
        with UserSession(self.engine) as session:
            activity = Activity(
                name=name,
                sport=SportType.running,
                date=datetime(2025, 3, 18, 17, 53),
                duration_seconds=1800,
                distance_meters=5000,
                avg_heart_rate=avg_hr,
                fit_file_path=fit,
            )
            session.add(activity)
            session.commit()
            session.refresh(activity)
            return activity.id

    def test_backfill_stores_metrics_and_overview_uses_them(self):
        self.as_owner(ALICE)
        with_file = self.add_activity("With file")
        manual = self.add_activity("Manual", fit=None, avg_hr=150)
        self.assertEqual(sorted(metrics.pending_ids()), sorted([with_file, manual]))

        progress = []
        result = metrics.backfill(lambda done, total, name: progress.append((done, total)))
        self.assertEqual(result, {"computed": 2, "failed": 0})
        self.assertEqual(progress[-1], (2, 2))
        self.assertEqual(metrics.pending_ids(), [])

        overview = metrics.overview()
        rows = {row["name"]: row for row in overview["activities"]}
        self.assertTrue(rows["With file"]["has_metrics"])
        self.assertEqual(rows["With file"]["load_source"], "heart rate")
        self.assertGreater(rows["With file"]["load"], 0)
        self.assertEqual(len(rows["With file"]["zone_seconds"]), 5)
        # Without a file the load falls back to the average heart rate
        self.assertFalse(rows["Manual"]["has_metrics"])
        self.assertEqual(rows["Manual"]["load_source"], "average heart rate")
        self.assertTrue(rows["Manual"]["zones_estimated"])
        self.assertEqual(overview["pending"], 0)
        self.assertIsNotNone(overview["thresholds"]["max_hr"])

    def test_metrics_are_private_to_their_account(self):
        self.as_owner(ALICE)
        alice_activity = self.add_activity("Alice run")
        metrics.backfill(lambda *_: None)

        self.as_owner(BOB)
        with UserSession(self.engine) as session:
            self.assertIsNone(session.get(ActivityMetrics, alice_activity))
        self.assertEqual(metrics.overview()["activities"], [])
        self.assertEqual(metrics.pending_ids(), [])
        with UserSession(self.engine) as session:
            session.add(ActivityMetrics(activity_id=alice_activity))
            with self.assertRaises(PermissionError):
                session.commit()


if __name__ == "__main__":
    unittest.main()
