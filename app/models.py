from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from sqlalchemy import BigInteger, Column
from sqlmodel import Field, Relationship, SQLModel


class SportType(str, Enum):
    running = "running"
    trail_running = "trail_running"
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
    owner_id: Optional[str] = Field(default=None, index=True)
    name: str
    email: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ActivityFriend(SQLModel, table=True):
    activity_id: Optional[int] = Field(default=None, foreign_key="activity.id", primary_key=True)
    friend_id: Optional[int] = Field(default=None, foreign_key="friend.id", primary_key=True)


# ── Activity ─────────────────────────────────────────────────────────────────


class Activity(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    owner_id: Optional[str] = Field(default=None, index=True)
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
    # Garmin ids exceed 32 bits, so Postgres needs BIGINT (SQLite integers are 64-bit anyway)
    garmin_activity_id: Optional[int] = Field(default=None, sa_column=Column(BigInteger))

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


# ── Training metrics ──────────────────────────────────────────────────────────


class ActivityMetrics(SQLModel, table=True):
    """Numbers computed once from an activity's FIT file, for the training-wide charts.

    ``has_fit`` is false when no FIT file was available; the row then only records that,
    so the activity is not re-read on every visit.
    """

    activity_id: int = Field(foreign_key="activity.id", primary_key=True)
    version: int = 1
    has_fit: bool = False
    computed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Settings from the watch at the time of the activity
    max_hr_setting: Optional[float] = None
    threshold_hr_setting: Optional[float] = None
    ftp_setting: Optional[float] = None
    weight_kg: Optional[float] = None

    # Time spent moving, from the records (the file's own total can be broken)
    moving_seconds: Optional[float] = None
    # Seconds spent at each heart rate, as JSON {"bpm": seconds}
    hr_histogram: Optional[str] = None
    # Best average power per duration, as JSON {"seconds": watts}
    power_curve: Optional[str] = None
    normalized_power: Optional[float] = None

    avg_temperature: Optional[float] = None
    grade_adjusted_speed: Optional[float] = None
    decoupling_pct: Optional[float] = None

    # Running dynamics averages
    avg_step_length: Optional[float] = None
    avg_ground_contact: Optional[float] = None
    avg_vertical_oscillation: Optional[float] = None
    avg_vertical_ratio: Optional[float] = None

    # Pool swims
    avg_swolf: Optional[float] = None
    avg_stroke_rate: Optional[float] = None


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
