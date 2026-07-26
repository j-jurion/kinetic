"""Activity detail page."""
from nicegui import run, ui
from sqlmodel import Session, select

from kinetic.database import engine
from kinetic.models import Activity, ActivityFriend, BestEffort, Friend, Lap
from kinetic.ui_helpers import (
    DISTANCE_LABELS,
    SPORT_COLORS,
    SPORT_ICONS,
    format_duration,
    format_pace,
)


def _db_get_activity_detail(activity_id: int) -> dict:
    with Session(engine) as session:
        activity = session.get(Activity, activity_id)
        if not activity:
            return {}
        laps = session.exec(
            select(Lap).where(Lap.activity_id == activity_id).order_by(Lap.lap_number)
        ).all()
        best_efforts = session.exec(
            select(BestEffort)
            .where(BestEffort.activity_id == activity_id)
            .order_by(BestEffort.distance_meters)
        ).all()
        # Multi-sport: fetch children (if parent) or siblings + parent (if child)
        children: list[dict] = []
        parent: dict | None = None
        if activity.parent_id is None:
            # Could be a triathlon parent — fetch children ordered by date
            raw_children = session.exec(
                select(Activity).where(Activity.parent_id == activity_id).order_by(Activity.date)
            ).all()
            children = [c.model_dump(mode="json") for c in raw_children]
        else:
            parent_act = session.get(Activity, activity.parent_id)
            if parent_act:
                parent = parent_act.model_dump(mode="json")
        return {
            "activity": activity.model_dump(mode="json"),
            "laps": [lap.model_dump(mode="json") for lap in laps],
            "best_efforts": [be.model_dump(mode="json") for be in best_efforts],
            "children": children,
            "parent": parent,
        }


def _db_get_activity_friends(activity_id: int) -> list[dict]:
    with Session(engine) as session:
        friends = session.exec(
            select(Friend)
            .join(ActivityFriend, ActivityFriend.friend_id == Friend.id)
            .where(ActivityFriend.activity_id == activity_id)
        ).all()
        return [f.model_dump(mode="json") for f in friends]


def _db_get_all_friends() -> list[dict]:
    with Session(engine) as session:
        return [f.model_dump(mode="json") for f in session.exec(select(Friend)).all()]


def _db_add_activity_friend(activity_id: int, friend_id: int) -> None:
    with Session(engine) as session:
        if not session.get(ActivityFriend, (activity_id, friend_id)):
            session.add(ActivityFriend(activity_id=activity_id, friend_id=friend_id))
            session.commit()


def _db_remove_activity_friend(activity_id: int, friend_id: int) -> None:
    with Session(engine) as session:
        link = session.get(ActivityFriend, (activity_id, friend_id))
        if link:
            session.delete(link)
            session.commit()


def _stat_card(label: str, value: str, color: str = "#f97316") -> None:
    with ui.card().classes("q-pa-md text-center").style("min-width: 96px"):
        ui.label(value).classes("text-h6 text-weight-bold").style(f"color: {color}")
        ui.label(label).classes("text-caption text-grey-6")


async def activity_detail_page(activity_id: int) -> None:
    from kinetic.page_activities import confirm_delete, show_edit_dialog

    detail = await run.io_bound(_db_get_activity_detail, activity_id)
    if not detail:
        with ui.column().classes("items-center q-mt-xl w-full"):
            ui.icon("error_outline", size="48px").classes("text-grey-4")
            ui.label("Activity not found.").classes("text-grey-6 q-mt-sm")
        return

    a = detail["activity"]
    laps = detail["laps"]
    best_efforts = detail["best_efforts"]
    children: list[dict] = detail.get("children", [])
    parent: dict | None = detail.get("parent")

    sport = a.get("sport", "other")
    icon_name = SPORT_ICONS.get(sport, "sports")
    color = SPORT_COLORS.get(sport, "#6b7280")
    dist = a.get("distance_meters")
    dur = a.get("duration_seconds", 0)

    async def on_refresh():
        ui.navigate.to(f"/activity/{activity_id}")

    # ── Header ────────────────────────────────────────────────────────────────
    with ui.row().classes("items-center gap-3 w-full q-mb-md"):
        ui.button(icon="arrow_back", on_click=lambda: ui.navigate.back()).props("flat round dense")
        ui.icon(icon_name, size="32px").style(f"color: {color}")
        with ui.column().classes("gap-0 flex-1"):
            ui.label(a.get("name", "Activity")).classes("text-h5 text-weight-bold")
            ui.label(
                f"{a.get('date', '')[:10]}  •  {a.get('kind', '').replace('_', ' ').title()}  •  {sport.title()}"
            ).classes("text-caption text-grey-6")
        ui.button(icon="edit", on_click=lambda: show_edit_dialog(a, on_refresh)).props("flat round dense")
        ui.button(icon="delete", on_click=lambda: confirm_delete(a, on_refresh)).props("flat round dense color=negative")

    # ── Multi-sport navigation ─────────────────────────────────────────────────
    if parent:
        # This is a sub-sport of a triathlon — show back link
        with ui.row().classes("items-center gap-2 q-mb-md"):
            ui.button(
                icon="arrow_back",
                text=f"Back to {parent.get('name', 'Triathlon')}",
                on_click=lambda: ui.navigate.to(f"/activity/{parent['id']}"),
            ).props("flat dense color=primary")

    if children:
        # This is a triathlon parent — show sub-sport buttons
        with ui.card().classes("w-full q-pa-md q-mb-md"):
            ui.label("Sub-activities").classes("text-caption text-grey-6 q-mb-sm")
            with ui.row().classes("gap-2 flex-wrap"):
                for child in children:
                    child_sport = child.get("sport", "other")
                    child_icon = SPORT_ICONS.get(child_sport, "sports")
                    child_color = SPORT_COLORS.get(child_sport, "#6b7280")
                    child_dist = child.get("distance_meters")
                    child_dur = child.get("duration_seconds", 0)
                    label_parts = [child.get("name", child_sport.capitalize())]
                    if child_dist:
                        label_parts.append(f"{child_dist/1000:.2f} km")
                    if child_dur:
                        label_parts.append(format_duration(child_dur))
                    ui.button(
                        text=" · ".join(label_parts),
                        icon=child_icon,
                        on_click=lambda cid=child["id"]: ui.navigate.to(f"/activity/{cid}"),
                    ).props("outline dense").style(f"color: {child_color}; border-color: {child_color}")

    # ── Stats ─────────────────────────────────────────────────────────────────
    with ui.row().classes("flex-wrap gap-3 q-mb-md"):
        if dist:
            _stat_card("Distance", f"{dist/1000:.2f} km", color)
        _stat_card("Duration", format_duration(dur), color)
        if dist and dur:
            _stat_card("Pace", format_pace(dist, dur), color)
        if a.get("avg_heart_rate"):
            _stat_card("Avg HR", f"{a['avg_heart_rate']} bpm", "#ef4444")
        if a.get("max_heart_rate"):
            _stat_card("Max HR", f"{a['max_heart_rate']} bpm", "#ef4444")
        if a.get("elevation_gain_meters"):
            _stat_card("Elevation", f"{a['elevation_gain_meters']:.0f} m", "#10b981")
        if a.get("calories"):
            _stat_card("Calories", f"{a['calories']} kcal", "#f59e0b")
        if a.get("avg_cadence"):
            _stat_card("Cadence", f"{a['avg_cadence']} spm", "#8b5cf6")
        if a.get("avg_power"):
            _stat_card("Power", f"{a['avg_power']} W", "#3b82f6")

    # ── Route map ─────────────────────────────────────────────────────────────
    if a.get("route_json"):
        with ui.card().classes("w-full q-mb-md overflow-hidden").style("padding:0"):
            ui.element("iframe").props(
                f'src="/api/activity/{activity_id}/map" loading="lazy"'
            ).style("width:100%;height:380px;border:none;display:block")

    # ── Notes ─────────────────────────────────────────────────────────────────
    if a.get("notes"):
        with ui.card().classes("w-full q-pa-md q-mb-md"):
            ui.label("Notes").classes("text-caption text-grey-6 q-mb-xs")
            ui.label(a["notes"]).classes("text-body1")

    # ── Laps ──────────────────────────────────────────────────────────────────
    if laps:
        ui.label("Laps").classes("text-h6 text-weight-bold q-mb-sm")
        cols = [
            {"name": "lap", "label": "#", "field": "lap", "align": "left"},
            {"name": "duration", "label": "Time", "field": "duration", "align": "right"},
            {"name": "distance", "label": "Dist", "field": "distance", "align": "right"},
            {"name": "pace", "label": "Pace", "field": "pace", "align": "right"},
            {"name": "hr", "label": "Avg HR", "field": "hr", "align": "right"},
            {"name": "elev", "label": "Elev", "field": "elev", "align": "right"},
        ]
        rows = []
        for lap in laps:
            ld = lap.get("distance_meters")
            lt = lap.get("duration_seconds")
            rows.append({
                "lap": lap["lap_number"],
                "duration": format_duration(lt) if lt else "–",
                "distance": f"{ld/1000:.2f} km" if ld else "–",
                "pace": format_pace(ld, lt) if ld and lt else "–",
                "hr": str(lap["avg_heart_rate"]) if lap.get("avg_heart_rate") else "–",
                "elev": f"{lap['elevation_gain']:.0f} m" if lap.get("elevation_gain") else "–",
            })
        ui.table(columns=cols, rows=rows, row_key="lap").classes("w-full q-mb-md").props("flat bordered dense")

    # ── Best Efforts ──────────────────────────────────────────────────────────
    if best_efforts:
        ui.label("Best Efforts").classes("text-h6 text-weight-bold q-mb-sm")
        with ui.row().classes("flex-wrap gap-3"):
            for be in best_efforts:
                label = DISTANCE_LABELS.get(be["distance_meters"], f"{be['distance_meters']/1000:.1f} km")
                with ui.card().classes("q-pa-sm text-center").style("min-width: 80px"):
                    ui.label(label).classes("text-caption text-grey-6")
                    ui.label(format_duration(be["duration_seconds"])).classes("text-weight-bold text-body1")
                    bd = be.get("distance_meters")
                    bt = be.get("duration_seconds")
                    if bd and bt:
                        ui.label(format_pace(bd, bt)).classes("text-caption text-grey-6")

    # ── Friends ───────────────────────────────────────────────────────────────
    all_friends = await run.io_bound(_db_get_all_friends)

    friends_col = ui.column().classes("w-full")

    async def render_friends() -> None:
        friends_col.clear()
        current = await run.io_bound(_db_get_activity_friends, activity_id)
        current_ids = {f["id"] for f in current}
        available = [f for f in all_friends if f["id"] not in current_ids]

        with friends_col:
            with ui.card().classes("w-full q-pa-md q-mb-md"):
                ui.label("Friends").classes("text-caption text-grey-6 q-mb-sm")
                with ui.row().classes("items-center flex-wrap gap-2"):
                    for f in current:
                        fid = f["id"]

                        async def _remove(fid: int = fid) -> None:
                            await run.io_bound(_db_remove_activity_friend, activity_id, fid)
                            await render_friends()

                        with ui.row().classes(
                            "items-center gap-1 q-px-sm q-py-xs rounded-full"
                        ).style("background: rgba(249,115,22,0.12)"):
                            ui.label(f["name"]).classes("text-body2 text-weight-medium")
                            ui.button(icon="close", on_click=_remove).props(
                                "flat round dense size=xs color=grey-6"
                            )

                if available:
                    sel = ui.select(
                        options={f["id"]: f["name"] for f in available},
                        label="Add friend",
                        clearable=True,
                    ).classes("q-mt-sm").style("min-width: 180px")

                    async def _add() -> None:
                        if sel.value is not None:
                            await run.io_bound(_db_add_activity_friend, activity_id, sel.value)
                            await render_friends()

                    ui.button(icon="person_add", on_click=_add).props("flat dense").classes(
                        "q-mt-sm q-ml-xs"
                    )
                elif not current:
                    ui.label("No friends yet — add some on the Friends page.").classes(
                        "text-caption text-grey-5"
                    )

    await render_friends()
