"""All attempts at a single best-effort distance."""

from datetime import datetime
from typing import Optional

import plotly.graph_objects as go
from nicegui import run, ui
from sqlmodel import Session, col, select

from kinetic.database import engine
from kinetic.models import Activity, BestEffort, SportType
from kinetic.queries import multisport_parent_sports
from kinetic.ui_helpers import (
    ALL_RUNNING,
    DATE_FORMAT,
    add_medal_cell,
    add_multisport_cell,
    add_year_medal_cell,
    distance_label,
    format_date,
    format_duration,
    format_pace,
    mark_year_bests,
    medal_column,
    medal_row_fields,
    multisport_row_fields,
    resolve_sports,
    sport_color,
    sport_icon,
    sport_label,
)

# Stored distances come from a fixed set of targets that are far apart, so a small
# tolerance safely absorbs float rounding from the URL round-trip.
_DISTANCE_TOLERANCE = 0.5


def _db_get_distance_attempts(
    distance: float, sport: Optional[str], year: Optional[int]
) -> list[dict]:
    with Session(engine) as session:
        stmt = (
            select(BestEffort, Activity)
            .join(Activity, col(BestEffort.activity_id) == col(Activity.id))
            .where(col(BestEffort.distance_meters) >= distance - _DISTANCE_TOLERANCE)
            .where(col(BestEffort.distance_meters) <= distance + _DISTANCE_TOLERANCE)
        )
        sports = resolve_sports(sport)
        if sports:
            stmt = stmt.where(col(BestEffort.sport).in_([SportType(s) for s in sports]))
        if year:
            stmt = stmt.where(BestEffort.year == year)
        stmt = stmt.order_by(col(BestEffort.duration_seconds))
        results = session.exec(stmt).all()
        parents = multisport_parent_sports(session, (a.parent_id for _, a in results))
        return [
            {
                "activity_id": effort.activity_id,
                "activity_name": activity.name,
                "parent_sport": parents.get(activity.parent_id) if activity.parent_id else None,
                "sport": effort.sport.value,
                "kind": activity.kind.value,
                "date": effort.date.isoformat(),
                "year": effort.year,
                "duration_seconds": effort.duration_seconds,
                "distance_meters": effort.distance_meters,
                # Climb of the whole activity, not just the best-effort segment
                "elevation_gain_meters": activity.elevation_gain_meters,
            }
            for effort, activity in results
        ]


def build_progression_chart(
    attempts: list[dict], distance: float, sport: Optional[str]
) -> go.Figure:
    fig = go.Figure()
    if not attempts:
        fig.add_annotation(text="No data", x=0.5, y=0.5, showarrow=False, font=dict(size=16))
        return fig

    by_date = sorted(attempts, key=lambda a: a["date"])
    color = sport_color(sport)
    fig.add_trace(
        go.Scatter(
            x=[a["date"][:10] for a in by_date],
            y=[a["duration_seconds"] / 60 for a in by_date],
            mode="lines+markers",
            name="Time",
            line=dict(color=color, width=2),
            marker=dict(color=color, size=8),
            customdata=[
                [
                    format_duration(a["duration_seconds"]),
                    a["activity_name"],
                    format_date(a["date"]),
                ]
                for a in by_date
            ],
            hovertemplate=(
                "<b>%{customdata[1]}</b><br>%{customdata[2]}<br>"
                "Time: %{customdata[0]}<extra></extra>"
            ),
        )
    )
    fig.update_layout(
        title=f"{distance_label(distance, sport)} progression",
        xaxis_title="Date",
        yaxis_title="Time (minutes)",
        xaxis=dict(tickformat=DATE_FORMAT),
        plot_bgcolor="rgba(0,0,0,0)",
        paper_bgcolor="rgba(0,0,0,0)",
        font=dict(family="Inter, sans-serif"),
        margin=dict(l=40, r=20, t=50, b=40),
        showlegend=False,
    )
    return fig


def _stat_tile(label: str, value: str) -> None:
    with ui.column().classes("items-center gap-0"):
        ui.label(value).classes("text-h5 text-weight-bold text-primary")
        ui.label(label).classes("text-caption text-grey-6")


async def best_effort_distance_page(
    distance: float, sport: Optional[str] = None, year: Optional[int] = None
) -> None:
    ui.add_head_html("<style>.attempts-table tbody td { cursor: pointer; }</style>")
    # Every best effort belongs to a sport, so "all sports" would mix unrelated records
    selected_sport = sport or ALL_RUNNING
    sport_filter: dict[str, Optional[str]] = {"value": selected_sport}
    year_filter: dict[str, Optional[int]] = {"value": year}
    label = distance_label(distance, selected_sport)

    async def refresh():
        content_col.clear()
        attempts = await run.io_bound(
            _db_get_distance_attempts, distance, sport_filter["value"], year_filter["value"]
        )

        with content_col:
            if not attempts:
                selection = sport_label(sport_filter["value"] or ALL_RUNNING).lower()
                with ui.card().classes("w-full q-pa-lg text-center"):
                    ui.icon("emoji_events", size="48px").classes("text-grey-4")
                    ui.label(f"No {selection} attempts recorded at {label} yet.").classes(
                        "text-grey-6 q-mt-sm"
                    )
                return

            times = [a["duration_seconds"] for a in attempts]
            with ui.card().classes("w-full q-pa-md"):
                with ui.row().classes("gap-8 justify-around w-full"):
                    _stat_tile("Attempts", str(len(attempts)))
                    _stat_tile("Best", format_duration(min(times)))
                    _stat_tile("Average", format_duration(sum(times) / len(times)))
                    _stat_tile("Slowest", format_duration(max(times)))
                    _stat_tile(
                        "Best pace", format_pace(distance, min(times), attempts[0]["sport"])
                    )

            with ui.card().classes("w-full q-pa-md"):
                cols = [
                    {"name": "rank", "label": "#", "field": "rank", "align": "left"},
                    medal_column(),
                    {
                        "name": "date",
                        "label": "Date",
                        "field": "date_iso",
                        "align": "left",
                        "sortable": True,
                    },
                    {
                        "name": "activity",
                        "label": "Activity",
                        "field": "activity",
                        "align": "left",
                        "sortable": True,
                    },
                    {"name": "kind", "label": "Type", "field": "kind", "align": "left"},
                    {
                        "name": "elevation",
                        "label": "Elevation",
                        "field": "elevation_meters",
                        "align": "right",
                        "sortable": True,
                    },
                    {
                        "name": "time",
                        "label": "Time",
                        "field": "duration_seconds",
                        "align": "right",
                        "sortable": True,
                    },
                    {"name": "pace", "label": "Pace", "field": "pace", "align": "right"},
                ]
                year_bests = mark_year_bests([a["year"] for a in attempts])
                rows = [
                    {
                        "rank": f"#{i + 1}",
                        "date": format_date(a["date"]),
                        "date_iso": a["date"][:10],
                        "year": str(a["year"]),
                        "activity": a["activity_name"],
                        "kind": a["kind"].replace("_", " "),
                        "elevation": (
                            f"{a['elevation_gain_meters']:.0f} m"
                            if a.get("elevation_gain_meters")
                            else "–"
                        ),
                        "elevation_meters": a.get("elevation_gain_meters") or 0,
                        "time": format_duration(a["duration_seconds"]),
                        "duration_seconds": a["duration_seconds"],
                        "pace": format_pace(
                            a["distance_meters"], a["duration_seconds"], a["sport"]
                        ),
                        "activity_id": a["activity_id"],
                        **multisport_row_fields(a.get("parent_sport")),
                        **medal_row_fields(i + 1, year_bests[i]),
                    }
                    for i, a in enumerate(attempts)
                ]
                tbl = (
                    ui.table(columns=cols, rows=rows, row_key="rank", pagination=25)
                    .classes("w-full attempts-table")
                    .props("dense flat")
                )
                # Sort on the raw ISO date / seconds, but show the formatted values
                tbl.add_slot("body-cell-time", '<q-td :props="props">{{ props.row.time }}</q-td>')
                tbl.add_slot(
                    "body-cell-elevation",
                    '<q-td :props="props">{{ props.row.elevation }}</q-td>',
                )
                add_multisport_cell(tbl)
                add_medal_cell(tbl)
                # The date cell doubles as the "best of this year" marker
                add_year_medal_cell(tbl, "date")
                tbl.on(
                    "rowClick",
                    lambda e: ui.navigate.to(f"/activity/{e.args[1]['activity_id']}"),
                )

            with ui.card().classes("w-full q-pa-md"):
                ui.plotly(
                    build_progression_chart(attempts, distance, sport_filter["value"])
                ).classes("w-full").style("height: 340px")

    # ── toolbar ──
    with ui.row().classes("items-center justify-between w-full q-mb-md flex-wrap gap-3"):
        with ui.row().classes("items-center gap-2"):
            ui.button(
                "Best Efforts",
                icon="arrow_back",
                on_click=lambda: ui.navigate.to("/best-efforts"),
            ).props("flat dense no-caps color=primary")
            ui.icon(sport_icon(sport_filter["value"])).classes("text-grey-7")
            ui.label(f"{label} – all attempts").classes("text-h5 text-weight-bold")
        with ui.row().classes("gap-2"):
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
