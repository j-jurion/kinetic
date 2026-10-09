"""Kinetic – Activity Tracking App.

Run with:  python -m kinetic.main
"""

from functools import partial

from fastapi import FastAPI
from nicegui import app as nicegui_app
from nicegui import ui

from kinetic.api import router
from kinetic.database import create_db_and_tables
from kinetic.pages.activities import activities_page
from kinetic.pages.activity_detail import activity_detail_page
from kinetic.pages.best_effort_distance import best_effort_distance_page
from kinetic.pages.best_efforts import best_efforts_page
from kinetic.pages.friends import friends_page
from kinetic.pages.graphs import graphs_page
from kinetic.pages.map import map_page
from kinetic.pages.sync import sync_page
from kinetic.pages.top_activities import top_activities_page

# ── FastAPI setup ─────────────────────────────────────────────────────────────
fastapi_app = FastAPI(title="Kinetic API")
fastapi_app.include_router(router, prefix="/api")

# ── Shared CSS ────────────────────────────────────────────────────────────────
# Injected into <head> as a <link> so the @import works correctly
GOOGLE_FONTS_LINK = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2'
    '?family=Inter:wght@300;400;500;600;700&display=swap">'
)

# Scoped to body text only — never override icon font families
GLOBAL_CSS = """
body, .q-field, .q-btn, .q-card, .q-item, .q-label,
.q-table, .q-menu, .q-dialog, .q-select, .q-input,
.q-toolbar, .q-header, .q-drawer, .text-h1, .text-h2,
.text-h3, .text-h4, .text-h5, .text-h6, .text-body1,
.text-body2, .text-caption, .text-weight-bold,
.text-weight-medium, .text-weight-semibold {
    font-family: 'Inter', 'Roboto', sans-serif !important;
}

.q-card { border-radius: 12px !important; }
.q-btn { border-radius: 8px !important; }
.q-item { border-radius: 8px !important; }

.q-header {
    background: #ffffff;
    border-bottom: 1px solid rgba(0,0,0,0.08);
    color: #111827 !important;
}
.body--dark .q-header {
    background: #1d1d1d !important;
    border-bottom: 1px solid rgba(255,255,255,0.08) !important;
    color: #f9fafb !important;
}
"""


async def _shell(title: str, dark_ref: list, content_fn):
    """Render the shared app shell with nav drawer + header + content."""
    dark = ui.dark_mode(value=nicegui_app.storage.user.get("dark_mode", False))
    dark_ref.append(dark)

    ui.add_head_html(GOOGLE_FONTS_LINK)
    ui.add_css(GLOBAL_CSS)
    ui.colors(primary="#f97316", secondary="#3b82f6")

    with ui.left_drawer(fixed=True).classes("q-pa-md").props("width=220 bordered"):
        with ui.column().classes("full-height gap-1"):
            nav_items = [
                ("Activities", "list", "/"),
                ("Map", "map", "/map"),
                ("Graphs", "bar_chart", "/graphs"),
                ("Best Efforts", "emoji_events", "/best-efforts"),
                ("Friends", "people", "/friends"),
                ("Sync", "sync", "/sync"),
            ]
            for label, icon, path in nav_items:
                with ui.item(
                    on_click=partial(ui.navigate.to, path),
                ).classes("rounded-borders q-mb-xs cursor-pointer"):
                    with ui.item_section().props("avatar"):
                        ui.icon(icon).classes("text-grey-7")
                    with ui.item_section():
                        ui.item_label(label).classes("text-weight-medium")

    with ui.header(elevated=False).classes("items-center justify-between q-px-lg"):
        with ui.row().classes("items-center gap-3"):
            ui.icon("bolt", size="24px").classes("text-primary")
            ui.label("Kinetic").classes("text-h6 text-weight-bold")
            ui.separator().props("vertical").classes("q-mx-sm").style("height:20px; opacity:0.3")
            ui.label(title).classes("text-body1 text-weight-medium")
        with ui.row().classes("items-center gap-2"):

            def toggle_dark():
                if dark.value:
                    dark.disable()
                else:
                    dark.enable()
                nicegui_app.storage.user["dark_mode"] = dark.value

            ui.button(icon="dark_mode", on_click=toggle_dark).props("flat round dense")

    with ui.page_sticky(position="top-right", x_offset=20, y_offset=70):
        pass  # reserved

    with ui.column().classes("w-full q-pa-md").style("max-width: 1200px; margin: 0 auto"):
        await content_fn()


# ── Pages ─────────────────────────────────────────────────────────────────────


@ui.page("/")
async def page_index():
    dark_ref = []
    await _shell(title="Activities", dark_ref=dark_ref, content_fn=activities_page)


@ui.page("/map")
async def page_map_route():
    dark_ref = []
    await _shell(title="Map", dark_ref=dark_ref, content_fn=map_page)


@ui.page("/graphs")
async def page_graphs():
    dark_ref = []
    await _shell(title="Graphs", dark_ref=dark_ref, content_fn=graphs_page)


@ui.page("/best-efforts")
async def page_best_efforts():
    dark_ref = []
    await _shell(title="Best Efforts", dark_ref=dark_ref, content_fn=best_efforts_page)


@ui.page("/best-efforts/top/{metric}")
async def page_top_activities(metric: str, sport: str = "", year: str = ""):
    dark_ref = []
    year_value = int(year) if year.isdigit() else None
    await _shell(
        title="Best Efforts",
        dark_ref=dark_ref,
        content_fn=lambda: top_activities_page(metric, sport or None, year_value),
    )


@ui.page("/best-efforts/{distance}")
async def page_best_effort_distance(distance: float, sport: str = "", year: str = ""):
    dark_ref = []
    year_value = int(year) if year.isdigit() else None
    await _shell(
        title="Best Efforts",
        dark_ref=dark_ref,
        content_fn=lambda: best_effort_distance_page(distance, sport or None, year_value),
    )


@ui.page("/friends")
async def page_friends_route():
    dark_ref = []
    await _shell(title="Friends", dark_ref=dark_ref, content_fn=friends_page)


@ui.page("/sync")
async def page_sync_route():
    dark_ref = []
    await _shell(title="Garmin Sync", dark_ref=dark_ref, content_fn=sync_page)


@ui.page("/activity/{activity_id}")
async def page_activity_detail(activity_id: int):
    dark_ref = []
    await _shell(
        title="Activity",
        dark_ref=dark_ref,
        content_fn=lambda: activity_detail_page(activity_id),
    )


# ── Startup ───────────────────────────────────────────────────────────────────


@nicegui_app.on_startup
async def startup():
    create_db_and_tables()


def main():
    ui.run_with(
        fastapi_app,
        title="Kinetic",
        favicon="⚡",
        dark=None,  # respect system preference initially
        storage_secret="kinetic-secret-change-me",
    )

    import uvicorn

    uvicorn.run(fastapi_app, host="localhost", port=8080)


if __name__ == "__main__":
    main()
