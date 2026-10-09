"""Activities list page — all data access goes directly through the DB layer."""

from datetime import datetime, timezone
from functools import partial
from pathlib import Path
from typing import Optional

from loguru import logger
from nicegui import events, run, ui
from sqlmodel import col, select

from kinetic.database import engine, require_id
from kinetic.fit_parser import parse_fit_file
from kinetic.models import (
    Activity,
    ActivityFriend,
    ActivityKind,
    BestEffort,
    Friend,
    Lap,
    RaceResult,
    SportType,
)
from kinetic.queries import multisport_parent_sports
from kinetic.ui_helpers import (
    ALL_SPORTS,
    KINDS,
    SPORT_COLORS,
    SPORT_ICONS,
    SPORTS,
    format_date,
    format_datetime,
    format_distance,
    format_duration,
    format_pace,
    multisport_marker,
    parse_date_input,
    resolve_sports,
    sport_filter_options,
    sport_label,
)

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)


# ── Direct DB helpers (sync — run in thread pool via nicegui.run.io_bound) ────


def _db_set_activity_friends(activity_id: int, friend_ids: list[int]) -> None:
    from sqlmodel import Session

    with Session(engine) as session:
        # Collect all activity IDs to update: the activity itself + any children
        child_ids = [
            r.id
            for r in session.exec(select(Activity).where(Activity.parent_id == activity_id)).all()
        ]
        target_ids = [activity_id, *child_ids]

        for tid in target_ids:
            existing = session.exec(
                select(ActivityFriend).where(ActivityFriend.activity_id == tid)
            ).all()
            for link in existing:
                session.delete(link)
            for fid in friend_ids:
                session.add(ActivityFriend(activity_id=tid, friend_id=fid))
        session.commit()


def _db_get_activities(sport: Optional[str], year: Optional[int]) -> list[dict]:
    from sqlmodel import Session

    with Session(engine) as session:
        stmt = select(Activity)
        sports = resolve_sports(sport)
        if sports:
            # With a sport filter: show activities matching those sports (includes triathlon
            # children). Triathlon parents have sport=triathlon so they won't appear under
            # e.g. 'running'.
            stmt = stmt.where(col(Activity.sport).in_([SportType(s) for s in sports]))
        else:
            # No filter: show top-level activities only (no triathlon sub-sport children)
            stmt = stmt.where(Activity.parent_id == None)  # noqa: E711
        if year:
            stmt = stmt.where(col(Activity.date) >= datetime(year, 1, 1))
            stmt = stmt.where(col(Activity.date) < datetime(year + 1, 1, 1))
        stmt = stmt.order_by(col(Activity.date).desc())
        activities = session.exec(stmt).all()

        activity_ids = [a.id for a in activities]
        ids_with_result: set[int] = set()
        if activity_ids:
            ids_with_result = set(
                session.exec(
                    select(RaceResult.activity_id).where(
                        col(RaceResult.activity_id).in_(activity_ids)
                    )
                ).all()
            )

        result = []
        parents = multisport_parent_sports(session, (a.parent_id for a in activities))
        for a in activities:
            d = a.model_dump(mode="json")
            d["has_race_result"] = a.id in ids_with_result
            d["parent_sport"] = parents.get(a.parent_id) if a.parent_id else None
            result.append(d)
        return result


def _db_delete_activity(activity_id: int) -> None:
    from sqlmodel import Session

    with Session(engine) as session:
        activity = session.get(Activity, activity_id)
        if not activity:
            return
        # Delete children first (for triathlon parents)
        children = session.exec(select(Activity).where(Activity.parent_id == activity_id)).all()
        for child in children:
            for lap in session.exec(select(Lap).where(Lap.activity_id == child.id)).all():
                session.delete(lap)
            for be in session.exec(
                select(BestEffort).where(BestEffort.activity_id == child.id)
            ).all():
                session.delete(be)
            session.delete(child)
        for lap in session.exec(select(Lap).where(Lap.activity_id == activity_id)).all():
            session.delete(lap)
        for be in session.exec(
            select(BestEffort).where(BestEffort.activity_id == activity_id)
        ).all():
            session.delete(be)
        session.delete(activity)
        session.commit()


def _db_save_activity(activity_id: Optional[int], data: dict) -> dict:
    from sqlmodel import Session

    with Session(engine) as session:
        if activity_id:
            existing = session.get(Activity, activity_id)
            if existing is None:
                raise ValueError(f"Activity {activity_id} not found")
            activity = existing
            for k, v in data.items():
                setattr(activity, k, v)
            activity.updated_at = datetime.now(timezone.utc)
        else:
            activity = Activity(**data)
        session.add(activity)
        session.commit()
        session.refresh(activity)
        return activity.model_dump(mode="json")


def _db_process_fit(file_bytes: bytes, filename: str) -> dict:
    """Write bytes to disk, parse FIT, save everything to DB. Runs in thread."""
    dest = UPLOAD_DIR / filename
    dest.write_bytes(file_bytes)
    activity, laps, best_efforts, children = parse_fit_file(dest)

    from sqlmodel import Session

    with Session(engine) as session:
        session.add(activity)
        session.commit()
        session.refresh(activity)
        parent_id = require_id(activity.id)
        for lap in laps:
            lap.activity_id = parent_id
            session.add(lap)
        for be in best_efforts:
            be.activity_id = parent_id
            session.add(be)
        # Save multi-sport children
        for child, child_laps, child_bes in children:
            child.parent_id = parent_id
            session.add(child)
            session.commit()
            session.refresh(child)
            child_id = require_id(child.id)
            for lap in child_laps:
                lap.activity_id = child_id
                session.add(lap)
            for be in child_bes:
                be.activity_id = child_id
                session.add(be)
        session.commit()
        session.refresh(activity)
        return activity.model_dump(mode="json")


# ── Activity row card ─────────────────────────────────────────────────────────


def activity_row(a: dict, on_refresh) -> None:
    sport = a.get("sport", "other")
    icon = SPORT_ICONS.get(sport, "sports")
    dist = a.get("distance_meters")
    dur = a.get("duration_seconds", 0)
    aid = a["id"]

    with ui.card().classes("w-full q-pa-sm q-mb-sm hover:shadow-md transition-shadow"):
        with ui.row().classes("items-center no-wrap w-full gap-2"):
            # Clickable info + stats area
            with (
                ui.row()
                .classes("items-center gap-3 flex-1 cursor-pointer")
                .on("click", lambda: ui.navigate.to(f"/activity/{aid}"))
            ):
                ui.icon(icon, size="28px").style(f"color: {SPORT_COLORS.get(sport, '#6b7280')}")
                with ui.column().classes("gap-0"):
                    with ui.row().classes("items-center gap-1"):
                        ui.label(a.get("name", "Activity")).classes("text-weight-medium text-body1")
                        multisport_marker(a.get("parent_sport"))
                        if a.get("has_race_result"):
                            ui.icon("emoji_events", size="14px").classes("text-amber-500")
                    ui.label(
                        f"{format_date(a.get('date'))}  \u2022  "
                        f"{a.get('kind', '').replace('_', ' ').title()}"
                    ).classes("text-caption text-grey-6")

                with ui.row().classes("items-center gap-6 text-right ml-auto"):
                    if dist:
                        with ui.column().classes("gap-0 items-end"):
                            ui.label(format_distance(dist, sport)).classes("text-weight-medium")
                            ui.label("Distance").classes("text-caption text-grey-6")
                    with ui.column().classes("gap-0 items-end"):
                        ui.label(format_duration(dur)).classes("text-weight-medium")
                        ui.label("Duration").classes("text-caption text-grey-6")
                    if dist and dur:
                        with ui.column().classes("gap-0 items-end"):
                            ui.label(format_pace(dist, dur, sport)).classes("text-weight-medium")
                            ui.label("Pace").classes("text-caption text-grey-6")
                    if a.get("avg_heart_rate"):
                        with ui.column().classes("gap-0 items-end"):
                            ui.label(f"{a['avg_heart_rate']} bpm").classes("text-weight-medium")
                            ui.label("Avg HR").classes("text-caption text-grey-6")

            # Edit / delete — outside the clickable row so they don't navigate
            with ui.row().classes("gap-1 shrink-0"):
                ui.button(
                    icon="edit", on_click=partial(show_edit_dialog, a, on_refresh)
                ).props("flat round dense size=sm")
                ui.button(
                    icon="delete", on_click=partial(confirm_delete, a, on_refresh)
                ).props("flat round dense size=sm color=negative")


def confirm_delete(activity: dict, on_refresh) -> None:
    with ui.dialog() as dialog, ui.card().classes("q-pa-md"):
        ui.label(f"Delete '{activity['name']}'?").classes("text-h6")
        ui.label("This action cannot be undone.").classes("text-grey-6")
        with ui.row().classes("justify-end gap-2 q-mt-md"):
            ui.button("Cancel", on_click=dialog.close).props("flat")

            async def do_delete():
                await run.io_bound(_db_delete_activity, activity["id"])
                dialog.close()
                await on_refresh()

            ui.button("Delete", on_click=do_delete).props("color=negative")
    dialog.open()


def show_edit_dialog(activity: Optional[dict], on_refresh) -> None:
    is_edit = activity is not None
    data = activity or {}
    existing_id = data.get("id") if is_edit else None

    with (
        ui.dialog() as dialog,
        ui.card().classes("q-pa-md").style("min-width: 480px; max-width: 600px"),
    ):
        ui.label("Edit Activity" if is_edit else "Add Activity Manually").classes("text-h6 q-mb-md")

        name = ui.input("Name", value=data.get("name", "")).classes("w-full")
        date_val = format_datetime(data.get("date") or datetime.now())
        date_input = ui.input("Date & Time (dd-mm-yyyy HH:MM)", value=date_val).classes("w-full")

        with ui.row().classes("w-full gap-3"):
            sport_sel = ui.select(
                {s: sport_label(s) for s in SPORTS},
                label="Sport",
                value=data.get("sport", "running"),
            ).classes("flex-1")
            kind_sel = ui.select(KINDS, label="Kind", value=data.get("kind", "training")).classes(
                "flex-1"
            )

        with ui.row().classes("w-full gap-3"):
            duration = ui.number(
                "Duration (seconds)", value=data.get("duration_seconds", 0), min=0
            ).classes("flex-1")
            distance = ui.number(
                "Distance (meters)", value=data.get("distance_meters") or 0, min=0
            ).classes("flex-1")

        with ui.row().classes("w-full gap-3"):
            avg_hr = ui.number(
                "Avg HR (bpm)", value=data.get("avg_heart_rate") or 0, min=0
            ).classes("flex-1")
            calories_inp = ui.number("Calories", value=data.get("calories") or 0, min=0).classes(
                "flex-1"
            )

        with ui.row().classes("w-full gap-3"):
            elev = ui.number(
                "Elevation gain (m)", value=data.get("elevation_gain_meters") or 0, min=0
            ).classes("flex-1")
            avg_speed = ui.number(
                "Avg speed (m/s)", value=data.get("avg_speed_ms") or 0, min=0, step=0.1
            ).classes("flex-1")

        notes = ui.textarea("Notes", value=data.get("notes") or "").classes("w-full")

        # ── Friends ───────────────────────────────────────────────────────────
        from sqlmodel import Session

        with Session(engine) as session:
            all_friends = session.exec(select(Friend)).all()
        friend_options = {f.id: f.name for f in all_friends}
        if is_edit and all_friends:
            with Session(engine) as session:
                current_friend_ids = [
                    link.friend_id
                    for link in session.exec(
                        select(ActivityFriend).where(ActivityFriend.activity_id == data["id"])
                    ).all()
                ]
        else:
            current_friend_ids = []
        friends_sel = (
            ui.select(
                options=friend_options,
                label="Friends",
                multiple=True,
                value=current_friend_ids,
                clearable=True,
            ).classes("w-full")
            if all_friends
            else None
        )

        with ui.row().classes("justify-end gap-2 q-mt-md"):
            ui.button("Cancel", on_click=dialog.close).props("flat")

            async def do_save():
                try:
                    activity_date = parse_date_input(date_input.value)
                except ValueError:
                    ui.notify("Invalid date — use dd-mm-yyyy HH:MM", type="negative")
                    return
                payload = {
                    "name": name.value,
                    "sport": SportType(sport_sel.value),
                    "kind": ActivityKind(kind_sel.value),
                    "date": activity_date,
                    "duration_seconds": float(duration.value or 0),
                    "distance_meters": float(distance.value) if distance.value else None,
                    "avg_heart_rate": int(avg_hr.value) if avg_hr.value else None,
                    "calories": int(calories_inp.value) if calories_inp.value else None,
                    "elevation_gain_meters": float(elev.value) if elev.value else None,
                    "avg_speed_ms": float(avg_speed.value) if avg_speed.value else None,
                    "notes": notes.value or None,
                }
                try:
                    saved = await run.io_bound(
                        _db_save_activity,
                        existing_id,
                        payload,
                    )
                    if friends_sel is not None:
                        fids = friends_sel.value or []
                        if not isinstance(fids, list):
                            fids = [fids]
                        target_id = (saved or {}).get("id")
                        if target_id:
                            await run.io_bound(_db_set_activity_friends, target_id, fids)
                    ui.notify("Saved!", type="positive")
                    dialog.close()
                    await on_refresh()
                except Exception as exc:
                    logger.exception("Save failed")
                    ui.notify(f"Failed to save: {exc}", type="negative")

            ui.button("Save", on_click=do_save).props("color=primary")
    dialog.open()


# ── Upload dialog ─────────────────────────────────────────────────────────────


def show_upload_dialog(on_refresh) -> None:
    counts = {"ok": 0, "err": 0, "pending": 0}

    with ui.dialog() as dialog, ui.card().classes("q-pa-lg").style("min-width: 520px"):
        ui.label("Upload .fit files").classes("text-h6 q-mb-xs")
        ui.label(
            "Select one or more Garmin .fit files. Each is imported as soon as it is selected."
        ).classes("text-body2 text-grey-6 q-mb-md")

        with ui.row().classes("items-center gap-2 q-mb-sm"):
            spinner = ui.spinner(size="sm")
            spinner.set_visibility(False)
            status_lbl = ui.label("").classes("text-body2")

        def _refresh_status():
            if counts["pending"] > 0:
                spinner.set_visibility(True)
                status_lbl.set_text(f"Processing… ({counts['pending']} remaining)")
            else:
                spinner.set_visibility(False)
                parts = []
                if counts["ok"]:
                    parts.append(f"{counts['ok']} imported")
                if counts["err"]:
                    parts.append(f"{counts['err']} failed")
                status_lbl.set_text(", ".join(parts))

        async def handle_upload(e: events.UploadEventArguments):
            counts["pending"] += 1
            done_btn.disable()
            _refresh_status()
            try:
                file_bytes = await e.file.read()
                await run.io_bound(_db_process_fit, file_bytes, e.file.name)
                counts["ok"] += 1
            except Exception:
                logger.exception("FIT upload failed")
                counts["err"] += 1
            finally:
                counts["pending"] -= 1
                _refresh_status()
                if counts["pending"] == 0:
                    done_btn.enable()

        async def close_and_refresh():
            dialog.close()
            await on_refresh()

        ui.upload(
            on_upload=handle_upload,
            auto_upload=True,
            multiple=True,
        ).props("accept=.fit label='Drop files here or click to browse'").classes("w-full q-mb-md")

        with ui.row().classes("justify-end"):
            done_btn = ui.button("Done", on_click=close_and_refresh).props("color=primary")

    dialog.open()


# ── Main page ─────────────────────────────────────────────────────────────────


async def activities_page() -> None:
    sport_filter: dict[str, Optional[str]] = {"value": None}
    year_filter: dict[str, Optional[int]] = {"value": None}

    async def refresh():
        list_container.clear()
        activities = await run.io_bound(
            _db_get_activities, sport_filter["value"], year_filter["value"]
        )
        with list_container:
            if not activities:
                ui.label("No activities yet. Upload a .fit file or add one manually.").classes(
                    "text-grey-6 q-mt-lg text-center w-full"
                )
                return
            for a in activities:
                activity_row(a, refresh)

    # ── toolbar ──
    with ui.row().classes("items-center justify-between w-full q-mb-md flex-wrap gap-3"):
        ui.label("Activities").classes("text-h5 text-weight-bold")

        with ui.row().classes("items-center gap-2"):
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

            ui.button(
                "Upload .fit",
                icon="upload_file",
                on_click=lambda: show_upload_dialog(refresh),
            ).props("outline dense")

            ui.button(
                "Add Manual",
                icon="add",
                on_click=lambda: show_edit_dialog(None, refresh),
            ).props("color=primary dense")

    list_container = ui.column().classes("w-full gap-0")
    await refresh()
