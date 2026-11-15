import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from app.auth import password_hash

LEGACY_SCHEMA = """
CREATE TABLE user (
    id CHAR(36) NOT NULL, email VARCHAR(320) NOT NULL, hashed_password VARCHAR(1024) NOT NULL,
    is_active BOOLEAN NOT NULL, is_superuser BOOLEAN NOT NULL, is_verified BOOLEAN NOT NULL,
    PRIMARY KEY (id)
);
CREATE UNIQUE INDEX ix_user_email ON user (email);
CREATE TABLE accesstoken (
    user_id CHAR(36) NOT NULL, token VARCHAR(43) NOT NULL, created_at TIMESTAMP NOT NULL,
    PRIMARY KEY (token), FOREIGN KEY(user_id) REFERENCES user (id) ON DELETE cascade
);
INSERT INTO user VALUES ('id-1', 'Joe@example.com', 'x', 1, 0, 1);
INSERT INTO user VALUES ('id-2', 'joe@other.example', 'x', 1, 0, 0);
INSERT INTO user VALUES ('id-3', '+@example.com', 'x', 1, 0, 1);
INSERT INTO accesstoken VALUES ('id-1', 'old-token', '2026-01-01 00:00:00');
"""


class AuthMigrationTests(unittest.TestCase):
    def test_email_accounts_become_usernames_and_password_reset_works(self):
        root = Path(__file__).resolve().parent.parent
        env = {**os.environ, "PYTHONPATH": str(root)}
        with tempfile.TemporaryDirectory() as workdir:
            database = Path(workdir) / "app.db"
            with closing(sqlite3.connect(database)) as connection:
                connection.executescript(LEGACY_SCHEMA)

            def reset(username):
                return subprocess.run(
                    [sys.executable, "-m", "app.reset_password", username],
                    cwd=workdir, env=env, text=True, capture_output=True, timeout=60,
                )

            result = reset("JOE")
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            password = result.stdout.strip().rsplit(": ", 1)[1]
            self.assertEqual(reset("nobody").returncode, 1)

            with closing(sqlite3.connect(database)) as connection:
                users = dict(connection.execute('SELECT username, id FROM "user"').fetchall())
                hashed = connection.execute(
                    "SELECT hashed_password FROM \"user\" WHERE username = 'joe'"
                ).fetchone()[0]
                tokens = connection.execute("SELECT COUNT(*) FROM accesstoken").fetchone()[0]
                with self.assertRaises(sqlite3.IntegrityError):
                    connection.execute(
                        "INSERT INTO \"user\" VALUES ('id-4', 'joe', 'x', 1)"
                    )
            self.assertEqual(users, {"joe": "id-1", "joe-2": "id-2", "user": "id-3"})
            self.assertTrue(password_hash.verify(password, hashed))
            self.assertEqual(tokens, 0)


if __name__ == "__main__":
    unittest.main()
