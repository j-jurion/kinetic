"""Race results page."""

from nicegui import run, ui
from sqlmodel import Session, col, select

from kinetic.database import engine
from kinetic.models import Activity, RaceResult, RaceResultSplit
from kinetic.queries import multisport_parent_sports
from kinetic.ui_helpers import (
    SPORT_COLORS,
    SPORT_ICONS,
    format_date,
    format_duration,
    multisport_marker,
)


def _format_rank(rank: int | None, total: int | None) -> str:
    if not rank:
        return "-"
    return f"{rank}/{total}" if total else str(rank)


def _db_get_race_results() -> list[dict]:
    with Session(engine) as session:
        results = session.exec(
            select(RaceResult, Activity)
            .join(Activity, col(RaceResult.activity_id) == col(Activity.id))
            .order_by(col(Activity.date).desc(), col(Activity.id).desc())
        ).all()
        parent_sports = multisport_parent_sports(session, (activity.parent_id for _, activity in results))
        result_ids = [result.id for result, _ in results if result.id is not None]
        splits_by_result: dict[int, list[RaceResultSplit]] = {}
        if result_ids:
            splits = session.exec(
                select(RaceResultSplit)
                .where(col(RaceResultSplit.race_result_id).in_(result_ids))
                .order_by(col(RaceResultSplit.order))
            ).all()
            for split in splits:
                splits_by_result.setdefault(split.race_result_id, []).append(split)

        rows = []
        for result, activity in results:
            splits = splits_by_result.get(result.id, []) if result.id is not None else []
            rows.append(
                {
                    "activity_id": activity.id,
                    "name": activity.name,
                    "date": format_date(activity.date),
                    "sport": activity.sport.value,
                    "kind": activity.kind.value,
                    "parent_sport": (
                        parent_sports.get(activity.parent_id) if activity.parent_id else None
                    ),
                    "official_time": (
                        format_duration(result.official_time_seconds)
                        if result.official_time_seconds
                        else "-"
                    ),
                    "bib": result.bib_number or "-",
                    "overall": _format_rank(result.overall_rank, result.overall_total),
                    "gender": _format_rank(result.gender_rank, result.gender_total),
                    "age_group": result.age_group or "-",
                    "age_group_rank": _format_rank(
                        result.age_group_rank, result.age_group_total
                    ),
                    "split_summary": " · ".join(
                        f"{split.label}: {format_duration(split.duration_seconds)}"
                        if split.duration_seconds
                        else split.label
                        for split in splits
                    )
                    or "-",
                }
            )
        return rows


async def races_page() -> None:
    results = await run.io_bound(_db_get_race_results) or []

    with ui.row().classes("items-center justify-between w-full q-mb-md"):
        ui.label("Races").classes("text-h5 text-weight-bold")
        ui.label(f"{len(results)} results").classes("text-caption text-grey-6")

    if not results:
        with ui.card().classes("w-full q-pa-lg text-center"):
            ui.icon("emoji_events", size="48px").classes("text-grey-4")
            ui.label("No race results recorded yet.").classes("text-grey-6 q-mt-sm")
        return

    for activity in results:
        sport = activity["sport"]
        activity_id = activity["activity_id"]
        with ui.card().classes("w-full q-pa-sm q-mb-sm hover:shadow-md transition-shadow"):
            with ui.row().classes("items-center no-wrap w-full gap-2"):
                with (
                    ui.row()
                    .classes("items-center gap-3 flex-1 cursor-pointer")
                    .on("click", lambda aid=activity_id: ui.navigate.to(f"/activity/{aid}"))
                ):
                    ui.icon(SPORT_ICONS.get(sport, "sports"), size="28px").style(
                        f"color: {SPORT_COLORS.get(sport, '#6b7280')}"
                    )
                    with ui.column().classes("gap-0"):
                        with ui.row().classes("items-center gap-1"):
                            ui.label(activity["name"]).classes("text-weight-medium text-body1")
                            multisport_marker(activity.get("parent_sport"))
                            ui.icon("emoji_events", size="14px").classes("text-amber-500")
                        ui.label(f"{activity['date']}  ·  {activity['kind'].replace('_', ' ').title()}").classes(
                            "text-caption text-grey-6"
                        )
                        details = []
                        if activity["bib"] != "-":
                            details.append(f"Bib {activity['bib']}")
                        if activity["age_group"] != "-":
                            details.append(f"Age group {activity['age_group']}")
                        if activity["split_summary"] != "-":
                            details.append(activity["split_summary"])
                        if details:
                            ui.label(" · ".join(details)).classes("text-caption text-grey-6")

                    metrics = [
                        ("Official time", activity["official_time"]),
                        ("Overall", activity["overall"]),
                        ("Gender", activity["gender"]),
                        ("Age group rank", activity["age_group_rank"]),
                    ]
                    with ui.row().classes("items-center gap-6 text-right ml-auto"):
                        for label, value in metrics:
                            if value != "-":
                                with ui.column().classes("gap-0 items-end"):
                                    ui.label(value).classes("text-weight-medium")
                                    ui.label(label).classes("text-caption text-grey-6")