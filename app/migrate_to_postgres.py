"""Copy a local SQLite database (app.db) into an empty Postgres database such as Supabase.

Usage (DATABASE_URL points at the Postgres database; the source stays unchanged):

    uv run python -m app.migrate_to_postgres --source app.db

Accounts, activities, friends, laps, best efforts, metrics and race results are copied with
their ids. Login sessions are not copied, so everyone signs in again. The command refuses to
write into a database that already holds activities or accounts.
"""

import argparse
import os
import sys
from pathlib import Path

from sqlalchemy import Integer, create_engine, func, insert, select, text
from sqlmodel import SQLModel

BATCH = 500
SKIPPED_TABLES = {"accesstoken"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source", default="app.db", help="SQLite file to copy from")
    args = parser.parse_args()

    source_path = Path(args.source).resolve()
    if not source_path.is_file():
        sys.exit(f"Source database not found: {source_path}")
    if not os.environ.get("DATABASE_URL", "").startswith(("postgres://", "postgresql")):
        sys.exit("Set DATABASE_URL to the Postgres connection string first")

    # Imported after the checks: app.database reads DATABASE_URL when it is imported.
    import app.models  # noqa: F401
    from app.auth import AuthBase, create_auth_tables
    from app.database import create_db_and_tables, engine, lock_down_postgres_tables

    create_db_and_tables()
    create_auth_tables()

    tables = [
        table
        for metadata in (AuthBase.metadata, SQLModel.metadata)
        for table in metadata.sorted_tables
        if table.name not in SKIPPED_TABLES
    ]
    source = create_engine(f"sqlite:///{source_path}")

    with engine.begin() as target:
        for name in ("user", "activity"):
            table = next(t for t in tables if t.name == name)
            if target.execute(select(func.count()).select_from(table)).scalar():
                sys.exit(f"The target database already has rows in {name!r}; refusing to copy")

        with source.connect() as src:
            for table in tables:
                if not source.dialect.has_table(src, table.name):
                    print(f"{table.name}: not in source, skipped")
                    continue
                source_columns = {
                    row[1] for row in src.execute(text(f'PRAGMA table_info("{table.name}")'))
                }
                columns = [column for column in table.columns if column.name in source_columns]
                query = select(*columns)
                if table.name == "activity":
                    # Multisport legs reference their parent, so insert the parents first.
                    query = query.order_by(table.c.parent_id.is_not(None), table.c.id)
                rows = [dict(row._mapping) for row in src.execute(query)]
                for start in range(0, len(rows), BATCH):
                    target.execute(insert(table), rows[start : start + BATCH])
                print(f"{table.name}: {len(rows)} rows")

        # Rows were inserted with their ids; move each id sequence past the highest one.
        for table in tables:
            pk = list(table.primary_key.columns)
            if len(pk) != 1 or not isinstance(pk[0].type, Integer):
                continue
            target.execute(
                text(
                    f"SELECT setval(pg_get_serial_sequence('\"{table.name}\"', '{pk[0].name}'), "
                    f'COALESCE((SELECT MAX("{pk[0].name}") FROM "{table.name}"), 0) + 1, false)'
                )
            )

    lock_down_postgres_tables()
    print("Done.")


if __name__ == "__main__":
    main()
