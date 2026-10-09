"""Graphs page - monthly and yearly charts."""

from datetime import datetime
from typing import Optional

import plotly.graph_objects as go
from nicegui import run, ui
from sqlmodel import Session, col, select

from kinetic.database import engine
from kinetic.models import Activity, SportType
from kinetic.ui_helpers import (
    ALL_SPORTS,
    resolve_sports,
    sport_color,
    sport_filter_options,
    sport_label,
)


def _db_get_monthly(sport: Optional[str], year: Optional[int]) -> list[dict]:
    with Session(engine) as session:
        stmt = select(Activity)
        sports = resolve_sports(sport)
        if sports:
            stmt = stmt.where(col(Activity.sport).in_([SportType(s) for s in sports]))
        if year:
            stmt = stmt.where(col(Activity.date) >= datetime(year, 1, 1))
            stmt = stmt.where(col(Activity.date) < datetime(year + 1, 1, 1))
        activities = session.exec(stmt).all()
    monthly: dict[tuple, dict] = {}
    for a in activities:
        key = (a.date.year, a.date.month)
        if key not in monthly:
            monthly[key] = {
                "year": key[0],
                "month": key[1],
                "count": 0,
                "distance_km": 0.0,
                "duration_hours": 0.0,
            }
        monthly[key]["count"] += 1
        monthly[key]["distance_km"] += (a.distance_meters or 0) / 1000
        monthly[key]["duration_hours"] += a.duration_seconds / 3600
    return sorted(monthly.values(), key=lambda x: (x["year"], x["month"]))


def _db_get_yearly(sport: Optional[str]) -> list[dict]:
    with Session(engine) as session:
        stmt = select(Activity)
        sports = resolve_sports(sport)
        if sports:
            stmt = stmt.where(col(Activity.sport).in_([SportType(s) for s in sports]))
        activities = session.exec(stmt).all()
    yearly: dict[int, dict] = {}
    for a in activities:
        y = a.date.year
        if y not in yearly:
            yearly[y] = {"year": y, "count": 0, "distance_km": 0.0, "duration_hours": 0.0}
        yearly[y]["count"] += 1
        yearly[y]["distance_km"] += (a.distance_meters or 0) / 1000
        yearly[y]["duration_hours"] += a.duration_seconds / 3600
    return sorted(yearly.values(), key=lambda x: x["year"])


def _db_get_activities_for_pie(sport: Optional[str]) -> list[dict]:
    with Session(engine) as session:
        stmt = select(Activity)
        sports = resolve_sports(sport)
        if sports:
            stmt = stmt.where(col(Activity.sport).in_([SportType(s) for s in sports]))
        return [
            {
                "sport": a.sport,
                "distance_meters": a.distance_meters,
                "duration_seconds": a.duration_seconds,
            }
            for a in session.exec(stmt).all()
        ]


MONTH_NAMES = [
    "",
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
]


METRIC_CONFIG: dict[str, dict] = {
    "distance": {
        "field": "distance_km",
        "label": "Distance (km)",
        "fmt": ".1f",
        "unit": "km",
        "round": 1,
    },
    "count": {"field": "count", "label": "Activities", "fmt": "d", "unit": "", "round": 0},
    "time": {"field": "duration_hours", "label": "Time (h)", "fmt": ".1f", "unit": "h", "round": 1},
}


def build_monthly_chart(
    data: list[dict], sport: Optional[str], year: Optional[int], metric: str = "distance"
) -> go.Figure:
    if not data:
        fig = go.Figure()
        fig.add_annotation(text="No data", x=0.5, y=0.5, showarrow=False, font=dict(size=16))
        return fig

    mc = METRIC_CONFIG[metric]
    labels = [f"{MONTH_NAMES[d['month']]} {d['year']}" for d in data]
    values = [round(d[mc["field"]], mc["round"]) for d in data]
    color = sport_color(sport)
    unit = f" {mc['unit']}" if mc["unit"] else ""
    hover = f"<b>%{{x}}</b><br>{mc['label']}: %{{y:{mc['fmt']}}}{unit}<extra></extra>"

    sport_title = sport_label(sport) if sport else "All Sports"
    year_label = f" ({year})" if year else ""
    fig = go.Figure()
    fig.add_trace(
        go.Bar(
            x=labels,
            y=values,
            name=mc["label"],
            marker_color=color,
            opacity=0.85,
            hovertemplate=hover,
        )
    )
    fig.update_layout(
        title=f"Monthly {mc['label']} – {sport_title}{year_label}",
        xaxis_title="Month",
        yaxis_title=mc["label"],
        plot_bgcolor="rgba(0,0,0,0)",
        paper_bgcolor="rgba(0,0,0,0)",
        font=dict(family="Inter, sans-serif"),
        margin=dict(l=40, r=20, t=50, b=60),
    )
    return fig


def build_yearly_chart(
    data: list[dict], sport: Optional[str], metric: str = "distance"
) -> go.Figure:
    if not data:
        fig = go.Figure()
        fig.add_annotation(text="No data", x=0.5, y=0.5, showarrow=False, font=dict(size=16))
        return fig

    mc = METRIC_CONFIG[metric]
    years = [str(d["year"]) for d in data]
    values = [round(d[mc["field"]], mc["round"]) for d in data]
    color = sport_color(sport)
    unit = f" {mc['unit']}" if mc["unit"] else ""
    hover = f"<b>%{{x}}</b><br>{mc['label']}: %{{y:{mc['fmt']}}}{unit}<extra></extra>"

    fig = go.Figure()
    fig.add_trace(
        go.Bar(
            x=years,
            y=values,
            name=mc["label"],
            marker_color=color,
            opacity=0.85,
            hovertemplate=hover,
        )
    )
    fig.update_layout(
        title=f"Yearly {mc['label']} – {sport_label(sport) if sport else 'All Sports'}",
        xaxis_title="Year",
        yaxis_title=mc["label"],
        plot_bgcolor="rgba(0,0,0,0)",
        paper_bgcolor="rgba(0,0,0,0)",
        font=dict(family="Inter, sans-serif"),
        margin=dict(l=40, r=20, t=50, b=40),
    )
    return fig


def build_sport_breakdown_chart(
    activities: list[dict], year: Optional[int], metric: str = "distance"
) -> go.Figure:
    mc = METRIC_CONFIG[metric]
    totals: dict[str, float] = {}
    for a in activities:
        s = a.get("sport", "other")
        if metric == "distance":
            val = (a.get("distance_meters") or 0) / 1000
        elif metric == "time":
            val = (a.get("duration_seconds") or 0) / 3600
        else:  # count
            val = 1
        totals[s] = totals.get(s, 0) + val

    if not totals:
        fig = go.Figure()
        fig.add_annotation(text="No data", x=0.5, y=0.5, showarrow=False)
        return fig

    labels = list(totals.keys())
    values = [round(v, mc["round"]) for v in totals.values()]
    colors = [sport_color(name, "#6b7280") for name in labels]
    unit = f" {mc['unit']}" if mc["unit"] else ""

    fig = go.Figure(
        go.Pie(
            labels=[sport_label(name) for name in labels],
            values=values,
            marker=dict(colors=colors),
            hovertemplate=(
                f"<b>%{{label}}</b><br>%{{value:{mc['fmt']}}}{unit} "
                "(%{percent})<extra></extra>"
            ),
        )
    )
    fig.update_layout(
        title=f"{mc['label']} by Sport" + (f" ({year})" if year else ""),
        plot_bgcolor="rgba(0,0,0,0)",
        paper_bgcolor="rgba(0,0,0,0)",
        font=dict(family="Inter, sans-serif"),
        margin=dict(l=20, r=20, t=50, b=20),
    )
    return fig


async def graphs_page() -> None:
    sport_filter: dict[str, Optional[str]] = {"value": None}
    year_filter: dict[str, Optional[int]] = {"value": None}
    metric_filter = {"value": "distance"}

    async def refresh():
        monthly_data = await run.io_bound(
            _db_get_monthly, sport_filter["value"], year_filter["value"]
        ) or []
        yearly_data = await run.io_bound(_db_get_yearly, sport_filter["value"]) or []
        pie_data = await run.io_bound(_db_get_activities_for_pie, sport_filter["value"]) or []

        chart_monthly.update_figure(
            build_monthly_chart(
                monthly_data, sport_filter["value"], year_filter["value"], metric_filter["value"]
            )
        )
        chart_yearly.update_figure(
            build_yearly_chart(yearly_data, sport_filter["value"], metric_filter["value"])
        )
        chart_pie.update_figure(
            build_sport_breakdown_chart(pie_data, year_filter["value"], metric_filter["value"])
        )

    # ── toolbar ──
    with ui.row().classes("items-center justify-between w-full q-mb-md flex-wrap gap-3"):
        ui.label("Graphs").classes("text-h5 text-weight-bold")
        with ui.row().classes("gap-2"):
            ui.select(
                sport_filter_options(),
                value=ALL_SPORTS,
                label="Sport",
                on_change=lambda e: (
                    sport_filter.__setitem__("value", e.value or None),
                    ui.timer(0, refresh, once=True),
                ),
            ).classes("w-36")
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
            ui.select(
                {"distance": "Distance", "count": "Activities", "time": "Time"},
                value="distance",
                label="Metric",
                on_change=lambda e: (
                    metric_filter.__setitem__("value", e.value),
                    ui.timer(0, refresh, once=True),
                ),
            ).classes("w-32")

    # ── charts (created after toolbar so they render below it) ──
    with ui.grid(columns=1).classes("w-full gap-4"):
        with ui.card().classes("w-full q-pa-sm"):
            chart_monthly = ui.plotly({}).classes("w-full").style("height: 340px")

        with ui.grid(columns=2).classes("w-full gap-4"):
            with ui.card().classes("w-full q-pa-sm"):
                chart_yearly = ui.plotly({}).style("height: 300px")
            with ui.card().classes("w-full q-pa-sm"):
                chart_pie = ui.plotly({}).style("height: 300px")

    await refresh()
