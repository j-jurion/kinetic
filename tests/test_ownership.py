import unittest
from datetime import datetime

from sqlalchemy import func, update
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models import (
    Activity,
    ActivityFriend,
    BestEffort,
    Friend,
    FriendRequest,
    Lap,
    RaceResult,
    RaceResultSplit,
    SportType,
)
from app.ownership import UserSession, current_owner


class OwnershipTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        SQLModel.metadata.create_all(self.engine)
        self.token = current_owner.set("alice")
        with UserSession(self.engine) as session:
            activity = Activity(name="Alice", date=datetime(2026, 1, 1), duration_seconds=10)
            friend = Friend(name="Alice's friend")
            session.add(activity)
            session.add(friend)
            session.commit()
            session.refresh(activity)
            session.refresh(friend)
            self.alice_activity = activity.id
            self.alice_friend = friend.id
            session.add(Lap(activity_id=activity.id, lap_number=1))
            session.add(
                BestEffort(
                    activity_id=activity.id,
                    sport=SportType.running,
                    distance_meters=1000,
                    duration_seconds=300,
                    date=datetime(2026, 1, 1),
                    year=2026,
                )
            )
            session.add(ActivityFriend(activity_id=activity.id, friend_id=friend.id))
            race = RaceResult(activity_id=activity.id)
            session.add(race)
            session.commit()
            session.refresh(race)
            session.add(RaceResultSplit(race_result_id=race.id, label="Split", order=1))
            session.commit()
        current_owner.set("bob")
        with UserSession(self.engine) as session:
            activity = Activity(
                name="Bob", date=datetime(2026, 1, 1), duration_seconds=20, sport=SportType.cycling
            )
            session.add(activity)
            session.commit()
            session.refresh(activity)
            self.bob_activity = activity.id
            session.add(
                BestEffort(
                    activity_id=activity.id,
                    sport=SportType.running,
                    distance_meters=1000,
                    duration_seconds=200,
                    date=datetime(2026, 1, 1),
                    year=2026,
                )
            )
            session.commit()

    def tearDown(self):
        current_owner.reset(self.token)
        self.engine.dispose()

    def test_reads_and_column_queries_are_scoped(self):
        with UserSession(self.engine) as session:
            self.assertEqual([a.name for a in session.exec(select(Activity)).all()], ["Bob"])
            self.assertIsNone(session.get(Activity, self.alice_activity))
            self.assertEqual(session.exec(select(Activity.sport)).all(), [SportType.cycling])
            self.assertEqual(session.exec(select(Lap)).all(), [])
            self.assertEqual(session.exec(select(ActivityFriend)).all(), [])
            self.assertEqual(session.exec(select(RaceResult)).all(), [])
            self.assertEqual(session.exec(select(RaceResultSplit)).all(), [])
            self.assertEqual(session.exec(select(func.count(BestEffort.id))).one(), 1)
            self.assertEqual(
                [effort.duration_seconds for effort in session.exec(select(BestEffort)).all()],
                [200],
            )

    def test_cross_account_references_and_bulk_writes_are_rejected(self):
        with UserSession(self.engine) as session:
            session.add(Lap(activity_id=self.alice_activity, lap_number=2))
            with self.assertRaises(PermissionError):
                session.commit()
        with UserSession(self.engine) as session:
            session.add(
                ActivityFriend(activity_id=self.bob_activity, friend_id=self.alice_friend)
            )
            with self.assertRaises(PermissionError):
                session.commit()
        with UserSession(self.engine) as session:
            session.add(RaceResultSplit(race_result_id=1, label="other account", order=2))
            with self.assertRaises(PermissionError):
                session.commit()
        with UserSession(self.engine) as session:
            with self.assertRaises(PermissionError):
                session.exec(update(Activity).values(name="changed"))
            with self.assertRaises(PermissionError):
                session.exec(select(SQLModel.metadata.tables["activity"]))

    def test_existing_child_cannot_be_reassigned_across_accounts(self):
        with Session(self.engine) as session:
            lap = session.exec(select(Lap)).one()
            session.expunge(lap)
        lap.activity_id = self.bob_activity
        with UserSession(self.engine) as session:
            session.add(lap)
            with self.assertRaises(PermissionError):
                session.commit()

    def test_missing_identity_is_rejected(self):
        current_owner.set(None)
        with self.assertRaises(PermissionError):
            UserSession(self.engine)

    def test_friend_links_and_requests_cannot_be_written(self):
        with UserSession(self.engine) as session:
            session.add(Friend(name="Linked", user_id="alice"))
            with self.assertRaises(PermissionError):
                session.commit()
        current_owner.set("alice")
        with UserSession(self.engine) as session:
            friend = session.get(Friend, self.alice_friend)
            friend.user_id = "bob"
            with self.assertRaises(PermissionError):
                session.commit()
        with UserSession(self.engine) as session:
            session.add(FriendRequest(from_user_id="alice", to_user_id="bob"))
            with self.assertRaises(PermissionError):
                session.commit()
        with Session(self.engine) as session:
            session.add(FriendRequest(from_user_id="carol", to_user_id="dave"))
            session.commit()
        with UserSession(self.engine) as session:
            self.assertEqual(session.exec(select(FriendRequest)).all(), [])


if __name__ == "__main__":
    unittest.main()
