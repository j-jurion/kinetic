"""Account-scoped database access for activity data."""

from contextvars import ContextVar

from sqlalchemy import event, inspect, select
from sqlalchemy.orm import defer, with_loader_criteria
from sqlmodel import Session as SQLModelSession
from sqlmodel import SQLModel, col

from app.models import (
    Activity,
    ActivityFriend,
    ActivityMetrics,
    BestEffort,
    Friend,
    FriendRequest,
    Lap,
    RaceResult,
    RaceResultSplit,
)

current_owner: ContextVar[str | None] = ContextVar("current_owner", default=None)
# Activity columns that queries skip unless they ask for them (see scope_queries)
HEAVY_COLUMNS = ("route_json", "map_route_json")


class UserSession(SQLModelSession):
    def __init__(self, *args, **kwargs):
        owner_id = current_owner.get()
        if not owner_id:
            raise PermissionError("An authenticated account is required")
        super().__init__(*args, **kwargs)
        self.owner_id = owner_id


@event.listens_for(UserSession, "do_orm_execute")
def scope_queries(execute_state):
    if not execute_state.is_select:
        raise PermissionError("Bulk writes are not permitted in an account-scoped session")
    if not execute_state.is_orm_statement:
        raise PermissionError("Raw table queries are not permitted in an account-scoped session")
    owner_id = execute_state.session.owner_id
    activity = SQLModel.metadata.tables["activity"]
    friend = SQLModel.metadata.tables["friend"]
    race = SQLModel.metadata.tables["raceresult"]
    activity_ids = select(activity.c.id).where(activity.c.owner_id == owner_id)
    friend_ids = select(friend.c.id).where(friend.c.owner_id == owner_id)
    race_ids = select(race.c.id).where(race.c.activity_id.in_(activity_ids))
    statement = execute_state.statement
    # The full GPS route and its map version are large; load them only when asked for with
    # .execution_options(activity_columns=(...)) or by reading the attribute in the session
    if not execute_state.is_column_load and not execute_state.is_relationship_load:
        wanted = execute_state.execution_options.get("activity_columns", ())
        if any(d.get("expr") is Activity for d in statement.column_descriptions):
            statement = statement.options(
                *(defer(getattr(Activity, name)) for name in HEAVY_COLUMNS if name not in wanted)
            )
    execute_state.statement = statement.options(
        with_loader_criteria(Activity, col(Activity.owner_id) == owner_id, include_aliases=True),
        with_loader_criteria(Friend, col(Friend.owner_id) == owner_id, include_aliases=True),
        with_loader_criteria(
            FriendRequest,
            (col(FriendRequest.from_user_id) == owner_id)
            | (col(FriendRequest.to_user_id) == owner_id),
            include_aliases=True,
        ),
        with_loader_criteria(Lap, col(Lap.activity_id).in_(activity_ids), include_aliases=True),
        with_loader_criteria(
            BestEffort, col(BestEffort.activity_id).in_(activity_ids), include_aliases=True
        ),
        with_loader_criteria(
            ActivityMetrics,
            col(ActivityMetrics.activity_id).in_(activity_ids),
            include_aliases=True,
        ),
        with_loader_criteria(
            RaceResult, col(RaceResult.activity_id).in_(activity_ids), include_aliases=True
        ),
        with_loader_criteria(
            RaceResultSplit, col(RaceResultSplit.race_result_id).in_(race_ids), include_aliases=True
        ),
        with_loader_criteria(
            ActivityFriend,
            col(ActivityFriend.activity_id).in_(activity_ids)
            & col(ActivityFriend.friend_id).in_(friend_ids),
            include_aliases=True,
        ),
    )


@event.listens_for(UserSession, "before_flush")
def validate_writes(session, _flush_context, _instances):
    owner_id = session.owner_id
    connection = session.connection()
    activity = SQLModel.metadata.tables["activity"]
    friend = SQLModel.metadata.tables["friend"]
    race = SQLModel.metadata.tables["raceresult"]
    race_split = SQLModel.metadata.tables["raceresultsplit"]

    def require_owned(table, record_id):
        found = connection.execute(
            select(table.c.id).where(table.c.id == record_id, table.c.owner_id == owner_id)
        ).first()
        if found is None:
            raise PermissionError("The referenced record is not owned by this account")

    def require_owned_race(race_id):
        found = connection.execute(
            select(race.c.id)
            .join(activity, race.c.activity_id == activity.c.id)
            .where(race.c.id == race_id, activity.c.owner_id == owner_id)
        ).first()
        if found is None:
            raise PermissionError("The referenced race is not owned by this account")

    for item in session.new.union(session.dirty).union(session.deleted):
        if isinstance(item, FriendRequest):
            # Requests touch two accounts; app/friends.py handles them outside this session.
            raise PermissionError("Friend requests cannot be written in an account-scoped session")
        if isinstance(item, Friend) and (
            item.user_id is not None
            if item in session.new
            else inspect(item).attrs.user_id.history.has_changes()
        ):
            raise PermissionError("Friends are linked to accounts only through friend requests")
        if isinstance(item, (Activity, Friend)):
            table = activity if isinstance(item, Activity) else friend
            if item in session.new:
                if item.owner_id not in (None, owner_id):
                    raise PermissionError("Cannot create a record for another account")
                item.owner_id = owner_id
            else:
                require_owned(table, item.id)
                if item.owner_id != owner_id:
                    raise PermissionError("Cannot change record ownership")
            if isinstance(item, Activity) and item.parent_id is not None:
                require_owned(activity, item.parent_id)
        elif isinstance(item, (Lap, BestEffort, RaceResult, ActivityFriend, ActivityMetrics)):
            if item not in session.new:
                state = inspect(item)
                if state is None:
                    raise PermissionError("Cannot verify record ownership")
                table = state.mapper.local_table
                identity = state.identity
                if identity is None:
                    raise PermissionError("Cannot verify record ownership")
                row = connection.execute(
                    select(table).where(
                        *(column == value for column, value in zip(table.primary_key, identity))
                    )
                ).mappings().first()
                if row is None:
                    raise PermissionError("Cannot verify record ownership")
                require_owned(activity, row["activity_id"])
                if isinstance(item, ActivityFriend):
                    require_owned(friend, row["friend_id"])
            require_owned(activity, item.activity_id)
            if isinstance(item, ActivityFriend):
                require_owned(friend, item.friend_id)
        elif isinstance(item, RaceResultSplit):
            if item not in session.new:
                row = connection.execute(
                    select(race_split.c.race_result_id).where(
                        race_split.c.id == item.id
                    )
                ).first()
                if row is None:
                    raise PermissionError("Cannot verify record ownership")
                require_owned_race(row[0])
            require_owned_race(item.race_result_id)
