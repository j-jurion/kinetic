"""Map page — every activity with GPS data drawn on a single map."""
from urllib.parse import urlencode

from nicegui import run, ui
from sqlmodel import Session, col, select

from kinetic.api import select_map_activities
from kinetic.database import engine
from kinetic.models import Activity
from kinetic.ui_helpers import SPORT_COLORS, SPORT_ICONS, SPORTS


def _db_sports_with_routes() -> list[str]:
    """Sports that actually have at least one activity with GPS data."""
    with Session(engine) as session:
        rows = session.exec(
            select(Activity.sport).where(col(Activity.route_json).is_not(None)).distinct()
        ).all()
    present = {r.value if hasattr(r, "value") else str(r) for r in rows}
    return [s for s in SPORTS if s in present]


def _db_map_counts(wanted: set[str]) -> dict[str, int]:
    """How many of the selected activities end up on the map, and why the others don't."""
    with Session(engine) as session:
        candidates = session.exec(
            select(Activity).where(col(Activity.sport).in_(list(wanted)))
        ).all()
        # Mirror the map's de-duplication: a multisport leg is covered by its parent.
        ids = {a.id for a in candidates}
        candidates = [a for a in candidates if a.parent_id not in ids]
        without_gps = sum(1 for a in candidates if not a.route_json)

    return {
        "drawn": len(select_map_activities(wanted)),
        "total": len(candidates),
        "without_gps": without_gps,
    }


async def map_page() -> None:
    available = await run.io_bound(_db_sports_with_routes)
    selected: list[str] = list(available)

    def _map_url() -> str:
        if selected and set(selected) != set(available):
            return "/api/activities/map?" + urlencode({"sports": ",".join(selected)})
        return "/api/activities/map"

    def render_map() -> None:
        map_container.clear()
        with map_container:
            if not available:
                ui.label("No activities with GPS data yet.").classes(
                    "text-grey-6 text-center w-full q-pa-xl"
                )
                return
            if not selected:
                ui.label("Select at least one activity type to show routes.").classes(
                    "text-grey-6 text-center w-full q-pa-xl"
                )
                return
            ui.element("iframe").props(
                f'src="{_map_url()}" loading="lazy"'
            ).style("width:100%;height:100%;border:none;display:block")

    def toggle(sport: str, value: bool) -> None:
        if value and sport not in selected:
            selected.append(sport)
        elif not value and sport in selected:
            selected.remove(sport)
        render_map()
        ui.timer(0, refresh_summary, once=True)

    with ui.row().classes("items-center justify-between w-full q-mb-md flex-wrap gap-3"):
        ui.label("Map").classes("text-h5 text-weight-bold")
        with ui.row().classes("items-center gap-2 flex-wrap"):
            def set_all(value: bool) -> None:
                selected.clear()
                if value:
                    selected.extend(available)
                for sport, chip in chips.items():
                    chip.set_selected(sport in selected)
                render_map()
                ui.timer(0, refresh_summary, once=True)

            ui.button("All", on_click=lambda: set_all(True)).props("flat dense")
            ui.button("None", on_click=lambda: set_all(False)).props("flat dense")

    chips: dict[str, ui.chip] = {}
    with ui.row().classes("items-center gap-2 w-full q-mb-md flex-wrap"):
        for sport in available:
            color = SPORT_COLORS.get(sport, "#6b7280")
            chip = ui.chip(
                sport.replace("_", " ").title(),
                icon=SPORT_ICONS.get(sport, "sports"),
                selectable=True,
                selected=True,
                color=color,
                on_selection_change=lambda e, s=sport: toggle(s, bool(e.value)),
            ).props("outline dense")
            chips[sport] = chip

    map_container = ui.card().classes("w-full overflow-hidden").style(
        "padding:0; height:70vh; min-height:420px"
    )
    summary = ui.label("").classes("text-caption text-grey-6 q-mt-sm")

    async def refresh_summary() -> None:
        if not selected:
            summary.set_text("No activity types selected.")
            return
        counts = await run.io_bound(_db_map_counts, set(selected))
        parts = [f"{counts['drawn']} of {counts['total']} activities drawn"]
        if counts["without_gps"]:
            parts.append(f"{counts['without_gps']} have no GPS data")
        parts.append(
            "hover a route for its stats; overlapping routes are listed together"
        )
        summary.set_text(" · ".join(parts))

    render_map()
    await refresh_summary()
