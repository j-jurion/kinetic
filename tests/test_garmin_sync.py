import io
import os
import tempfile
import unittest
import uuid
import zipfile
from datetime import date, datetime
from pathlib import Path
from unittest.mock import patch

from cryptography.fernet import Fernet
from garminconnect import GarminConnectAuthenticationError, GarminConnectTooManyRequestsError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app import garmin_sync, metrics, token_crypto
from app.models import Activity
from app.ownership import current_owner

ALICE, BOB = str(uuid.uuid4()), str(uuid.uuid4())


def parsed(_path, children=()):
    activity = Activity(name="Run", date=datetime(2026, 1, 1), duration_seconds=60)
    return activity, [], [], list(children)


def fit_zip() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        zf.writestr("activity.fit", b"fit")
    return buffer.getvalue()


class FakeGarmin:
    """Stands in for the garminconnect client; `failures` maps an id to errors to raise."""

    class ActivityDownloadFormat:
        ORIGINAL = "original"

    class client:  # noqa: N801  (mirrors garminconnect's attribute name)
        @staticmethod
        def dumps():
            return '{"refreshed": true}'

    def __init__(self, ids, failures=None):
        self.ids = ids
        self.failures = {k: list(v) for k, v in (failures or {}).items()}
        self.downloads: list[int] = []

    def get_activities_by_date(self, _start, _end):
        return [{"activityId": i, "activityName": f"Run {i}"} for i in self.ids]

    def download_activity(self, garmin_id, dl_fmt):
        self.downloads.append(garmin_id)
        pending = self.failures.get(garmin_id)
        if pending:
            raise pending.pop(0)
        return fit_zip()


class GarminTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        SQLModel.metadata.create_all(self.engine)
        self.addCleanup(self.engine.dispose)
        workdir = tempfile.TemporaryDirectory()
        self.addCleanup(workdir.cleanup)
        root = Path(workdir.name)
        self.root = root
        self.uploads = root / "uploads"
        self.key = Fernet.generate_key().decode()
        for patcher in (
            patch.dict(os.environ, {token_crypto.KEY_ENV: self.key}),
            patch.object(garmin_sync, "engine", self.engine),
            patch.object(metrics, "engine", self.engine),
            patch.object(garmin_sync, "TOKEN_ROOT", root / "tokens"),
            patch.object(garmin_sync, "UPLOAD_DIR", root / "uploads"),
            patch.object(garmin_sync, "DOWNLOAD_PAUSE_SECONDS", 0),
            patch.object(garmin_sync, "RATE_LIMIT_WAIT_SECONDS", 0),
            patch.object(garmin_sync, "parse_fit_file", parsed),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def as_owner(self, owner_id):
        token = current_owner.set(owner_id)
        self.addCleanup(current_owner.reset, token)


class GarminSyncIsolationTests(GarminTestCase):
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
        self.as_owner(ALICE)
        garmin_sync.import_fit_bytes(b"fit", garmin_activity_id=42, name="Alice run")
        self.assertEqual(garmin_sync._existing_garmin_ids(), {42})
        self.as_owner(BOB)
        self.assertEqual(garmin_sync._existing_garmin_ids(), set())
        garmin_sync.import_fit_bytes(b"fit", garmin_activity_id=42, name="Bob run")

        with Session(self.engine) as session:
            owners = session.exec(select(Activity.name, Activity.owner_id)).all()
        self.assertEqual(sorted(owners), [("Alice run", ALICE), ("Bob run", BOB)])

    def test_one_sync_at_a_time_per_account(self):
        self.as_owner(ALICE)
        garmin_sync._running_syncs.add(ALICE)
        self.addCleanup(garmin_sync._running_syncs.discard, ALICE)
        with self.assertRaisesRegex(garmin_sync.GarminError, "already running"):
            garmin_sync.sync_garmin_activities(datetime(2026, 1, 1).date())


class GarminSyncRunTests(GarminTestCase):
    """Runs the sync loop against a fake Garmin client."""

    def sync(self, garmin):
        self.as_owner(ALICE)
        (garmin_sync._token_dir() / "garmin_tokens.json").write_text("{}")
        with patch.object(garmin_sync, "login_with_tokens", lambda: garmin):
            return garmin_sync.sync_garmin_activities(date(2026, 1, 1), date(2026, 1, 31))

    def activity_names(self):
        with Session(self.engine) as session:
            return sorted(session.exec(select(Activity.name)).all())

    def test_retries_once_after_a_rate_limit(self):
        garmin = FakeGarmin([1, 2], {1: [GarminConnectTooManyRequestsError("429")]})
        result = self.sync(garmin)
        self.assertEqual((result["imported"], result["errors"]), (2, []))
        self.assertEqual(garmin.downloads, [1, 1, 2])

    def test_stops_when_still_rate_limited(self):
        limited = [GarminConnectTooManyRequestsError("429")] * 2
        garmin = FakeGarmin([1, 2, 3], {2: limited})
        result = self.sync(garmin)
        self.assertEqual(result["imported"], 1)
        self.assertEqual(garmin.downloads, [1, 2, 2])  # activity 3 is left for next time
        self.assertEqual(len(result["errors"]), 1)
        self.assertIn("2 activities left", result["errors"][0])

    def test_skips_activities_already_imported(self):
        self.sync(FakeGarmin([1]))
        garmin = FakeGarmin([1, 2])
        result = self.sync(garmin)
        self.assertEqual((result["imported"], result["skipped"]), (1, 1))
        self.assertEqual(garmin.downloads, [2])

    def test_failed_multisport_import_leaves_nothing_behind(self):
        broken_leg = Activity(name="Bike", date=None, duration_seconds=60)  # NOT NULL fails
        with patch.object(
            garmin_sync, "parse_fit_file", lambda p: parsed(p, [(broken_leg, [], [])])
        ):
            result = self.sync(FakeGarmin([1]))
        self.assertEqual(result["imported"], 0)
        self.assertEqual(len(result["errors"]), 1)
        self.assertEqual(self.activity_names(), [])
        self.assertEqual(list(self.uploads.iterdir()), [])
        # Nothing was half-stored, so the next sync imports it
        self.assertEqual(self.sync(FakeGarmin([1]))["imported"], 1)

    def test_rejected_tokens_are_removed(self):
        self.as_owner(ALICE)
        (garmin_sync._token_dir() / "garmin_tokens.json").write_text("{}")

        def rejected():
            raise GarminConnectAuthenticationError("401")

        with patch.object(garmin_sync, "login_with_tokens", rejected):
            with self.assertRaisesRegex(garmin_sync.GarminError, "sign in again"):
                garmin_sync.sync_garmin_activities(date(2026, 1, 1))
        self.assertFalse(garmin_sync.tokens_exist())

    def test_database_rejects_a_second_copy(self):
        self.as_owner(ALICE)
        garmin_sync.import_fit_bytes(b"fit", garmin_activity_id=7)
        with self.assertRaises(IntegrityError):
            garmin_sync.import_fit_bytes(b"fit", garmin_activity_id=7)
        self.assertEqual(len(list(self.uploads.iterdir())), 1)
        # A sync that started before the first import landed counts it as skipped
        real = garmin_sync._existing_garmin_ids
        stale = [set()]  # the first lookup misses it, as if it landed just after
        garmin = FakeGarmin([7])
        with patch.object(
            garmin_sync, "_existing_garmin_ids", lambda: stale.pop() if stale else real()
        ):
            result = self.sync(garmin)
        self.assertEqual(garmin.downloads, [7])
        self.assertEqual((result["imported"], result["skipped"], result["errors"]), (0, 1, []))



class GarminTokenEncryptionTests(GarminTestCase):
    def account_files(self):
        return {p.name: p.read_bytes() for p in garmin_sync._token_dir().iterdir()}

    def test_tokens_and_email_are_encrypted_on_disk(self):
        self.as_owner(ALICE)
        garmin_sync.save_tokens(FakeGarmin([]))
        garmin_sync.save_email("alice@garmin.example")
        files = self.account_files()
        self.assertEqual(sorted(files), ["garmin_email.enc", "garmin_tokens.enc"])
        for content in files.values():
            self.assertNotIn(b"alice", content)
            self.assertNotIn(b"refreshed", content)
        self.assertEqual(garmin_sync.load_tokens(), '{"refreshed": true}')
        self.assertEqual(garmin_sync.saved_email(), "alice@garmin.example")
        for path in garmin_sync._token_dir().iterdir():
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_plain_text_files_of_earlier_versions_are_encrypted(self):
        self.as_owner(ALICE)
        directory = garmin_sync._token_dir()
        (directory / "garmin_tokens.json").write_text('{"old": 1}')
        (directory / "garmin_email").write_text("alice@garmin.example")
        self.assertTrue(garmin_sync.tokens_exist())
        self.assertEqual(garmin_sync.saved_email(), "alice@garmin.example")
        self.assertEqual(sorted(self.account_files()), ["garmin_email.enc", "garmin_tokens.enc"])
        self.assertEqual(garmin_sync.load_tokens(), '{"old": 1}')

    def test_without_a_key_garmin_is_refused_and_plain_text_is_kept(self):
        self.as_owner(ALICE)
        (garmin_sync._token_dir() / "garmin_tokens.json").write_text("{}")
        with patch.dict(os.environ, {token_crypto.KEY_ENV: "", "KINETIC_ALLOW_INSECURE_HTTP": ""}):
            self.assertTrue(garmin_sync.tokens_exist())
            self.assertEqual(garmin_sync.saved_email(), "")
            with self.assertRaisesRegex(token_crypto.TokenKeyError, "not configured"):
                garmin_sync.save_email("alice@garmin.example")
        self.assertEqual(sorted(self.account_files()), ["garmin_tokens.json"])

    def test_tokens_from_another_key_ask_to_sign_in_again(self):
        self.as_owner(ALICE)
        garmin_sync.save_tokens(FakeGarmin([]))
        with patch.dict(os.environ, {token_crypto.KEY_ENV: Fernet.generate_key().decode()}):
            with self.assertRaisesRegex(garmin_sync.GarminError, "sign in again"):
                garmin_sync.load_tokens()
        self.assertFalse(garmin_sync.tokens_exist())

    def test_keys_can_be_rotated(self):
        self.as_owner(ALICE)
        garmin_sync.save_tokens(FakeGarmin([]))
        rotated = f"{Fernet.generate_key().decode()},{self.key}"
        with patch.dict(os.environ, {token_crypto.KEY_ENV: rotated}):
            self.assertEqual(garmin_sync.load_tokens(), '{"refreshed": true}')

    def test_sync_stores_refreshed_tokens(self):
        self.as_owner(ALICE)
        garmin_sync.save_email("alice@garmin.example")
        (garmin_sync._token_dir() / "garmin_tokens.json").write_text('{"old": 1}')
        with patch.object(garmin_sync, "login_with_tokens", lambda: FakeGarmin([])):
            garmin_sync.sync_garmin_activities(date(2026, 1, 1), date(2026, 1, 31))
        self.assertEqual(garmin_sync.load_tokens(), '{"refreshed": true}')

    def test_forget_account_removes_its_files_only(self):
        self.as_owner(ALICE)
        garmin_sync.save_email("alice@garmin.example")
        self.as_owner(BOB)
        garmin_sync.save_email("bob@garmin.example")
        garmin_sync.forget_account(ALICE)
        self.assertEqual(garmin_sync.saved_email(), "bob@garmin.example")
        self.as_owner(ALICE)
        self.assertEqual(garmin_sync.saved_email(), "")


if __name__ == "__main__":
    unittest.main()
