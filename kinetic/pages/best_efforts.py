"""Best Efforts page."""

from datetime import datetime
from functools import partial
from typing import Optional
from urllib.parse import urlencode

from nicegui import run, ui
from sqlmodel import Session, col, select

from kinetic.database import engine
from kinetic.models import Activity, BestEffort, SportType
from kinetic.ui_helpers import (
    ALL_RUNNING,
    DISTANCE_LABELS,
    format_date,
    format_duration,
    resolve_sports,
    sport_color,
    sport_filter_options,
)


def _attempts_url(distance: float, sport: Optional[str], year: Optional[int]) -> str:
    """URL of the page listing every attempt at a given best-effort distance."""
    params = {}
    if sport:
        params["sport"] = sport
    if year:
        params["year"] = str(year)
    query = f"?{urlencode(params)}" if params else ""
    distance_str = f"{distance:.2f}".rstrip("0").rstrip(".")
    return f"/best-efforts/{distance_str}{query}"


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
        return [
            {**effort.model_dump(), "activity_name": activity.name}
            for effort, activity in session.exec(stmt).all()
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
        "distance_km": sum((a.distance_meters or 0) for a in activities) / 1000,
        "duration_seconds": sum(a.duration_seconds for a in activities),
    }


def _stat_tile(label: str, value: str) -> None:
    with ui.column().classes("items-center gap-0"):
        ui.label(value).classes("text-h5 text-weight-bold text-primary")
        ui.label(label).classes("text-caption text-grey-6")


async def best_efforts_page() -> None:
    ui.add_head_html("<style>.best-efforts-table tbody td { cursor: pointer; }</style>")
    sport_filter = {"value": ALL_RUNNING}
    year_filter: dict[str, Optional[int]] = {"value": None}

    async def refresh():
        content_col.clear()
        efforts = await run.io_bound(
            _db_get_best_efforts, sport_filter["value"], year_filter["value"]
        )
        summary = await run.io_bound(
            _db_get_activity_summary, sport_filter["value"], year_filter["value"]
        ) or {"count": 0, "distance_km": 0.0, "duration_seconds": 0.0}

        with content_col:
            if not efforts:
                with ui.card().classes("w-full q-pa-lg text-center"):
                    ui.icon("emoji_events", size="48px").classes("text-grey-4")
                    ui.label("No best efforts yet. Upload activities to see your records.").classes(
                        "text-grey-6 q-mt-sm"
                    )
            else:
                grouped: dict[float, list[dict]] = {}
                for e in efforts:
                    d = e["distance_meters"]
                    grouped.setdefault(d, []).append(e)

                for dist, dist_efforts in sorted(grouped.items()):
                    label = DISTANCE_LABELS.get(dist, f"{dist / 1000:.1f} km")
                    best = dist_efforts[0]
                    color = sport_color(sport_filter["value"])

                    with ui.card().classes("w-full q-pa-md"):
                        with ui.row().classes("items-center justify-between w-full q-mb-sm"):
                            ui.label(label).classes("text-h6 text-weight-bold")
                            with ui.row().classes("items-center gap-2"):
                                ui.chip(
                                    format_duration(best["duration_seconds"]),
                                    icon="emoji_events",
                                ).props("dense outline").style(
                                    f"color: {color}; border-color: {color}"
                                )
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
                            {"name": "date", "label": "Date", "field": "date", "align": "left"},
                            {
                                "name": "activity",
                                "label": "Activity",
                                "field": "activity",
                                "align": "left",
                            },
                            {"name": "year", "label": "Year", "field": "year", "align": "left"},
                            {"name": "time", "label": "Time", "field": "time", "align": "right"},
                        ]
                        rows = [
                            {
                                "rank": f"#{i + 1}",
                                "date": format_date(e["date"]),
                                "activity": e["activity_name"],
                                "year": str(e["year"]),
                                "time": format_duration(e["duration_seconds"]),
                                "activity_id": e["activity_id"],
                            }
                            for i, e in enumerate(dist_efforts[:10])
                        ]
                        tbl = (
                            ui.table(columns=cols, rows=rows, row_key="rank")
                            .classes("w-full best-efforts-table")
                            .props("dense flat")
                        )
                        tbl.on(
                            "rowClick",
                            lambda e: ui.navigate.to(f"/activity/{e.args[1]['activity_id']}"),
                        )

            with ui.card().classes("w-full q-pa-md"):
                ui.label("Activity Summary").classes("text-h6 text-weight-bold q-mb-sm")
                with ui.row().classes("gap-8"):
                    _stat_tile("Total Activities", str(summary["count"]))
                    _stat_tile("Total Distance", f"{summary['distance_km']:.0f} km")
                    _stat_tile("Total Time", format_duration(summary["duration_seconds"]))

    # ── toolbar ──
    with ui.row().classes("items-center justify-between w-full q-mb-md flex-wrap gap-3"):
        ui.label("Best Efforts").classes("text-h5 text-weight-bold")
        with ui.row().classes("gap-2"):
            ui.select(
                sport_filter_options(include_all_sports=False),
                value=ALL_RUNNING,
                label="Sport",
                on_change=lambda e: (
                    sport_filter.__setitem__("value", e.value),
                    ui.timer(0, refresh, once=True),
                ),
            ).classes("w-40")
            ui.select(
                ["All years"] + [str(y) for y in range(datetime.now().year, 2009, -1)],
                value="All years",
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
