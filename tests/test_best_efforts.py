"""Best efforts must survive jumps in the distance data: GPS glitches and batched distance."""

import tempfile
import unittest
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app import apple_health, repair, streams
from app.fit_parser import _extract_best_efforts, _remove_distance_jumps, parse_fit_file
from app.models import Activity, BestEffort, SportType
from tests.apple_health_samples import outdoor_run
from tests.fit_samples import write_sample_run

OWNER = str(uuid.uuid4())
DATE = datetime(2026, 11, 20, 7, 0)


def series(speeds: list[float], jumps: dict[int, float] | None = None) -> list[dict]:
    """One data point per second at the given speeds, plus extra metres at some seconds."""
    points, distance = [], 0.0
    for t, speed in enumerate(speeds):
        distance += speed if t else 0.0
        distance += (jumps or {}).get(t, 0.0)
        points.append({"timestamp": DATE + timedelta(seconds=t), "distance": distance})
    return points


def efforts(
    points: list[dict], sport: SportType = SportType.running, cap: float | None = 12.0
) -> dict[float, float]:
    """The best efforts, with jumps removed first as for a file Kinetic wrote (``cap``)."""
    if cap is not None:
        _remove_distance_jumps(points, cap)
    activity = Activity(name="Run", sport=sport, date=DATE, duration_seconds=len(points))
    return {e.distance_meters: e.duration_seconds for e in _extract_best_efforts(activity, points)}


def file_efforts(path: Path) -> dict[float, float]:
    _, _, found, _ = parse_fit_file(path)
    return {e.distance_meters: e.duration_seconds for e in found}


class ExtractionTests(unittest.TestCase):
    def test_a_steady_run_is_measured_as_before(self):
        found = efforts(series([3.0] * 2001))
        self.assertAlmostEqual(found[1000], 333, delta=1)
        self.assertAlmostEqual(found[5000], 1667, delta=1)

    def test_a_batch_of_distance_does_not_count_as_running(self):
        # 900 m arrive in one second, as after a pause: 1 km would take a few seconds
        found = efforts(series([3.0] * 2001, jumps={1000: 900.0}))
        self.assertGreater(found[1000], 300)

    def test_a_gps_fix_far_off_and_back_does_not_count(self):
        # Out 900 m and straight back: 1.8 km of haversine distance in two seconds
        found = efforts(series([3.0] * 2001, jumps={1000: 900.0, 1001: 900.0}))
        self.assertGreater(found[1000], 300)
        self.assertAlmostEqual(found[5000], 1667, delta=10)

    def test_a_window_faster_than_the_world_record_is_dropped(self):
        # 9 m/s throughout: no single step looks like a jump, but 1 km in 1:51 is impossible
        self.assertNotIn(1000, efforts(series([9.0] * 400), cap=None))
        # A jump left in the data (a watch's file) only ever gives windows that are dropped
        found = efforts(series([3.0] * 2001, jumps={1000: 900.0}), cap=None)
        self.assertGreater(found[1000], 300)

    def test_cycling_keeps_fast_descents(self):
        found = efforts(series([20.0] * 400), SportType.cycling, cap=35.0)
        self.assertAlmostEqual(found[1000], 50, delta=1)


class FileTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = Path(folder.name)

    def test_jumps_are_removed_from_files_kinetic_wrote(self):
        clean = file_efforts(write_sample_run(self.folder / "clean.fit"))
        jumped = file_efforts(write_sample_run(self.folder / "jump.fit", jumps={1000: 900.0}))
        # The jump's second still counts for up to 12 m (instead of the ~3 m run in it)
        self.assertAlmostEqual(jumped[1000], clean[1000], delta=5)
        self.assertAlmostEqual(jumped[5000], clean[5000], delta=5)

    def test_a_watch_keeps_its_catch_up_after_a_gps_gap(self):
        # A Garmin adds the metres it missed in one go; that is real distance
        clean = file_efforts(write_sample_run(self.folder / "clean.fit", manufacturer=1))
        caught_up = file_efforts(
            write_sample_run(self.folder / "watch.fit", manufacturer=1, jumps={1000: 40.0})
        )
        self.assertLess(caught_up[5000], clean[5000] - 10)

    def test_apple_health_route_with_a_gps_glitch(self):
        data = outdoor_run()
        point = data["route"][1000]
        point["latitude"] += 0.008  # ~900 m north for one fix
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "run.fit"
            path.write_bytes(apple_health.to_fit(apple_health.parse_workout(data)))
            _, _, found, _ = parse_fit_file(path)
        one_km = next(e.duration_seconds for e in found if e.distance_meters == 1000)
        self.assertGreater(one_km, 250)  # 3.33 m/s: about 5 minutes, never seconds


class RepairTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        SQLModel.metadata.create_all(self.engine)
        self.addCleanup(self.engine.dispose)
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.uploads = Path(folder.name)
        for patcher in (
            patch.object(repair, "engine", self.engine),
            patch.object(streams, "UPLOAD_DIR", self.uploads),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def run_with(self, stored: dict[float, float], fit: Path | None = None) -> int:
        with Session(self.engine) as session:
            activity = Activity(
                owner_id=OWNER,
                name="Outdoor Run",
                sport=SportType.running,
                date=DATE,
                duration_seconds=1800,
                fit_file_path=str(fit) if fit else None,
            )
            session.add(activity)
            session.flush()
            for distance, seconds in stored.items():
                session.add(
                    BestEffort(
                        activity_id=activity.id,
                        sport=SportType.running,
                        distance_meters=distance,
                        duration_seconds=seconds,
                        date=DATE,
                        year=DATE.year,
                    )
                )
            session.commit()
            return activity.id

    def stored(self, activity_id: int) -> dict[float, float]:
        with Session(self.engine) as session:
            rows = session.exec(select(BestEffort).where(BestEffort.activity_id == activity_id))
            return {row.distance_meters: row.duration_seconds for row in rows}

    def test_efforts_are_recomputed_from_the_file(self):
        fit = write_sample_run(self.uploads / "run.fit")
        activity_id = self.run_with({1000: 23, 5000: 1500}, fit)
        self.assertEqual(repair.repair_impossible_best_efforts(), 1)
        found = self.stored(activity_id)
        self.assertGreater(found[1000], 250)  # the sample run is about 3 m/s
        self.assertIn(5000, found)

    def test_without_a_file_only_the_impossible_ones_go(self):
        activity_id = self.run_with({1000: 23, 5000: 1500})
        self.assertEqual(repair.repair_impossible_best_efforts(), 1)
        self.assertEqual(self.stored(activity_id), {5000: 1500})

    def test_plausible_efforts_are_left_alone_and_it_is_safe_to_repeat(self):
        activity_id = self.run_with({1000: 210, 5000: 1200})
        self.run_with({1000: 23})
        self.assertEqual(repair.repair_impossible_best_efforts(), 1)
        self.assertEqual(repair.repair_impossible_best_efforts(), 0)
        self.assertEqual(self.stored(activity_id), {1000: 210, 5000: 1200})


if __name__ == "__main__":
    unittest.main()
