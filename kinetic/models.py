from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from sqlmodel import Field, Relationship, SQLModel


class SportType(str, Enum):
    running = "running"
    cycling = "cycling"
    swimming = "swimming"
    hiking = "hiking"
    walking = "walking"
    triathlon = "triathlon"
    duathlon = "duathlon"
    multisport = "multisport"
    strength = "strength"
    yoga = "yoga"
    other = "other"


class ActivityKind(str, Enum):
    race = "race"
    training = "training"
    easy = "easy"
    social = "social"
    long_run = "long_run"
    tempo = "tempo"
    interval = "interval"
    recovery = "recovery"
    other = "other"


# ── Friends ─────────────────────────────────────────────────────────────────


class Friend(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    email: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ActivityFriend(SQLModel, table=True):
    activity_id: Optional[int] = Field(default=None, foreign_key="activity.id", primary_key=True)
    friend_id: Optional[int] = Field(default=None, foreign_key="friend.id", primary_key=True)


# ── Activity ─────────────────────────────────────────────────────────────────


class Activity(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    sport: SportType = SportType.running
    kind: ActivityKind = ActivityKind.training

    date: datetime
    duration_seconds: float  # seconds
    distance_meters: Optional[float] = None  # meters
    elevation_gain_meters: Optional[float] = None
    avg_heart_rate: Optional[int] = None
    max_heart_rate: Optional[int] = None
    avg_speed_ms: Optional[float] = None  # m/s
    max_speed_ms: Optional[float] = None
    avg_cadence: Optional[int] = None
    avg_power: Optional[int] = None  # watts
    calories: Optional[int] = None
    notes: Optional[str] = None

    # Raw fit file path if uploaded
    fit_file_path: Optional[str] = None
    # GPS route stored as JSON string: [[lat, lon], ...]
    route_json: Optional[str] = None
    # Parent activity id for multi-sport children (e.g. triathlon sub-sports)
    parent_id: Optional[int] = Field(default=None, foreign_key="activity.id", nullable=True)
    # Garmin Connect activity ID for deduplication during sync
    garmin_activity_id: Optional[int] = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    laps: list["Lap"] = Relationship(back_populates="activity")


class Lap(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    activity_id: int = Field(foreign_key="activity.id")
    lap_number: int
    start_time: Optional[datetime] = None
    duration_seconds: Optional[float] = None
    distance_meters: Optional[float] = None
    avg_speed_ms: Optional[float] = None
    avg_heart_rate: Optional[int] = None
    elevation_gain: Optional[float] = None

    activity: Optional[Activity] = Relationship(back_populates="laps")


# ── Best Efforts ──────────────────────────────────────────────────────────────


class BestEffort(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    activity_id: int = Field(foreign_key="activity.id")
    sport: SportType
    distance_meters: float  # the standard distance (e.g. 1000, 5000, 10000, 21097, 42195)
    duration_seconds: float
    date: datetime
    year: int


# ── Race Results ──────────────────────────────────────────────────────────────


class RaceResult(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    activity_id: int = Field(foreign_key="activity.id", unique=True)

    official_time_seconds: Optional[float] = None
    bib_number: Optional[str] = None
    age_group: Optional[str] = None

    overall_rank: Optional[int] = None
    overall_total: Optional[int] = None
    gender_rank: Optional[int] = None
    gender_total: Optional[int] = None
    age_group_rank: Optional[int] = None
    age_group_total: Optional[int] = None

    results_url: Optional[str] = None
    notes: Optional[str] = None

    splits: list["RaceResultSplit"] = Relationship(back_populates="race_result")


class RaceResultSplit(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    race_result_id: int = Field(foreign_key="raceresult.id")
    label: str
    order: int
    duration_seconds: Optional[float] = None
    rank: Optional[int] = None

    race_result: Optional[RaceResult] = Relationship(back_populates="splits")
