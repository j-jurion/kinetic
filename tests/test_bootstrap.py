import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from datetime import datetime
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine

from app.auth import password_hash
from app.models import Activity, Friend


class BootstrapTests(unittest.TestCase):
    def test_import_backs_up_databases_and_assigns_existing_records(self):
        root = Path(__file__).resolve().parent.parent
        with tempfile.TemporaryDirectory() as workdir:
            path = Path(workdir)
            source = path / "old.db"
            db = create_engine(f"sqlite:///{source}")
            SQLModel.metadata.create_all(db)
            with Session(db) as session:
                session.add(Activity(name="Run", date=datetime(2026, 1, 1), duration_seconds=10))
                session.add(Friend(name="Friend"))
                session.commit()
            db.dispose()
            with closing(sqlite3.connect(path / "app.db")):
                pass
            env = os.environ.copy()
            env["PYTHONPATH"] = str(root)
            command = [
                sys.executable,
                "-m",
                "app.bootstrap_test_account",
                "--source",
                str(source),
                "--backup-dir",
                str(path),
            ]
            result = subprocess.run(command, cwd=path, env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            password = next(
                line.removeprefix("One-time password: ")
                for line in result.stdout.splitlines()
                if line.startswith("One-time password: ")
            )
            with closing(sqlite3.connect(path / "app.db")) as connection:
                user_id, username, hashed = connection.execute(
                    'SELECT id, username, hashed_password FROM "user"'
                ).fetchone()
                activity_owner = connection.execute("SELECT owner_id FROM activity").fetchone()[0]
                friend_owner = connection.execute("SELECT owner_id FROM friend").fetchone()[0]
            self.assertEqual(activity_owner, user_id)
            self.assertEqual(friend_owner, activity_owner)
            self.assertEqual(username, "test")
            self.assertTrue(password_hash.verify(password, hashed))
            self.assertEqual(len(list(path.glob("kinetic-*.sqlite"))), 2)
            with closing(sqlite3.connect(source)) as connection:
                self.assertIsNone(connection.execute("SELECT owner_id FROM activity").fetchone()[0])

            repeated = subprocess.run(command, cwd=path, env=env, text=True, capture_output=True)
            self.assertNotEqual(repeated.returncode, 0)
            self.assertIn("Destination database is not empty", repeated.stderr)


if __name__ == "__main__":
    unittest.main()
