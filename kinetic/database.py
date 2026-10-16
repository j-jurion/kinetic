import sqlalchemy
from sqlmodel import Session, SQLModel, create_engine

DATABASE_URL = "sqlite:///./kinetic.db"
engine = create_engine(DATABASE_URL, echo=False, connect_args={"check_same_thread": False})


def create_db_and_tables() -> None:
    SQLModel.metadata.create_all(engine)
    # Add columns introduced after initial schema (safe to run repeatedly)
    with engine.connect() as conn:
        existing = {row[1] for row in conn.execute(sqlalchemy.text("PRAGMA table_info(activity)"))}
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
                sqlalchemy.text("ALTER TABLE activity ADD COLUMN garmin_activity_id INTEGER")
            )
            conn.commit()
        if "strava_activity_id" not in existing:
            conn.execute(
                sqlalchemy.text("ALTER TABLE activity ADD COLUMN strava_activity_id INTEGER")
            )
            conn.commit()
        conn.execute(
            sqlalchemy.text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_activity_strava_id "
                "ON activity (strava_activity_id)"
            )
        )
        if "apple_health_workout_id" not in existing:
            conn.execute(
                sqlalchemy.text("ALTER TABLE activity ADD COLUMN apple_health_workout_id TEXT")
            )
        conn.execute(
            sqlalchemy.text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_activity_apple_health_id "
                "ON activity (apple_health_workout_id)"
            )
        )
        conn.commit()


def get_session() -> Session:
    return Session(engine)


def require_id(value: int | None) -> int:
    """Narrow the primary key of a freshly committed row to a non-optional int."""
    if value is None:
        raise RuntimeError("Expected a persisted row with an assigned id")
    return value
