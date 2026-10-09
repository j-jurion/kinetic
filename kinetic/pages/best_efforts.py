"""Best Efforts page."""

from datetime import datetime
from functools import partial
from typing import Optional

from nicegui import run, ui
from sqlmodel import Session, col, select

from kinetic.database import engine
from kinetic.models import Activity, BestEffort, SportType
from kinetic.pages.top_activities import (
    TOP_METRICS,
    db_get_top_activities,
    render_top_table,
    top_activities_url,
)
from kinetic.queries import multisport_parent_sports
from kinetic.ui_helpers import (
    ALL_RUNNING,
    add_multisport_cell,
    add_rank_medal_cell,
    add_year_medal_cell,
    distance_label,
    filtered_url,
    format_date,
    format_distance,
    format_duration,
    format_pace,
    mark_year_bests,
    medal_row_fields,
    multisport_row_fields,
    record_chip,
    resolve_sports,
    sport_filter_options,
    sport_label,
)


def _attempts_url(distance: float, sport: Optional[str], year: Optional[int]) -> str:
    """URL of the page listing every attempt at a given best-effort distance."""
    distance_str = f"{distance:.2f}".rstrip("0").rstrip(".")
    return filtered_url(f"/best-efforts/{distance_str}", sport, year)


def _db_get_best_efforts(sport: Optional[str], year: Optional[int]) -> list[dict]:
    with Session(engine) as session:
        stmt = select(BestEffort, Activity).join(
            Activity, col(BestEffort.activity_id) == col(Activity.id)
        )
        sports = resolve_sports(sport)
        if sports:
            stmt = stmt.where(col(BestEffort.sport).in_([SportType(s) for s in sports]))
        if year:
            stmt = stmt.where(BestEffort.year == year)
        stmt = stmt.order_by(col(BestEffort.distance_meters), col(BestEffort.duration_seconds))
        results = session.exec(stmt).all()
        parents = multisport_parent_sports(session, (a.parent_id for _, a in results))
        return [
            {
                **effort.model_dump(),
                "activity_name": activity.name,
                "parent_sport": parents.get(activity.parent_id) if activity.parent_id else None,
            }
            for effort, activity in results
        ]


def _db_get_activity_summary(sport: Optional[str], year: Optional[int]) -> dict:
    with Session(engine) as session:
        stmt = select(Activity)
        sports = resolve_sports(sport)
        if sports:
            stmt = stmt.where(col(Activity.sport).in_([SportType(s) for s in sports]))
        if year:
            stmt = stmt.where(col(Activity.date) >= datetime(year, 1, 1))
            stmt = stmt.where(col(Activity.date) < datetime(year + 1, 1, 1))
        activities = session.exec(stmt).all()
    return {
        "count": len(activities),
        "distance_meters": sum((a.distance_meters or 0) for a in activities),
        "duration_seconds": sum(a.duration_seconds for a in activities),
    }


def _stat_tile(label: str, value: str) -> None:
    with ui.column().classes("items-center gap-0"):
        ui.label(value).classes("text-h5 text-weight-bold text-primary")
        ui.label(label).classes("text-caption text-grey-6")


async def best_efforts_page(sport: Optional[str] = None, year: Optional[int] = None) -> None:
    ui.add_head_html(
        "<style>.best-efforts-table tbody td, .top-activities-table tbody td"
        " { cursor: pointer; }</style>"
    )
    selected_sport = sport or ALL_RUNNING
    sport_filter = {"value": selected_sport}
    year_filter: dict[str, Optional[int]] = {"value": year}

    async def refresh():
        content_col.clear()
        efforts = await run.io_bound(
            _db_get_best_efforts, sport_filter["value"], year_filter["value"]
        )
        summary = await run.io_bound(
            _db_get_activity_summary, sport_filter["value"], year_filter["value"]
        ) or {"count": 0, "distance_meters": 0.0, "duration_seconds": 0.0}

        with content_col:
            if not efforts:
                selection = sport_label(sport_filter["value"] or ALL_RUNNING).lower()
                with ui.card().classes("w-full q-pa-lg text-center"):
                    ui.icon("emoji_events", size="48px").classes("text-grey-4")
                    ui.label(f"No {selection} records yet.").classes("text-grey-6 q-mt-sm")
            else:
                grouped: dict[float, list[dict]] = {}
                for e in efforts:
                    d = e["distance_meters"]
                    grouped.setdefault(d, []).append(e)

                for dist, dist_efforts in sorted(grouped.items()):
                    label = distance_label(dist, sport_filter["value"])
                    best = dist_efforts[0]

                    with ui.card().classes("w-full q-pa-md"):
                        with ui.row().classes("items-center justify-between w-full q-mb-sm"):
                            with ui.row().classes("items-center gap-3"):
                                ui.label(label).classes("text-h6 text-weight-bold")
                                record_chip(format_duration(best["duration_seconds"]))
                            ui.button(
                                f"All attempts ({len(dist_efforts)})",
                                icon="format_list_bulleted",
                                on_click=partial(
                                    ui.navigate.to,
                                    _attempts_url(
                                        dist, sport_filter["value"], year_filter["value"]
                                    ),
                                ),
                            ).props("flat dense no-caps color=primary")

                        cols = [
                            {"name": "rank", "label": "#", "field": "rank", "align": "left"},
                            {
                                "name": "activity",
                                "label": "Activity",
                                "field": "activity",
                                "align": "left",
                            },
                            {"name": "date", "label": "Date", "field": "date", "align": "left"},
                            {"name": "time", "label": "Time", "field": "time", "align": "right"},
                            {"name": "pace", "label": "Pace", "field": "pace", "align": "right"},
                        ]
                        year_bests = mark_year_bests([e["year"] for e in dist_efforts])
                        rows = [
                            {
                                "rank": i + 1,
                                "date": format_date(e["date"]),
                                "activity": e["activity_name"],
                                "year": str(e["year"]),
                                "time": format_duration(e["duration_seconds"]),
                                "pace": format_pace(
                                    e["distance_meters"], e["duration_seconds"], e["sport"]
                                ),
                                "activity_id": e["activity_id"],
                                **multisport_row_fields(e.get("parent_sport")),
                                **medal_row_fields(i + 1, year_bests[i]),
                            }
                            for i, e in enumerate(dist_efforts[:10])
                        ]
                        tbl = (
                            ui.table(columns=cols, rows=rows, row_key="rank")
                            .classes("w-full best-efforts-table")
                            .props("dense flat")
                        )
                        add_rank_medal_cell(tbl)
                        add_multisport_cell(tbl)
                        add_year_medal_cell(tbl, "date")
                        tbl.on(
                            "rowClick",
                            lambda e: ui.navigate.to(f"/activity/{e.args[1]['activity_id']}"),
                        )

            for metric in TOP_METRICS:
                top = await run.io_bound(
                    db_get_top_activities,
                    metric,
                    sport_filter["value"],
                    year_filter["value"],
                )
                if not top:
                    continue
                config = TOP_METRICS[metric]
                with ui.card().classes("w-full q-pa-md"):
                    with ui.row().classes("items-center justify-between w-full q-mb-sm"):
                        with ui.row().classes("items-center gap-3"):
                            ui.label(config["card_title"]).classes("text-h6 text-weight-bold")
                            record_chip(
                                config["format"](
                                    top[0][config["field"]] or 0, sport_filter["value"]
                                ),
                                icon=config["icon"],
                            )
                        ui.button(
                            f"All activities ({len(top)})",
                            icon="format_list_bulleted",
                            on_click=partial(
                                ui.navigate.to,
                                top_activities_url(
                                    metric, sport_filter["value"], year_filter["value"]
                                ),
                            ),
                        ).props("flat dense no-caps color=primary")
                    render_top_table(metric, top[:10], compact=True)

            with ui.card().classes("w-full q-pa-md"):
                ui.label("Activity Summary").classes("text-h6 text-weight-bold q-mb-sm")
                with ui.row().classes("gap-8"):
                    _stat_tile("Total Activities", str(summary["count"]))
                    _stat_tile(
                        "Total Distance",
                        format_distance(summary["distance_meters"], sport_filter["value"]),
                    )
                    _stat_tile("Total Time", format_duration(summary["duration_seconds"]))

    # ── toolbar ──
    with ui.row().classes("items-center justify-between w-full q-mb-md flex-wrap gap-3"):
        ui.label("Best Efforts").classes("text-h5 text-weight-bold")
        with ui.row().classes("gap-2"):
            ui.select(
                sport_filter_options(include_all_sports=False),
                value=selected_sport,
                label="Sport",
                on_change=lambda e: (
                    sport_filter.__setitem__("value", e.value),
                    ui.timer(0, refresh, once=True),
                ),
            ).classes("w-40")
            ui.select(
                ["All years"] + [str(y) for y in range(datetime.now().year, 2009, -1)],
                value=str(year) if year else "All years",
                label="Year",
                on_change=lambda e: (
                    year_filter.__setitem__(
                        "value", None if e.value == "All years" else int(e.value)
                    ),
                    ui.timer(0, refresh, once=True),
                ),
            ).classes("w-32")

    content_col = ui.column().classes("w-full gap-4")
    await refresh()
