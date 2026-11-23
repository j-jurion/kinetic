import os
import subprocess
import sys
import tempfile
import unittest
import uuid
from datetime import timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app import apple_health, garmin_sync, streams
from app.fit_parser import parse_fit_file
from app.models import Activity, SportType
from app.ownership import current_owner
from tests.apple_health_samples import START, outdoor_run, treadmill_run

ALICE, BOB = str(uuid.uuid4()), str(uuid.uuid4())


class ConversionTests(unittest.TestCase):
    def setUp(self):
        workdir = tempfile.TemporaryDirectory()
        self.addCleanup(workdir.cleanup)
        self.dir = Path(workdir.name)

    def roundtrip(self, data: dict):
        path = self.dir / f"{uuid.uuid4().hex}.fit"
        path.write_bytes(apple_health.to_fit(apple_health.parse_workout(data)))
        return path, parse_fit_file(path)

    def test_outdoor_run_keeps_summary_route_laps_and_best_efforts(self):
        path, (activity, laps, efforts, children) = self.roundtrip(outdoor_run())
        self.assertEqual(children, [])
        self.assertEqual(activity.sport, SportType.running)
        self.assertTrue(activity.name.startswith("Outdoor Run "))
        # Stored like Garmin dates: naive UTC
        self.assertEqual(activity.date, START.astimezone(timezone.utc).replace(tzinfo=None))
        self.assertEqual(activity.duration_seconds, 1800)
        self.assertEqual(activity.distance_meters, 6000)
        self.assertEqual((activity.avg_heart_rate, activity.max_heart_rate), (155, 172))
        self.assertEqual(activity.avg_cadence, 85)  # strides per minute, like Garmin files
        self.assertEqual((activity.calories, activity.elevation_gain_meters), (400, 42))
        self.assertIsNotNone(activity.route_json)
        self.assertEqual(len(laps), 6)
        self.assertAlmostEqual(sum(lap.distance_meters or 0 for lap in laps), 6000, delta=5)
        self.assertEqual({e.distance_meters for e in efforts}, {1000, 5000})

        rows = streams.activity_rows(streams.read_fit(path), activity.sport.value)
        self.assertEqual(len(rows), 1800)
        self.assertAlmostEqual(rows[100]["speed"], 3.33, places=2)
        self.assertAlmostEqual(rows[100]["lat"], 50.883, places=4)
        self.assertIsNotNone(rows[102]["heart_rate"])  # interpolated between 5 s samples

    def test_indoor_run_uses_distance_samples(self):
        path, (activity, laps, efforts, _) = self.roundtrip(treadmill_run())
        self.assertEqual(activity.sport, SportType.running)
        self.assertIsNone(activity.route_json)
        self.assertEqual(activity.distance_meters, 4000)
        self.assertEqual(len(laps), 4)
        self.assertEqual([e.distance_meters for e in efforts], [1000])
        rows = streams.activity_rows(streams.read_fit(path), "running")
        self.assertAlmostEqual(rows[-1]["distance"], 4000, delta=1)
        self.assertTrue(any(row["speed"] for row in rows))

    def test_workouts_without_samples_and_other_sports(self):
        base = {"start": "2026-11-20 18:00:00 +0100", "end": "2026-11-20 18:45:00 +0100"}
        cases = {
            "Traditional Strength Training": SportType.strength,
            "Yoga": SportType.yoga,
            "Outdoor Cycle": SportType.cycling,
            "Pool Swim": SportType.swimming,
            "Hiking": SportType.hiking,
            "Dance": SportType.other,
        }
        for name, sport in cases.items():
            with self.subTest(name):
                _, (activity, *_rest) = self.roundtrip({**base, "name": name})
                self.assertEqual(activity.sport, sport)
                self.assertEqual(activity.duration_seconds, 2700)

    def test_version_1_fields_and_units(self):
        data = {
            "name": "Running",
            "start": "2026-11-20T07:00:00Z",
            "end": "2026-11-20T07:30:00Z",
            "distance": {"qty": 3.1, "units": "mi"},
            "activeEnergy": {"qty": 1674, "units": "kJ"},
            "heartRateData": [{"date": "2026-11-20T07:10:00Z", "qty": 150, "units": "bpm"}],
            "route": [
                {"lat": 50.0, "lon": 4.0, "timestamp": "2026-11-20T07:00:00Z"},
                {"lat": 50.001, "lon": 4.0, "timestamp": "2026-11-20T07:00:01Z"},
            ],
        }
        _, (activity, *_rest) = self.roundtrip(data)
        self.assertAlmostEqual(activity.distance_meters or 0, 4988.97, delta=0.1)
        self.assertEqual(activity.calories, 400)
        self.assertIsNotNone(activity.route_json)

    def test_invalid_workouts_are_rejected(self):
        for data in (
            None,
            {"name": "Run"},
            {"start": "2026-11-20 07:00:00 +0100", "end": "2026-11-20 06:00:00 +0100"},
            {"start": "2026-11-20 07:00:00 +0100", "end": "2026-11-25 07:00:00 +0100"},
        ):
            with self.subTest(data=data), self.assertRaises(apple_health.WorkoutError):
                apple_health.parse_workout(data)
        with self.assertRaises(apple_health.WorkoutError):
            apple_health.workouts_from_payload({"data": {"workouts": "nope"}})


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        SQLModel.metadata.create_all(self.engine)
        self.addCleanup(self.engine.dispose)
        workdir = tempfile.TemporaryDirectory()
        self.addCleanup(workdir.cleanup)
        for patcher in (
            patch.object(garmin_sync, "engine", self.engine),
            patch.object(apple_health, "engine", self.engine),
            patch.object(garmin_sync, "UPLOAD_DIR", Path(workdir.name)),
            patch("app.metrics.store_quietly"),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def as_owner(self, owner_id):
        token = current_owner.set(owner_id)
        self.addCleanup(current_owner.reset, token)

    def activities(self):
        with Session(self.engine) as session:
            return session.exec(select(Activity)).all()

    def test_duplicates_are_skipped_per_account_and_sport(self):
        self.as_owner(ALICE)
        result = apple_health.import_workouts([outdoor_run(), outdoor_run()])
        self.assertEqual((len(result["imported"]), result["skipped"]), (1, 1))
        # Same start, other sport: a different workout
        swim = {**outdoor_run(), "name": "Pool Swim", "route": [], "heartRateData": []}
        self.assertEqual(len(apple_health.import_workouts([swim])["imported"]), 1)
        # Forty seconds later, same sport: the same workout seen from another source
        later = outdoor_run(START + timedelta(seconds=40))
        self.assertEqual(apple_health.import_workouts([later])["skipped"], 1)

        self.as_owner(BOB)
        self.assertEqual(len(apple_health.import_workouts([outdoor_run()])["imported"]), 1)
        owners = sorted(a.owner_id or "" for a in self.activities())
        self.assertEqual(owners, sorted([ALICE, ALICE, BOB]))

    def test_one_bad_workout_does_not_stop_the_rest(self):
        self.as_owner(ALICE)
        result = apple_health.import_workouts([{"name": "Broken"}, treadmill_run()])
        self.assertEqual(len(result["imported"]), 1)
        self.assertEqual(result["errors"][0]["name"], "Broken")


class WebhookScenarioTests(unittest.TestCase):
    def test_webhook_tokens_and_account_isolation(self):
        root = Path(__file__).resolve().parent.parent
        env = os.environ.copy()
        env.update(
            {
                "PYTHONPATH": str(root),
                "KINETIC_PUBLIC_ORIGIN": "http://localhost:5173",
                "KINETIC_ALLOW_INSECURE_HTTP": "1",
            }
        )
        env.pop("DATABASE_URL", None)
        with tempfile.TemporaryDirectory() as workdir:
            result = subprocess.run(
                [sys.executable, str(root / "tests" / "apple_health_scenario.py")],
                cwd=workdir,
                env=env,
                text=True,
                capture_output=True,
                timeout=120,
            )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
