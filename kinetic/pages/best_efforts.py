"""Best Efforts page."""

from datetime import datetime
from typing import Optional

from nicegui import run, ui
from sqlmodel import Session, col, select

from kinetic.database import engine
from kinetic.models import Activity, BestEffort, SportType
from kinetic.pages.top_activities import (
    TOP_METRICS,
    db_get_top_activities,
    top_activities_url,
)
from kinetic.queries import multisport_parent_sports
from kinetic.ui_helpers import (
    ALL_RUNNING,
    distance_label,
    filtered_url,
    format_date,
    format_distance,
    format_duration,
    format_pace,
    resolve_sports,
    sport_filter_options,
    sport_label,
)


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


_TROPHY_PAGE_CSS = """
.trophy-hero {
    position: relative;
    overflow: hidden;
    color: #fff;
    border: 1px solid rgba(255, 220, 145, .24);
    background: linear-gradient(118deg, #201a36 0%, #49314d 58%, #9a542f 100%);
    box-shadow: 0 16px 36px rgba(50, 31, 54, .22);
}
.trophy-hero::after {
    content: "";
    position: absolute;
    width: 260px;
    height: 260px;
    top: -145px;
    right: -35px;
    border: 1px solid rgba(255, 226, 163, .2);
    border-radius: 50%;
    box-shadow: 0 0 0 24px rgba(255, 226, 163, .04),
                0 0 0 50px rgba(255, 226, 163, .035);
}
.trophy-hero-content { position: relative; z-index: 1; }
.trophy-hero-copy { flex: 1; min-width: 0; }
.trophy-kicker {
    color: #ffdb8a;
    letter-spacing: .14em;
    font-size: .72rem;
    font-weight: 700;
}
.trophy-hero-title {
    color: #fff;
    letter-spacing: -.035em;
    font-size: clamp(1.9rem, 5vw, 3rem) !important;
}
.trophy-hero-subtitle { color: rgba(255,255,255,.72); }
.trophy-hero-icon {
    color: #ffdc8c;
    filter: drop-shadow(0 8px 14px rgba(255, 190, 75, .3));
}
.trophy-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
    gap: 16px;
}
.trophy-grid > .trophy-grid-item { min-width: 0; }
.trophy-grid-item > .trophy-tile { flex: 1; }
.trophy-grid-empty { grid-column: 1 / -1; }
.trophy-section-divider {
    grid-column: 1 / -1;
    margin: 12px 0 4px;
}
.trophy-section-divider .q-separator {
    flex: 1;
    background: rgba(205, 161, 77, .3);
}
.trophy-tile {
    position: relative;
    overflow: hidden;
    height: 100%;
    gap: 4px;
    border: 1px solid rgba(205, 161, 77, .25);
    background: linear-gradient(145deg, #fff 0%, #fffaf0 100%);
    box-shadow: 0 8px 22px rgba(75, 54, 23, .08);
    transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
}
.trophy-tile::before {
    content: "";
    position: absolute;
    inset: 0 0 auto;
    height: 4px;
    background: linear-gradient(90deg, #f5c35e, #f18a39, #e5c36d);
}
.trophy-tile:hover {
    transform: translateY(-4px);
    border-color: rgba(205, 161, 77, .58);
    box-shadow: 0 16px 30px rgba(75, 54, 23, .15);
}
.trophy-tile-heading {
    width: calc(100% + 32px);
    margin: -16px -16px 8px;
    padding: 18px 16px 14px;
    background: linear-gradient(115deg, #30243e, #574039);
}
.trophy-tile-heading .trophy-record-label {
    color: #fff;
    font-size: 1.4rem;
    font-weight: 700;
    letter-spacing: -.025em;
    line-height: 1.3;
    white-space: nowrap;
}
.trophy-tile-heading .trophy-record-label--metric { font-size: 1rem; }
.trophy-record-icon {
    color: #c38b2e;
    background: rgba(226, 183, 94, .16);
    border: 1px solid rgba(195, 139, 46, .16);
    border-radius: 50%;
    padding: 8px;
}
.trophy-category-icon { color: #a87826; }
.trophy-tile-heading .trophy-category-icon { color: #ffdc8c; }
.trophy-tile-heading .trophy-record-icon {
    color: #ffdc8c;
    background: rgba(255, 220, 140, .12);
    border-color: rgba(255, 220, 140, .2);
}
.trophy-value {
    color: #7e4a18;
    font-size: 2rem;
    font-weight: 800;
    letter-spacing: -.055em;
    line-height: 1.08;
}
.trophy-detail {
    display: inline-flex;
    align-items: center;
    color: #81571f;
    background: rgba(226, 183, 94, .17);
    border: 1px solid rgba(195, 139, 46, .15);
    border-radius: 999px;
    padding: 4px 10px;
    font-weight: 600;
}
.trophy-tile .q-separator { background: rgba(133, 101, 53, .14); }
.trophy-tile-footer { margin-top: auto; padding-top: 8px; }
.trophy-activity { color: #322719; font-weight: 650; }
.trophy-date { color: #82776a; }
.trophy-summary {
    border: 1px solid rgba(120, 130, 145, .14);
    background: linear-gradient(135deg, rgba(255,255,255,.94), rgba(247,248,250,.94));
}
.trophy-filters {
    border: 1px solid rgba(205, 161, 77, .2);
    background: linear-gradient(110deg, #fffaf0, #fff);
    box-shadow: 0 4px 16px rgba(75, 54, 23, .04);
}
.trophy-filter-heading { flex: 1; min-width: 180px; }
.trophy-filter-controls { flex-wrap: wrap; gap: 12px; }
.trophy-filter { width: 180px; }
.trophy-filter .q-field__control {
    border-radius: 14px;
    background: rgba(255,255,255,.8);
}
.trophy-filter.q-field--outlined .q-field__control::before {
    border-color: rgba(168, 120, 38, .25);
}
.trophy-filter.q-field--focused .q-field__control::after { border-color: #a87826; }
.trophy-filter .q-field__label { color: #82776a; }
.trophy-filter .q-field__native { font-weight: 600; }
.trophy-filter .q-field__prepend, .trophy-filter .q-select__dropdown-icon { color: #a87826; }
.trophy-filter-menu {
    border: 1px solid rgba(205, 161, 77, .25);
    border-radius: 14px;
    padding: 6px;
}
.trophy-filter-menu .q-item--active {
    color: #81571f;
    background: rgba(226, 183, 94, .17);
}
.body--dark .trophy-filters {
    border-color: rgba(226, 183, 94, .18);
    background: linear-gradient(110deg, #302b23, #252525);
}
.body--dark .trophy-filter .q-field__control { background: rgba(255,255,255,.04); }
.body--dark .trophy-filter .q-field__label { color: #b9b0a2; }
.body--dark .trophy-filter .q-field__prepend,
.body--dark .trophy-filter .q-select__dropdown-icon { color: #e7bd68; }
.body--dark .trophy-filter-menu .q-item--active { color: #efd18e; }
.body--dark .trophy-tile {
    border-color: rgba(226, 183, 94, .25);
    background: linear-gradient(145deg, #292721 0%, #302b23 100%);
    box-shadow: 0 8px 22px rgba(0, 0, 0, .18);
}
.body--dark .trophy-category-icon { color: #e7bd68; }
.body--dark .trophy-value { color: #f4cf7a; }
.body--dark .trophy-detail {
    color: #efd18e;
    background: rgba(226, 183, 94, .12);
    border-color: rgba(226, 183, 94, .18);
}
.body--dark .trophy-tile .q-separator { background: rgba(255,255,255,.12); }
.body--dark .trophy-activity { color: #f3eee4; }
.body--dark .trophy-date { color: #b9b0a2; }
.body--dark .trophy-summary {
    border-color: rgba(255,255,255,.1);
    background: linear-gradient(135deg, #252525, #2b2925);
}
@media (prefers-reduced-motion: reduce) {
    .trophy-tile { transition: none; }
    .trophy-tile:hover { transform: none; }
}
@media (max-width: 520px) {
    .trophy-hero { padding: 20px !important; }
    .trophy-hero-art { display: none; }
    .trophy-filter-controls { width: 100%; }
    .trophy-filter { flex: 1; width: auto; min-width: 130px; }
}
"""


def _best_activity_tile(
    title: str,
    icon: Optional[str],
    value: str,
    activity_name: str,
    activity_date: str,
    attempts_url: str,
    detail: Optional[str] = None,
) -> None:
    with (
        ui.card()
        .classes("w-full q-pa-md trophy-tile cursor-pointer")
        .on("click", lambda: ui.navigate.to(attempts_url))
    ):
        with ui.row().classes("items-center justify-between no-wrap trophy-tile-heading"):
            with ui.row().classes("items-center no-wrap gap-2 flex-1 min-w-0"):
                ui.icon(icon or "emoji_events", size="18px").classes(
                    "trophy-record-icon shrink-0"
                )
                ui.label(title).classes(
                    "trophy-record-label trophy-record-label--metric"
                    if icon
                    else "trophy-record-label"
                )
        ui.label(value).classes("trophy-value q-mt-sm")
        if detail:
            ui.label(detail).classes("trophy-detail q-mt-sm")
        with ui.column().classes("w-full gap-0 trophy-tile-footer"):
            ui.separator().classes("q-mb-sm")
            ui.label(activity_name).classes("text-body2 ellipsis trophy-activity w-full")
            with ui.row().classes("items-center gap-1 q-mt-xs"):
                ui.icon("event", size="15px").classes("trophy-date")
                ui.label(format_date(activity_date)).classes("text-caption trophy-date")


async def best_efforts_page(sport: Optional[str] = None, year: Optional[int] = None) -> None:
    ui.add_head_html(f"<style>{_TROPHY_PAGE_CSS}</style>")
    selected_sport = sport or ALL_RUNNING
    sport_filter = {"value": selected_sport}
    year_filter: dict[str, Optional[int]] = {"value": year}

    with ui.card().classes("w-full q-pa-lg q-mb-md trophy-hero"):
        with ui.row().classes("w-full items-center justify-between no-wrap gap-4"):
            with ui.column().classes("trophy-hero-content trophy-hero-copy"):
                ui.label("YOUR PERSONAL RECORDS").classes("trophy-kicker")
                ui.label("Your trophy case").classes("text-h3 text-weight-bold trophy-hero-title")
                ui.label("Every distance. Every climb. Your best, celebrated.").classes(
                    "text-body1 trophy-hero-subtitle"
                )
            ui.icon("emoji_events", size="76px").classes(
                "trophy-hero-icon trophy-hero-content trophy-hero-art"
            )

    async def refresh():
        content_col.clear()
        efforts = await run.io_bound(
            _db_get_best_efforts, sport_filter["value"], year_filter["value"]
        )
        summary = await run.io_bound(
            _db_get_activity_summary, sport_filter["value"], year_filter["value"]
        ) or {"count": 0, "distance_meters": 0.0, "duration_seconds": 0.0}

        with content_col:
            with ui.element("div").classes("w-full trophy-grid"):
                if not efforts:
                    selection = sport_label(sport_filter["value"] or ALL_RUNNING).lower()
                    with ui.column().classes("trophy-grid-empty"):
                        with ui.card().classes("w-full q-pa-lg text-center"):
                            ui.icon("emoji_events", size="48px").classes("text-amber-5")
                            ui.label(f"No {selection} records yet.").classes(
                                "text-grey-6 q-mt-sm"
                            )
                else:
                    grouped: dict[float, list[dict]] = {}
                    for e in efforts:
                        d = e["distance_meters"]
                        grouped.setdefault(d, []).append(e)

                    for dist, dist_efforts in sorted(grouped.items()):
                        best = dist_efforts[0]
                        with ui.column().classes("trophy-grid-item"):
                            _best_activity_tile(
                                distance_label(dist, sport_filter["value"]),
                                None,
                                format_duration(best["duration_seconds"]),
                                best["activity_name"],
                                best["date"],
                                filtered_url(
                                    f"/best-efforts/{dist:.2f}".rstrip("0").rstrip("."),
                                    sport_filter["value"],
                                    year_filter["value"],
                                ),
                                detail=format_pace(
                                    dist, best["duration_seconds"], best["sport"].value
                                ),
                            )

                metric_section_started = False
                for metric in TOP_METRICS:
                    top = await run.io_bound(
                        db_get_top_activities,
                        metric,
                        sport_filter["value"],
                        year_filter["value"],
                        1,
                    )
                    if not top:
                        continue
                    if not metric_section_started:
                        with ui.row().classes(
                            "items-center no-wrap gap-3 trophy-section-divider"
                        ):
                            ui.separator()
                            ui.label("Standout Achievements").classes(
                                "text-caption text-weight-bold trophy-date"
                            )
                            ui.separator()
                        metric_section_started = True
                    config = TOP_METRICS[metric]
                    best = top[0]
                    with ui.column().classes("trophy-grid-item"):
                        _best_activity_tile(
                            config["card_title"],
                            config["icon"],
                            config["format"](
                                best[config["field"]] or 0, best.get("sport")
                            ),
                            best["name"],
                            best["date"],
                            top_activities_url(
                                metric, sport_filter["value"], year_filter["value"]
                            ),
                        )

            with ui.card().classes("w-full q-pa-md trophy-summary"):
                with ui.row().classes("items-center gap-2 q-mb-md"):
                    ui.icon("insights").classes("text-grey-6")
                    ui.label("Your training, at a glance").classes(
                        "text-subtitle1 text-weight-bold"
                    )
                with ui.row().classes("gap-8 flex-wrap"):
                    _stat_tile("Total Activities", str(summary["count"]))
                    _stat_tile(
                        "Total Distance",
                        format_distance(summary["distance_meters"], sport_filter["value"]),
                    )
                    _stat_tile("Total Time", format_duration(summary["duration_seconds"]))

    # ── toolbar ──
    with ui.card().classes("w-full q-pa-md q-mb-md trophy-filters"):
        with ui.row().classes("items-center w-full gap-4"):
            with ui.column().classes("gap-1 trophy-filter-heading"):
                with ui.row().classes("items-center gap-2"):
                    ui.icon("tune", size="20px").classes("trophy-category-icon")
                    ui.label("Explore your records").classes("text-subtitle1 text-weight-bold")
                ui.label("Choose your discipline and season.").classes(
                    "text-caption trophy-date"
                )
            with ui.row().classes("trophy-filter-controls"):
                sport_select = ui.select(
                    sport_filter_options(include_all_sports=False),
                    value=selected_sport,
                    label="Sport",
                    on_change=lambda e: (
                        sport_filter.__setitem__("value", e.value),
                        ui.timer(0, refresh, once=True),
                    ),
                ).classes("trophy-filter").props(
                    'outlined dense options-dense popup-content-class="trophy-filter-menu"'
                )
                with sport_select.add_slot("prepend"):
                    ui.icon("category", size="20px")
                year_select = ui.select(
                    ["All years"] + [str(y) for y in range(datetime.now().year, 2009, -1)],
                    value=str(year) if year else "All years",
                    label="Year",
                    on_change=lambda e: (
                        year_filter.__setitem__(
                            "value", None if e.value == "All years" else int(e.value)
                        ),
                        ui.timer(0, refresh, once=True),
                    ),
                ).classes("trophy-filter").props(
                    'outlined dense options-dense popup-content-class="trophy-filter-menu"'
                )
                with year_select.add_slot("prepend"):
                    ui.icon("event", size="20px")

    content_col = ui.column().classes("w-full gap-4")
    await refresh()
