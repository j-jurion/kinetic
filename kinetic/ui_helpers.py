"""Shared UI helpers, theme tokens and navigation."""
from nicegui import ui

SPORTS = ["running", "cycling", "swimming", "hiking", "walking", "triathlon", "strength", "yoga", "other"]
KINDS = ["race", "training", "easy", "social", "long_run", "tempo", "interval", "recovery", "other"]

SPORT_ICONS = {
    "running": "directions_run",
    "cycling": "directions_bike",
    "swimming": "pool",
    "hiking": "hiking",
    "walking": "directions_walk",
    "triathlon": "sports",
    "strength": "fitness_center",
    "yoga": "self_improvement",
    "other": "sports",
}

SPORT_COLORS = {
    "running": "#f97316",
    "cycling": "#3b82f6",
    "swimming": "#06b6d4",
    "hiking": "#22c55e",
    "walking": "#84cc16",
    "triathlon": "#8b5cf6",
    "strength": "#ec4899",
    "yoga": "#f59e0b",
    "other": "#6b7280",
}

DISTANCE_LABELS: dict[float, str] = {
    400: "400 m",
    800: "800 m",
    1000: "1 km",
    1609.34: "1 mile",
    3000: "3 km",
    5000: "5 km",
    10000: "10 km",
    15000: "15 km",
    30000: "30 km",
    21097.5: "Half marathon",
    42195: "Marathon",
    20000: "20 km",
    40000: "40 km",
    100000: "100 km",
    100: "100 m",
    200: "200 m",
    1500: "1500 m",
}


def format_duration(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    if h > 0:
        return f"{h}h {m:02d}m {s:02d}s"
    return f"{m}:{s:02d}"


def format_pace(distance_m: float, duration_s: float) -> str:
    """Returns min/km pace string."""
    if distance_m <= 0:
        return "-"
    pace_s_per_km = duration_s / (distance_m / 1000)
    m = int(pace_s_per_km // 60)
    s = int(pace_s_per_km % 60)
    return f"{m}:{s:02d} /km"


def format_speed_kmh(speed_ms: float) -> str:
    return f"{speed_ms * 3.6:.1f} km/h"


def sport_chip(sport: str) -> None:
    color = SPORT_COLORS.get(sport, "#6b7280")
    icon = SPORT_ICONS.get(sport, "sports")
    ui.chip(sport, icon=icon, color=color).props("outline dense")


def nav_drawer() -> None:
    """Side navigation."""
    with ui.left_drawer(fixed=True).classes("bg-grey-1 dark:bg-grey-9 q-pa-md").props("width=220 bordered"):
        ui.label("Kinetic").classes("text-h5 text-weight-bold text-primary q-mb-lg")
        nav_items = [
            ("Activities", "list", "/"),
            ("Graphs", "bar_chart", "/graphs"),
            ("Best Efforts", "emoji_events", "/best-efforts"),
            ("Friends", "people", "/friends"),
        ]
        for label, icon, path in nav_items:
            with ui.item(on_click=lambda p=path: ui.navigate.to(p)).classes(
                "rounded-borders q-mb-xs cursor-pointer hover:bg-primary hover:text-white"
            ):
                with ui.item_section().props("avatar"):
                    ui.icon(icon)
                with ui.item_section():
                    ui.item_label(label)


def page_header(title: str, dark_mode_ref: list) -> None:
    with ui.header(elevated=True).classes("items-center justify-between q-px-md"):
        ui.label(title).classes("text-h6 text-weight-bold")
        ui.button(
            icon="dark_mode",
            on_click=lambda: toggle_dark(dark_mode_ref),
        ).props("flat round dense")


def toggle_dark(dark_mode_ref: list) -> None:
    dm = dark_mode_ref[0]
    if dm.value:
        dm.disable()
    else:
        dm.enable()
