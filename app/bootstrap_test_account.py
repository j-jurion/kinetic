"""Import a single-user database and create a local test account."""

import argparse
import secrets
import sqlite3
import uuid
from contextlib import closing
from pathlib import Path

from sqlalchemy import update
from sqlalchemy.orm import Session
from sqlmodel import col

from app.auth import User, create_auth_tables, password_hash
from app.database import create_db_and_tables, engine
from app.models import Activity, Friend


def backup_database(source: Path, destination: Path) -> None:
    if not source.is_file():
        raise FileNotFoundError(source)
    with destination.open("xb"):
        pass
    with closing(sqlite3.connect(str(source))) as source_db, closing(
        sqlite3.connect(str(destination))
    ) as backup_db:
        source_db.backup(backup_db)


def require_empty_database(path: Path) -> None:
    with closing(sqlite3.connect(str(path))) as connection:
        tables = connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
        for (name,) in tables:
            quoted = '"' + name.replace('"', '""') + '"'
            if connection.execute(f"SELECT 1 FROM {quoted} LIMIT 1").fetchone():
                raise RuntimeError(f"Destination database is not empty: {name}")


def require_unassigned_source(path: Path) -> None:
    with closing(sqlite3.connect(str(path))) as connection:
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        if "user" in tables and connection.execute('SELECT 1 FROM "user" LIMIT 1').fetchone():
            raise RuntimeError("Source database already contains accounts")
        for table in ("activity", "friend"):
            if table not in tables:
                raise RuntimeError(f"Source database has no {table} table")
            columns = {
                row[1] for row in connection.execute(f"PRAGMA table_info({table})").fetchall()
            }
            if "owner_id" in columns and connection.execute(
                f"SELECT 1 FROM {table} WHERE owner_id IS NOT NULL LIMIT 1"
            ).fetchone():
                raise RuntimeError(f"Source database already has assigned {table} records")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--backup-dir", type=Path, required=True)
    args = parser.parse_args()

    source = args.source.resolve()
    destination = Path("app.db").resolve()
    backup_dir = args.backup_dir.resolve()
    if source == destination or not source.is_file() or not destination.is_file():
        raise RuntimeError("Source and existing destination databases must be different files")
    if not backup_dir.is_dir():
        raise RuntimeError("Backup directory must already exist")
    require_empty_database(destination)
    require_unassigned_source(source)

    backup_id = uuid.uuid4().hex
    source_backup = backup_dir / f"kinetic-source-{backup_id}.sqlite"
    destination_backup = backup_dir / f"kinetic-destination-{backup_id}.sqlite"
    backup_database(source, source_backup)
    backup_database(destination, destination_backup)
    print(f"Source backup: {source_backup}")
    print(f"Destination backup: {destination_backup}")

    require_unassigned_source(source_backup)
    require_empty_database(destination)
    with closing(sqlite3.connect(str(source_backup))) as source_db, closing(
        sqlite3.connect(str(destination))
    ) as target_db:
        source_db.backup(target_db)

    create_db_and_tables()
    create_auth_tables()
    password = secrets.token_urlsafe(24)
    user_id = str(uuid.uuid4())
    with Session(engine) as session:
        session.add(
            User(
                id=user_id,
                username="test",
                hashed_password=password_hash.hash(password),
                is_active=True,
            )
        )
        for model in (Activity, Friend):
            session.execute(
                update(model).where(col(model.owner_id).is_(None)).values(owner_id=user_id)
            )
        session.commit()
    print("Test account username: test")
    print(f"One-time password: {password}")


if __name__ == "__main__":
    main()
