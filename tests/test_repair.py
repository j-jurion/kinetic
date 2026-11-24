import json
import tempfile
import unittest
import uuid
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app import metrics, repair, streams
from app.fit_parser import parse_fit_file
from app.models import (
    Activity,
    ActivityFriend,
    ActivityKind,
    ActivityMetrics,
    BestEffort,
    Friend,
    Lap,
    SportType,
)
from tests.fit_samples import write_sample_run, write_sessions_fit

OWNER = str(uuid.uuid4())
DATE = datetime(2026, 11, 20, 7, 0)


class SingleLegParsingTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = Path(folder.name)

    def test_a_single_leg_from_a_multisport_profile_is_a_normal_activity(self):
        fit = write_sample_run(self.folder / "run.fit", multisport_profile=True)
        activity, laps, efforts, children = parse_fit_file(fit)
        self.assertEqual(activity.sport, SportType.running)
        self.assertEqual(children, [])
        self.assertEqual(len(laps), 1)
        self.assertTrue(efforts)

    def test_a_single_leg_with_a_transition_uses_the_leg(self):
        fit = write_sessions_fit(
            self.folder / "swim.fit",
            [("swimming", 0, 1500, 1500), ("transition", 1500, 90, 90)],
            multisport_profile=True,
        )
        activity, _, _, children = parse_fit_file(fit)
        self.assertEqual((activity.sport, activity.duration_seconds), (SportType.swimming, 1500))
        self.assertEqual(children, [])

    def test_two_legs_of_one_sport_are_multisport_only_from_a_multisport_profile(self):
        legs = [("running", 0, 1200, 1200), ("running", 1300, 1200, 1200)]
        tagged = write_sessions_fit(self.folder / "a.fit", legs, multisport_profile=True)
        manual = write_sessions_fit(self.folder / "b.fit", legs)
        self.assertEqual(len(parse_fit_file(tagged)[3]), 2)
        self.assertEqual(parse_fit_file(manual)[3], [])  # a paused and resumed run


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
            patch.object(metrics, "engine", self.engine),
            patch.object(streams, "UPLOAD_DIR", self.uploads),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def add(self, session, **fields):
        activity = Activity(owner_id=OWNER, date=DATE, duration_seconds=1800, **fields)
        session.add(activity)
        session.flush()
        return activity

    def broken_event(self, name="Multisport 20-11-2026", fit=None):
        """A single-leg event as earlier versions imported it, with a friend tagged on it."""
        with Session(self.engine) as session:
            event = self.add(
                session,
                name=name,
                sport=SportType.multisport,
                kind=ActivityKind.race,
                fit_file_path=str(fit) if fit else None,
                garmin_activity_id=77,
            )
            leg = self.add(
                session,
                name="Swimming 20-11-2026",
                sport=SportType.swimming,
                parent_id=event.id,
                distance_meters=1500,
                avg_heart_rate=131,
                route_json=json.dumps([[51.0, 4.0], [51.0, 4.01]]),
                fit_file_path=str(fit) if fit else None,
            )
            friend = Friend(owner_id=OWNER, name="Bob")
            session.add(friend)
            session.flush()
            for activity_id in (event.id, leg.id):
                session.add(ActivityFriend(activity_id=activity_id, friend_id=friend.id))
            session.add(
                BestEffort(
                    activity_id=leg.id,
                    sport=SportType.swimming,
                    distance_meters=1000,
                    duration_seconds=1100,
                    date=DATE,
                    year=2026,
                )
            )
            session.add(Lap(activity_id=leg.id, lap_number=1, duration_seconds=1800))
            session.add(ActivityMetrics(activity_id=event.id))
            session.commit()
            return event.id, leg.id

    def rows(self, model, *where):
        with Session(self.engine) as session:
            return session.exec(select(model).where(*where)).all()

    def test_without_the_file_the_leg_becomes_the_activity(self):
        event_id, leg_id = self.broken_event()
        self.assertEqual(repair.repair_single_leg_events(), 1)

        with Session(self.engine) as session:
            activity = session.get(Activity, event_id)
            self.assertIsNone(session.get(Activity, leg_id))
        self.assertEqual(activity.sport, SportType.swimming)
        self.assertEqual(activity.name, "Swimming 20-11-2026")  # the importer's name is replaced
        self.assertEqual((activity.distance_meters, activity.avg_heart_rate), (1500, 131))
        self.assertIsNotNone(activity.route_json)
        # What the user set on the event stays
        self.assertEqual((activity.kind, activity.garmin_activity_id), (ActivityKind.race, 77))
        self.assertEqual(len(self.rows(ActivityFriend, ActivityFriend.activity_id == event_id)), 1)
        # The leg's laps and best efforts move over; nothing of the leg is left
        self.assertEqual(len(self.rows(BestEffort, BestEffort.activity_id == event_id)), 1)
        self.assertEqual(len(self.rows(Lap, Lap.activity_id == event_id)), 1)
        self.assertEqual(self.rows(ActivityFriend, ActivityFriend.activity_id == leg_id), [])
        # Metrics are recomputed for the activity
        self.assertEqual(
            len(self.rows(ActivityMetrics, ActivityMetrics.activity_id == event_id)), 1
        )

    def test_with_the_file_its_laps_and_best_efforts_are_used(self):
        fit = write_sample_run(self.uploads / "run.fit", multisport_profile=True)
        event_id, _ = self.broken_event(name="Morning run", fit=fit)
        repair.repair_single_leg_events()

        with Session(self.engine) as session:
            activity = session.get(Activity, event_id)
        self.assertEqual(activity.sport, SportType.running)  # from the file, not the leg
        self.assertEqual(activity.name, "Morning run")  # a chosen name is kept
        self.assertEqual(activity.duration_seconds, 1800)
        efforts = self.rows(BestEffort, BestEffort.activity_id == event_id)
        self.assertTrue(efforts)
        self.assertTrue(all(e.sport == SportType.running for e in efforts))
        self.assertEqual(len(self.rows(Lap, Lap.activity_id == event_id)), 1)

    def test_real_multisport_events_are_left_alone_and_it_is_safe_to_repeat(self):
        with Session(self.engine) as session:
            event = self.add(session, name="Triathlon", sport=SportType.triathlon)
            for sport in (SportType.swimming, SportType.cycling, SportType.running):
                self.add(session, name=sport.value, sport=sport, parent_id=event.id)
            session.commit()
            event_id = event.id
        self.broken_event()

        self.assertEqual(repair.repair_single_leg_events(), 1)
        self.assertEqual(repair.repair_single_leg_events(), 0)
        self.assertEqual(len(self.rows(Activity, Activity.parent_id == event_id)), 3)
        sports = {a.sport for a in self.rows(Activity, Activity.parent_id.is_(None))}
        self.assertEqual(sports, {SportType.triathlon, SportType.swimming})


if __name__ == "__main__":
    unittest.main()
