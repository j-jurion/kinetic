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
            conn.execute(sqlalchemy.text("ALTER TABLE activity ADD COLUMN parent_id INTEGER REFERENCES activity(id)"))
            conn.commit()
        if "garmin_activity_id" not in existing:
            conn.execute(sqlalchemy.text("ALTER TABLE activity ADD COLUMN garmin_activity_id INTEGER"))
            conn.commit()


def get_session() -> Session:
    return Session(engine)
