import sqlalchemy
from sqlmodel import Session, SQLModel, create_engine

DATABASE_URL = "sqlite:///./app.db"
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
        if "owner_id" not in existing:
            conn.execute(sqlalchemy.text("ALTER TABLE activity ADD COLUMN owner_id VARCHAR"))
        friend_columns = {
            row[1] for row in conn.execute(sqlalchemy.text("PRAGMA table_info(friend)"))
        }
        if "owner_id" not in friend_columns:
            conn.execute(sqlalchemy.text("ALTER TABLE friend ADD COLUMN owner_id VARCHAR"))
        conn.execute(
            sqlalchemy.text("CREATE INDEX IF NOT EXISTS ix_activity_owner_id ON activity(owner_id)")
        )
        conn.execute(
            sqlalchemy.text("CREATE INDEX IF NOT EXISTS ix_friend_owner_id ON friend(owner_id)")
        )
        conn.commit()


def get_session() -> Session:
    return Session(engine)


def require_id(value: int | None) -> int:
    """Narrow the primary key of a freshly committed row to a non-optional int."""
    if value is None:
        raise RuntimeError("Expected a persisted row with an assigned id")
    return value
