"""Durations leave out the pauses: the timer time, when it can be trusted."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlmodel import Session, select

from app import maintenance
from app.fit_parser import activity_duration, moving_duration, parse_fit_file
from app.models import Activity, Lap, SportType
from tests.fit_samples import write_sessions_fit
from tests.test_maintenance import OWNER, MaintenanceTestCase

# A 5 km run of 35:41 with 8:09 of pauses: 27:32 of running, 5:30/km
PAUSED_RUN = {"total_elapsed_time": 2141, "total_timer_time": 1652, "total_distance": 5000}


class MovingDurationTests(unittest.TestCase):
    def test_uses_the_timer_time(self):
        self.assertEqual(moving_duration(PAUSED_RUN, SportType.running), 1652)

    def test_elapsed_time_that_ran_on_for_weeks(self):
        # A 31 km ride of an hour whose elapsed time says 48 days ("resume later")
        ride = {"total_elapsed_time": 4_153_605, "total_timer_time": 3717, "total_distance": 31348}
        self.assertEqual(moving_duration(ride, SportType.cycling), 3717)
        # A hike with long breaks: most of the day stopped
        hike = {"total_elapsed_time": 28800, "total_timer_time": 5400, "total_distance": 9000}
        self.assertEqual(moving_duration(hike, SportType.hiking), 5400)

    def test_falls_back_to_the_elapsed_time(self):
        cases = {
            "no timer time": {"total_elapsed_time": 2141},
            "no elapsed time": {"total_timer_time": 2141},
            "timer longer than elapsed": {"total_elapsed_time": 2141, "total_timer_time": 2500},
            # 5 km in 10 minutes is faster than the world record
            "impossible pace": {
                "total_elapsed_time": 2141, "total_timer_time": 600, "total_distance": 5000,
            },
        }
        for label, summary in cases.items():
            with self.subTest(label):
                self.assertEqual(moving_duration(summary, SportType.running), 2141)

    def test_open_water_keeps_the_elapsed_time(self):
        # The watch paused itself for most of the swim (wrist under water)
        swim = {"total_elapsed_time": 1800, "total_timer_time": 1200, "total_distance": 1500}
        self.assertEqual(activity_duration(swim, SportType.swimming, {"sub_sport": "open_water"}),
                         1800)
        self.assertEqual(activity_duration(swim, SportType.swimming, {"sub_sport": "lap_swimming"}),
                         1200)


class ParseTests(unittest.TestCase):
    def test_a_paused_run_gets_its_moving_time_and_pace(self):
        with tempfile.TemporaryDirectory() as folder:
            fit = write_sessions_fit(Path(folder) / "run.fit", [("running", 0, 2141, 1652)])
            activity, *_ = parse_fit_file(fit)
        self.assertEqual(activity.duration_seconds, 1652)

    def test_multisport_legs_keep_the_elapsed_time(self):
        with tempfile.TemporaryDirectory() as folder:
            fit = write_sessions_fit(
                Path(folder) / "duathlon.fit",
                [("running", 0, 1200, 1000), ("cycling", 1200, 1800, 1700)],
            )
            event, _, _, legs = parse_fit_file(fit)
        self.assertEqual(event.duration_seconds, 3000)
        self.assertEqual([leg.duration_seconds for leg, *_ in legs], [1200, 1800])


class RecalcDurationsTests(MaintenanceTestCase):
    def store_single(self, fit: Path, duration: float, laps: int = 0) -> int:
        activity, *_ = parse_fit_file(fit)
        with Session(self.engine) as session:
            activity.owner_id = OWNER
            activity.duration_seconds = duration  # as stored before this change
            session.add(activity)
            session.flush()
            for number in range(1, laps + 1):
                session.add(Lap(activity_id=activity.id, lap_number=number, duration_seconds=2141))
            session.commit()
            return activity.id

    def duration(self, activity_id: int) -> float:
        with Session(self.engine) as session:
            return session.get(Activity, activity_id).duration_seconds

    def test_previews_then_updates_runs_stored_with_elapsed_time(self):
        fit = write_sessions_fit(self.uploads / "run.fit", [("running", 0, 2141, 1652)])
        run = self.store_single(fit, 2141)

        preview = maintenance.recalc_durations()
        self.assertEqual([(r.activity_id, r.old, r.new, r.skipped) for r in preview],
                         [(run, 2141, 1652, "")])
        self.assertEqual(self.duration(run), 2141)  # nothing changed yet

        maintenance.recalc_durations(apply=True)
        self.assertEqual(self.duration(run), 1652)
        self.assertEqual(maintenance.recalc_durations(), [])  # done

    def test_leaves_durations_changed_by_hand(self):
        fit = write_sessions_fit(self.uploads / "run.fit", [("running", 0, 2141, 1652)])
        run = self.store_single(fit, 1700)
        reports = maintenance.recalc_durations(apply=True)
        self.assertEqual(len(reports), 1)
        self.assertIn("changed by hand", reports[0].skipped)
        self.assertEqual(self.duration(run), 1700)

    def test_leaves_multisport_events_and_runs_without_pauses_alone(self):
        steady = write_sessions_fit(self.uploads / "steady.fit", [("running", 0, 1800, 1800)])
        self.store_single(steady, 1800)
        duathlon = write_sessions_fit(
            self.uploads / "duathlon.fit",
            [("running", 0, 1200, 1000), ("cycling", 1200, 1800, 1700)],
        )
        self.store(duathlon)
        self.assertEqual(maintenance.recalc_durations(apply=True), [])
        with Session(self.engine) as session:
            durations = sorted(a.duration_seconds for a in session.exec(select(Activity)))
        self.assertEqual(durations, [1200, 1800, 1800, 3000])

    def test_skips_files_when_the_stored_speed_shows_no_pauses(self):
        # Reading a FIT file takes seconds on the server: only files that may hold pauses
        steady = write_sessions_fit(self.uploads / "steady.fit", [("running", 0, 1800, 1800)])
        paused = write_sessions_fit(self.uploads / "paused.fit", [("running", 0, 2141, 1652)])
        steady_id = self.store_single(steady, 1800)
        paused_id = self.store_single(paused, 2141)
        with Session(self.engine) as session:
            for activity_id, distance, speed in ((steady_id, 5400, 3.0), (paused_id, 6423, 3.89)):
                activity = session.get(Activity, activity_id)
                activity.distance_meters, activity.avg_speed_ms = distance, speed
            session.commit()

        read = []
        real = maintenance._file_summaries
        progress = []
        with patch.object(maintenance, "_file_summaries", lambda p: read.append(p.name) or real(p)):
            reports = maintenance.recalc_durations(progress=lambda *a: progress.append(a))
        self.assertEqual(read, ["paused.fit"])
        self.assertEqual([r.activity_id for r in reports], [paused_id])
        self.assertEqual(progress, [(1, 1, 1)])
