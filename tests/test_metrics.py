import tempfile
import unittest
import uuid
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, create_engine

from app import metrics, streams
from app.models import Activity, ActivityMetrics, SportType
from app.ownership import UserSession, current_owner
from tests.fit_samples import write_sample_run

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
        write_sample_run(uploads / "run.fit")
        for patcher in (
            patch.object(metrics, "engine", self.engine),
            patch.object(streams, "UPLOAD_DIR", uploads),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def as_owner(self, owner_id):
        token = current_owner.set(owner_id)
        self.addCleanup(current_owner.reset, token)

    def add_activity(self, name, fit="uploads/run.fit", avg_hr=None, max_hr=None):
        with UserSession(self.engine) as session:
            activity = Activity(
                name=name,
                sport=SportType.running,
                date=datetime(2025, 3, 18, 17, 53),
                duration_seconds=1800,
                distance_meters=5000,
                avg_heart_rate=avg_hr,
                max_heart_rate=max_hr,
                fit_file_path=fit,
            )
            session.add(activity)
            session.commit()
            session.refresh(activity)
            return activity.id

    def test_backfill_stores_metrics_and_overview_uses_them(self):
        self.as_owner(ALICE)
        # The synthetic file has no watch settings: zones come from the highest heart rate
        with_file = self.add_activity("With file", max_hr=185)
        manual = self.add_activity("Manual", fit=None, avg_hr=150)
        self.assertEqual(sorted(metrics.pending_ids()), sorted([with_file, manual]))

        progress = []
        result = metrics.backfill(lambda done, total, name: progress.append((done, total)))
        self.assertEqual(result, {"computed": 2, "failed": 0, "failures": []})
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


    def test_analysing_while_an_import_saves_the_same_metrics(self):
        # An import computes metrics of its new activities right away; "Analyse now" started
        # meanwhile finds the activity pending, and the import saves first
        self.as_owner(ALICE)
        activity_id = self.add_activity("Imported run")
        real_compute = metrics.compute
        saved_by_import = []

        def import_saves_first(session):
            # Runs as "Analyse now" commits: the import's request has just saved the row
            if saved_by_import or not any(isinstance(i, ActivityMetrics) for i in session.new):
                return
            saved_by_import.append(True)
            with UserSession(self.engine) as other:
                other.add(real_compute(Activity(id=activity_id, name="x", date=datetime.now(),
                                                duration_seconds=1, fit_file_path="run.fit")))
                other.commit()

        event.listen(UserSession, "before_commit", import_saves_first)
        self.addCleanup(event.remove, UserSession, "before_commit", import_saves_first)
        result = metrics.backfill(lambda *_: None)
        self.assertTrue(saved_by_import)
        self.assertEqual(result, {"computed": 1, "failed": 0, "failures": []})
        self.assertEqual(metrics.pending_ids(), [])
        with UserSession(self.engine) as session:
            self.assertEqual(session.get(ActivityMetrics, activity_id).version,
                             metrics.METRICS_VERSION)

    def test_skips_activities_an_import_analysed_since(self):
        self.as_owner(ALICE)
        activity_id = self.add_activity("Imported run")
        pending = metrics.pending_ids()
        metrics.store_quietly([activity_id])  # the import finishes first
        with (
            patch.object(metrics, "pending_ids", return_value=pending),
            patch.object(metrics, "compute") as compute,
        ):
            result = metrics.backfill(lambda *_: None)
        compute.assert_not_called()
        self.assertEqual(result["computed"], 1)

    def test_failures_name_the_activity_and_the_reason(self):
        self.as_owner(ALICE)
        (streams.UPLOAD_DIR / "damaged.fit").write_bytes(b"not a FIT file at all")
        damaged = self.add_activity("Damaged run", fit="uploads/damaged.fit")
        self.add_activity("Good run")
        result = metrics.backfill(lambda *_: None)
        self.assertEqual(result["computed"], 1)
        self.assertEqual(
            result["failures"],
            [{"id": damaged, "name": "Damaged run",
              "reason": "its FIT file is damaged and cannot be read"}],
        )


if __name__ == "__main__":
    unittest.main()
