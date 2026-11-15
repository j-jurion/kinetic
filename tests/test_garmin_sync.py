import tempfile
import unittest
import uuid
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app import garmin_sync
from app.models import Activity
from app.ownership import current_owner

ALICE, BOB = str(uuid.uuid4()), str(uuid.uuid4())


class GarminSyncIsolationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        SQLModel.metadata.create_all(self.engine)
        self.addCleanup(self.engine.dispose)
        workdir = tempfile.TemporaryDirectory()
        self.addCleanup(workdir.cleanup)
        root = Path(workdir.name)
        for patcher in (
            patch.object(garmin_sync, "engine", self.engine),
            patch.object(garmin_sync, "TOKEN_ROOT", root / "tokens"),
            patch.object(garmin_sync, "UPLOAD_DIR", root / "uploads"),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def as_owner(self, owner_id):
        token = current_owner.set(owner_id)
        self.addCleanup(current_owner.reset, token)

    def test_tokens_and_email_are_per_account(self):
        self.as_owner(ALICE)
        (garmin_sync._token_dir() / "garmin_tokens.json").write_text("{}")
        garmin_sync.save_email("alice@garmin.example")
        self.as_owner(BOB)
        self.assertFalse(garmin_sync.tokens_exist())
        self.assertEqual(garmin_sync.saved_email(), "")
        garmin_sync.logout()
        self.as_owner(ALICE)
        self.assertTrue(garmin_sync.tokens_exist())
        self.assertEqual(garmin_sync.saved_email(), "alice@garmin.example")

    def test_requires_a_valid_account(self):
        with self.assertRaises(PermissionError):
            garmin_sync.tokens_exist()
        self.as_owner("../alice")
        with self.assertRaises(ValueError):
            garmin_sync.tokens_exist()

    def test_imports_and_duplicate_checks_are_per_account(self):
        def parsed(_path):
            activity = Activity(name="Run", date=datetime(2026, 1, 1), duration_seconds=60)
            return activity, [], [], []

        with patch.object(garmin_sync, "parse_fit_file", parsed):
            self.as_owner(ALICE)
            garmin_sync._save_fit_and_import(42, b"fit", "Alice run")
            self.assertTrue(garmin_sync._garmin_id_exists(42))
            self.as_owner(BOB)
            self.assertFalse(garmin_sync._garmin_id_exists(42))
            garmin_sync._save_fit_and_import(42, b"fit", "Bob run")

        with Session(self.engine) as session:
            owners = session.exec(select(Activity.name, Activity.owner_id)).all()
        self.assertEqual(sorted(owners), [("Alice run", ALICE), ("Bob run", BOB)])

    def test_one_sync_at_a_time_per_account(self):
        self.as_owner(ALICE)
        garmin_sync._running_syncs.add(ALICE)
        self.addCleanup(garmin_sync._running_syncs.discard, ALICE)
        with self.assertRaisesRegex(RuntimeError, "already running"):
            garmin_sync.sync_garmin_activities(datetime(2026, 1, 1).date())


if __name__ == "__main__":
    unittest.main()
