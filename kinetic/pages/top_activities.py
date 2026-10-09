"""Activity ranking tables (most elevation, longest distance) and their full page."""

from datetime import datetime
from typing import Any, Optional

from nicegui import run, ui
from sqlmodel import Session, col, select

from kinetic.database import engine
from kinetic.models import Activity, SportType
from kinetic.queries import multisport_parent_sports
from kinetic.ui_helpers import (
    ALL_RUNNING,
    add_multisport_cell,
    add_rank_medal_cell,
    add_year_medal_cell,
    filtered_url,
    format_date,
    format_distance,
    format_duration,
    format_pace,
    is_swimming,
    mark_year_bests,
    medal_row_fields,
    multisport_row_fields,
    resolve_sports,
    sport_filter_options,
    sport_icon,
    sport_label,
)


def _format_elevation(value: float, sport: Optional[str] = None) -> str:
    return f"{value:.0f} m"


def _format_total_distance(value: float, sport: Optional[str] = None) -> str:
    if is_swimming(sport):
        return f"{value:.0f} m"
    return f"{value / 1000:.0f} km"


TOP_METRICS: dict[str, dict[str, Any]] = {
    "elevation": {
        "card_title": "Most Elevation",
        "page_title": "Most elevation gained",
        "field": "elevation_gain_meters",
        "column": "Elevation",
        "format": _format_elevation,
        "best_label": "Highest",
        "total_label": "Total climb",
        "format_total": _format_elevation,
        "icon": "landscape",
    },
    "distance": {
        "card_title": "Longest Activities",
        "page_title": "Longest activities",
        "field": "distance_meters",
        "column": "Distance",
        "format": format_distance,
        "best_label": "Longest",
        "total_label": "Total distance",
        "format_total": _format_total_distance,
        "icon": "straighten",
    },
}


def top_activities_url(metric: str, sport: Optional[str], year: Optional[int]) -> str:
    """URL of the page ranking every activity by the given metric."""
    return filtered_url(f"/best-efforts/top/{metric}", sport, year)


def db_get_top_activities(
    metric: str, sport: Optional[str], year: Optional[int], limit: Optional[int] = None
) -> list[dict]:
    """Activities ranked by the metric, best first; multisport legs count per sport."""
    ranked = col(getattr(Activity, TOP_METRICS[metric]["field"]))
    with Session(engine) as session:
        stmt = select(Activity).where(ranked.is_not(None)).where(ranked > 0)
        sports = resolve_sports(sport)
        if sports:
            stmt = stmt.where(col(Activity.sport).in_([SportType(s) for s in sports]))
        else:
            # Without a sport filter a multisport parent already covers its legs
            stmt = stmt.where(Activity.parent_id == None)  # noqa: E711
        if year:
            stmt = stmt.where(col(Activity.date) >= datetime(year, 1, 1))
            stmt = stmt.where(col(Activity.date) < datetime(year + 1, 1, 1))
        stmt = stmt.order_by(ranked.desc())
        if limit:
            stmt = stmt.limit(limit)
        activities = session.exec(stmt).all()
        parents = multisport_parent_sports(session, (a.parent_id for a in activities))
        rows = []
        for activity in activities:
            data = activity.model_dump(mode="json")
            data["parent_sport"] = (
                parents.get(activity.parent_id) if activity.parent_id else None
            )
            rows.append(data)
        return rows


def top_table_columns(metric: str, compact: bool) -> list[dict]:
    config = TOP_METRICS[metric]
    value_col = {
        "name": "value",
        "label": config["column"],
        "field": "value_raw",
        "align": "right",
        "sortable": not compact,
    }
    if compact:
        return [
            {"name": "rank", "label": "#", "field": "rank", "align": "left"},
            {"name": "activity", "label": "Activity", "field": "activity", "align": "left"},
            {"name": "date", "label": "Date", "field": "date", "align": "left"},
            value_col,
        ]
    other = "distance" if metric == "elevation" else "elevation"
    return [
        {"name": "rank", "label": "#", "field": "rank", "align": "left"},
        {
            "name": "activity",
            "label": "Activity",
            "field": "activity",
            "align": "left",
            "sortable": True,
        },
        {"name": "date", "label": "Date", "field": "date_iso", "align": "left", "sortable": True},
        value_col,
        {
            "name": "other",
            "label": TOP_METRICS[other]["column"],
            "field": "other_raw",
            "align": "right",
            "sortable": True,
        },
        {
            "name": "duration",
            "label": "Time",
            "field": "duration_seconds",
            "align": "right",
            "sortable": True,
        },
        {"name": "pace", "label": "Pace", "field": "pace", "align": "right"},
    ]


def top_table_rows(metric: str, activities: list[dict]) -> list[dict]:
    config = TOP_METRICS[metric]
    other = "distance" if metric == "elevation" else "elevation"
    other_config = TOP_METRICS[other]
    years = [int(str(activity["date"])[:4]) for activity in activities]
    year_bests = mark_year_bests(years)
    rows = []
    for index, activity in enumerate(activities):
        year = years[index]
        value = activity[config["field"]] or 0
        other_value = activity[other_config["field"]]
        distance = activity.get("distance_meters")
        duration = activity.get("duration_seconds") or 0
        sport = activity.get("sport")
        rows.append(
            {
                "rank": index + 1,
                "date": format_date(activity["date"]),
                "date_iso": str(activity["date"])[:10],
                "year": year,
                "activity": activity["name"],
                "value": config["format"](value, sport),
                "value_raw": value,
                "other": other_config["format"](other_value, sport) if other_value else "–",
                "other_raw": other_value or 0,
                "duration": format_duration(duration),
                "duration_seconds": duration,
                "pace": format_pace(distance, duration, sport) if distance and duration else "–",
                "activity_id": activity["id"],
                **medal_row_fields(index + 1, year_bests[index]),
                **multisport_row_fields(activity.get("parent_sport")),
            }
        )
    return rows


def add_formatted_cells(table: ui.table, names: list[str]) -> None:
    """Sort on the raw values but display the formatted ones."""
    for name in names:
        table.add_slot(
            f"body-cell-{name}", f'<q-td :props="props">{{{{ props.row.{name} }}}}</q-td>'
        )


def render_top_table(metric: str, activities: list[dict], compact: bool) -> ui.table:
    table = (
        ui.table(
            columns=top_table_columns(metric, compact),
            rows=top_table_rows(metric, activities),
            row_key="rank",
            pagination=None if compact else 25,
        )
        .classes("w-full top-activities-table")
        .props("dense flat")
    )
    cells = ["value"] if compact else ["date", "value", "other", "duration"]
    add_formatted_cells(table, cells)
    add_rank_medal_cell(table)
    add_multisport_cell(table)
    add_year_medal_cell(table, "date")
    table.on("rowClick", lambda e: ui.navigate.to(f"/activity/{e.args[1]['activity_id']}"))
    return table


def _stat_tile(label: str, value: str) -> None:
    with ui.column().classes("items-center gap-0"):
        ui.label(value).classes("text-h5 text-weight-bold text-primary")
        ui.label(label).classes("text-caption text-grey-6")


async def top_activities_page(
    metric: str, sport: Optional[str] = None, year: Optional[int] = None
) -> None:
    if metric not in TOP_METRICS:
        ui.label(f"Unknown ranking '{metric}'.").classes("text-h6 text-grey-6")
        ui.button(
            "Best Efforts", icon="arrow_back", on_click=lambda: ui.navigate.to("/best-efforts")
        ).props("flat dense no-caps color=primary")
        return

    config = TOP_METRICS[metric]
    ui.add_head_html("<style>.top-activities-table tbody td { cursor: pointer; }</style>")
    selected_sport = sport or ALL_RUNNING
    sport_filter: dict[str, Optional[str]] = {"value": selected_sport}
    year_filter: dict[str, Optional[int]] = {"value": year}

    async def refresh():
        content_col.clear()
        activities = await run.io_bound(
            db_get_top_activities, metric, sport_filter["value"], year_filter["value"]
        )

        with content_col:
            if not activities:
                selection = sport_label(sport_filter["value"] or ALL_RUNNING).lower()
                with ui.card().classes("w-full q-pa-lg text-center"):
                    ui.icon(config["icon"], size="48px").classes("text-grey-4")
                    ui.label(f"No {selection} activities with {metric} data yet.").classes(
                        "text-grey-6 q-mt-sm"
                    )
                return

            values = [a[config["field"]] or 0 for a in activities]
            selected = sport_filter["value"]
            with ui.card().classes("w-full q-pa-md"):
                with ui.row().classes("gap-8 justify-around w-full"):
                    _stat_tile("Activities", str(len(activities)))
                    _stat_tile(config["best_label"], config["format"](max(values), selected))
                    _stat_tile(
                        "Average", config["format"](sum(values) / len(values), selected)
                    )
                    _stat_tile(
                        config["total_label"], config["format_total"](sum(values), selected)
                    )

            with ui.card().classes("w-full q-pa-md"):
                render_top_table(metric, activities, compact=False)

    # ── toolbar ──
    with ui.row().classes("items-center justify-between w-full q-mb-md flex-wrap gap-3"):
        with ui.row().classes("items-center gap-2"):
            ui.button(
                "Best Efforts",
                icon="arrow_back",
                on_click=lambda: ui.navigate.to(
                    filtered_url("/best-efforts", sport_filter["value"], year_filter["value"])
                ),
            ).props("flat dense no-caps color=primary")
            ui.icon(sport_icon(sport_filter["value"])).classes("text-grey-7")
            ui.label(config["page_title"]).classes("text-h5 text-weight-bold")
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
