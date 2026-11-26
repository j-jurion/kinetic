import json
import os
import tempfile
import time
import unittest
import uuid
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app import maintenance, metrics, streams
from app.fit_parser import parse_fit_file
from app.models import Activity, ActivityKind, BestEffort, SportType
from tests.fit_samples import write_sample_run, write_sessions_fit

OWNER = str(uuid.uuid4())
# swim (auto-paused: 74 s of timer in 1200 s), transition, bike, transition, run
TRIATHLON = [
    ("swimming", 0, 1200, 74),
    ("transition", 1200, 60, 60),
    ("cycling", 1260, 1800, 1800),
    ("transition", 3060, 60, 60),
    ("running", 3120, 1200, 1200),
]


class MaintenanceTestCase(unittest.TestCase):
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
            patch.object(maintenance, "engine", self.engine),
            patch.object(metrics, "engine", self.engine),
            patch.object(streams, "UPLOAD_DIR", self.uploads),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def store(self, fit: Path, **event_fields) -> int:
        """Stores the file's activities as the importer does, then applies changes."""
        parent, _, _, legs = parse_fit_file(fit)
        with Session(self.engine) as session:
            parent.owner_id = OWNER
            for key, value in event_fields.items():
                setattr(parent, key, value)
            session.add(parent)
            session.flush()
            for leg, _laps, efforts, *_ in legs:
                leg.owner_id, leg.parent_id = OWNER, parent.id
                session.add(leg)
                session.flush()
                for effort in efforts:
                    effort.activity_id = leg.id
                    session.add(effort)
            session.commit()
            return parent.id

    def legs(self, event_id):
        with Session(self.engine) as session:
            return session.exec(
                select(Activity).where(Activity.parent_id == event_id).order_by(Activity.date)
            ).all()


class RecalcMultisportTests(MaintenanceTestCase):
    def age_like_before_elapsed_time(self, event_id):
        """What earlier versions stored: the swim at its timer time, with its route cut short."""
        with Session(self.engine) as session:
            event = session.get(Activity, event_id)
            event.duration_seconds = 74 + 60 + 1800 + 60 + 1200
            swim = session.exec(
                select(Activity).where(Activity.parent_id == event_id).order_by(Activity.date)
            ).first()
            swim.duration_seconds = 74
            swim.route_json = json.dumps(json.loads(swim.route_json)[:14])
            session.commit()

    def test_previews_then_updates_durations_and_routes(self):
        fit = write_sessions_fit(self.uploads / "tri.fit", TRIATHLON, multisport_profile=True)
        event_id = self.store(fit, name="Olympic tri", kind=ActivityKind.race)
        self.age_like_before_elapsed_time(event_id)

        preview = maintenance.recalc_multisport()
        self.assertEqual(len(preview), 1)
        self.assertEqual(
            preview[0].changes,
            ["event 0:53:14 -> 1:12:00", "swimming leg: 0:01:14 -> 0:20:00, route"],
        )
        self.assertEqual(self.legs(event_id)[0].duration_seconds, 74)  # nothing changed yet

        maintenance.recalc_multisport(apply=True)
        with Session(self.engine) as session:
            event = session.get(Activity, event_id)
        self.assertEqual(
            (event.duration_seconds, event.name, event.kind),
            (4320, "Olympic tri", ActivityKind.race),
        )
        swim, bike, run = self.legs(event_id)
        self.assertEqual(swim.duration_seconds, 1200)
        self.assertGreaterEqual(len(json.loads(swim.route_json)), 120)
        self.assertEqual((bike.duration_seconds, run.duration_seconds), (1800, 1200))
        # Done: a second run finds nothing to change
        self.assertEqual(maintenance.recalc_multisport()[0].changes, [])

    def test_leaves_events_it_cannot_match_alone(self):
        fit = write_sessions_fit(self.uploads / "tri.fit", TRIATHLON, multisport_profile=True)
        event_id = self.store(fit)
        with Session(self.engine) as session:
            session.delete(self.legs(event_id)[2])  # a leg deleted since the import
            session.commit()
        no_file = self.store(write_sessions_fit(self.uploads / "gone.fit", TRIATHLON, True))
        (self.uploads / "gone.fit").unlink()

        reports = {r.event_id: r for r in maintenance.recalc_multisport(apply=True)}
        self.assertEqual(reports[event_id].skipped, "its legs do not match the file one to one")
        self.assertEqual(reports[no_file].skipped, "its FIT file is not on the server")
        self.assertEqual(len(self.legs(event_id)), 2)

    def test_best_efforts_of_a_leg_are_replaced(self):
        fit = write_sessions_fit(self.uploads / "tri.fit", TRIATHLON, multisport_profile=True)
        event_id = self.store(fit)
        self.age_like_before_elapsed_time(event_id)
        swim = self.legs(event_id)[0]
        with Session(self.engine) as session:
            session.add(
                BestEffort(
                    activity_id=swim.id,
                    sport=SportType.swimming,
                    distance_meters=99999,
                    duration_seconds=1,
                    date=swim.date,
                    year=2026,
                )
            )
            session.commit()
        maintenance.recalc_multisport(apply=True)
        with Session(self.engine) as session:
            efforts = session.exec(
                select(BestEffort).where(BestEffort.activity_id == swim.id)
            ).all()
        self.assertNotIn(99999, [e.distance_meters for e in efforts])


class CleanUploadsTests(MaintenanceTestCase):
    def old(self, path: Path) -> Path:
        then = time.time() - 2 * maintenance.RECENT_SECONDS
        os.utime(path, (then, then))
        return path

    def test_removes_only_what_nothing_uses(self):
        used = write_sample_run(self.uploads / "used.fit")
        with Session(self.engine) as session:
            session.add(
                Activity(
                    owner_id=OWNER,
                    name="Run",
                    date=datetime(2026, 1, 1),
                    duration_seconds=1800,
                    fit_file_path=str(used),
                )
            )
            session.commit()
        cache = self.uploads / "used.0123456789abcdef.streams.json.gz"
        cache.write_bytes(b"x")
        unused = self.old(write_sample_run(self.uploads / "unused.fit"))
        orphan = self.uploads / "gone.0123456789abcdef.streams.json.gz"
        orphan.write_bytes(b"x")
        self.old(orphan)
        temporary = self.uploads / "x.streams.json.gz.tmp"
        temporary.write_bytes(b"x")
        self.old(temporary)
        fresh = write_sample_run(self.uploads / "being-imported.fit")
        for path in (used, cache):
            self.old(path)

        report = maintenance.clean_uploads()
        self.assertEqual(
            (report.unused_fit, report.orphan_caches, report.temporary),
            ([unused], [orphan], [temporary]),
        )
        self.assertTrue(unused.exists())  # a preview deletes nothing

        maintenance.clean_uploads(apply=True)
        self.assertEqual(
            sorted(p.name for p in self.uploads.iterdir()),
            sorted([used.name, cache.name, fresh.name]),
        )
        self.assertEqual(maintenance.clean_uploads().files, [])


if __name__ == "__main__":
    unittest.main()


class MarkRacesTests(MaintenanceTestCase):
    def setUp(self):
        super().setUp()
        from app.auth import AuthBase, User

        AuthBase.metadata.create_all(self.engine)
        with Session(self.engine) as session:
            for owner, name in ((OWNER, "joeri"), ("other", "bob")):
                session.add(User(id=owner, username=name, hashed_password="x"))
            for owner, name, start in (
                (OWNER, "Marathon", datetime(2024, 10, 20, 7, 1, 31)),
                (OWNER, "Training", datetime(2024, 10, 22, 7, 1)),
                ("other", "Bob's marathon", datetime(2024, 10, 20, 7, 1)),
            ):
                session.add(Activity(owner_id=owner, name=name, sport=SportType.running,
                                     date=start, duration_seconds=3600, distance_meters=10000))
            session.commit()

    def kinds(self):
        with Session(self.engine) as session:
            return {a.name: a.kind for a in session.exec(select(Activity)).all()}

    def test_previews_then_marks_only_the_accounts_activity(self):
        marks = maintenance.mark_races("joeri", ["2024-10-20T07:01"])
        self.assertEqual([m.activity.name for m in marks], ["Marathon"])
        self.assertEqual(self.kinds()["Marathon"], ActivityKind.training)

        maintenance.mark_races("joeri", ["2024-10-20 07:01"], apply=True)
        kinds = self.kinds()
        self.assertEqual(kinds["Marathon"], ActivityKind.race)
        self.assertEqual(kinds["Training"], ActivityKind.training)
        self.assertEqual(kinds["Bob's marathon"], ActivityKind.training)

    def test_changes_nothing_when_a_time_matches_no_activity(self):
        marks = maintenance.mark_races("joeri", ["2024-10-20T07:01", "2024-10-21T07:01"], True)
        self.assertEqual(marks[1].problem, "no activity starts then")
        self.assertEqual(self.kinds()["Marathon"], ActivityKind.training)
