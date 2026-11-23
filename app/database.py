import os

import sqlalchemy
from loguru import logger
from sqlmodel import Session, SQLModel, create_engine


def _database_url() -> str:
    """SQLite file locally; set DATABASE_URL (e.g. Supabase Postgres) in production."""
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        return "sqlite:///./app.db"
    # Supabase and Fly hand out postgres:// / postgresql:// URLs; use the psycopg 3 driver.
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


DATABASE_URL = _database_url()
IS_SQLITE = DATABASE_URL.startswith("sqlite")

if IS_SQLITE:
    engine = create_engine(DATABASE_URL, echo=False, connect_args={"check_same_thread": False})
else:
    # pool_pre_ping recovers from connections the Supabase pooler closed while idle.
    engine = create_engine(
        DATABASE_URL, echo=False, pool_pre_ping=True, pool_size=5, max_overflow=5,
        pool_recycle=300,
    )


def _columns(conn, table: str) -> set[str]:
    return {column["name"] for column in sqlalchemy.inspect(conn).get_columns(table)}


def create_db_and_tables() -> None:
    import app.models  # noqa: F401  (registers the tables on SQLModel.metadata)

    SQLModel.metadata.create_all(engine)
    # Add columns introduced after initial schema (safe to run repeatedly). A new database
    # gets them from create_all above, so this only upgrades older SQLite files.
    with engine.connect() as conn:
        existing = _columns(conn, "activity")
        if "route_json" not in existing:
            conn.execute(sqlalchemy.text("ALTER TABLE activity ADD COLUMN route_json TEXT"))
            conn.commit()
        if "parent_id" not in existing:
            conn.execute(
                sqlalchemy.text(
                    "ALTER TABLE activity ADD COLUMN parent_id INTEGER REFERENCES activity(id)"
                )
            )
            conn.commit()
        if "garmin_activity_id" not in existing:
            conn.execute(
                sqlalchemy.text("ALTER TABLE activity ADD COLUMN garmin_activity_id BIGINT")
            )
            conn.commit()
        if "owner_id" not in existing:
            conn.execute(sqlalchemy.text("ALTER TABLE activity ADD COLUMN owner_id VARCHAR"))
        if "owner_id" not in _columns(conn, "friend"):
            conn.execute(sqlalchemy.text("ALTER TABLE friend ADD COLUMN owner_id VARCHAR"))
        conn.execute(
            sqlalchemy.text("CREATE INDEX IF NOT EXISTS ix_activity_owner_id ON activity(owner_id)")
        )
        conn.execute(
            sqlalchemy.text("CREATE INDEX IF NOT EXISTS ix_friend_owner_id ON friend(owner_id)")
        )
        if "moving_seconds" not in _columns(conn, "activitymetrics"):
            conn.execute(
                sqlalchemy.text("ALTER TABLE activitymetrics ADD COLUMN moving_seconds FLOAT")
            )
        _add_garmin_id_index(conn)
        conn.commit()


def _add_garmin_id_index(conn) -> None:
    """Make Garmin ids unique per account on databases created before the index existed."""
    from app.models import GARMIN_ID_INDEX

    duplicate = conn.execute(
        sqlalchemy.text(
            "SELECT owner_id, garmin_activity_id FROM activity "
            "WHERE garmin_activity_id IS NOT NULL "
            "GROUP BY owner_id, garmin_activity_id HAVING COUNT(*) > 1"
        )
    ).first()
    if duplicate is not None:
        # Creating the index would fail; keep starting up and say what to clean up
        logger.warning(
            "Not adding {}: Garmin activity {} is imported more than once; remove the "
            "duplicates and restart",
            GARMIN_ID_INDEX,
            duplicate.garmin_activity_id,
        )
        return
    conn.execute(
        sqlalchemy.text(
            f"CREATE UNIQUE INDEX IF NOT EXISTS {GARMIN_ID_INDEX} "
            "ON activity(owner_id, garmin_activity_id)"
        )
    )


def lock_down_postgres_tables() -> None:
    """Enable row-level security on every table in Postgres.

    Supabase exposes the ``public`` schema through its Data API, where anyone holding the
    project's public anon key could otherwise read every table. The app connects as the table
    owner, which bypasses RLS, so this changes nothing for the app itself. No-op on SQLite.
    """
    if IS_SQLITE:
        return
    with engine.begin() as conn:
        tables = conn.execute(
            sqlalchemy.text("SELECT tablename FROM pg_tables WHERE schemaname = current_schema()")
        ).scalars()
        for table in tables:
            conn.execute(sqlalchemy.text(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY'))


def get_session() -> Session:
    return Session(engine)


def require_id(value: int | None) -> int:
    """Narrow the primary key of a freshly committed row to a non-optional int."""
    if value is None:
        raise RuntimeError("Expected a persisted row with an assigned id")
    return value
