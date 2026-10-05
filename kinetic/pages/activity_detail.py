"""Activity detail page."""

from nicegui import run, ui
from sqlmodel import Session, col, select

from kinetic.database import engine, require_id
from kinetic.models import (
    Activity,
    ActivityFriend,
    BestEffort,
    Friend,
    Lap,
    RaceResult,
    RaceResultSplit,
)
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
            select(Lap).where(Lap.activity_id == activity_id).order_by(col(Lap.lap_number))
        ).all()
        best_efforts = session.exec(
            select(BestEffort)
            .where(BestEffort.activity_id == activity_id)
            .order_by(col(BestEffort.distance_meters))
        ).all()
        # Multi-sport: fetch children (if parent) or siblings + parent (if child)
        children: list[dict] = []
        parent: dict | None = None
        if activity.parent_id is None:
            # Could be a triathlon parent — fetch children ordered by date
            raw_children = session.exec(
                select(Activity)
                .where(Activity.parent_id == activity_id)
                .order_by(col(Activity.date))
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
            .join(ActivityFriend, col(ActivityFriend.friend_id) == Friend.id)
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


# ── Race result DB helpers ─────────────────────────────────────────────────────


def _db_get_race_result(activity_id: int) -> dict | None:
    with Session(engine) as session:
        result = session.exec(
            select(RaceResult).where(RaceResult.activity_id == activity_id)
        ).first()
        if not result:
            return None
        splits = session.exec(
            select(RaceResultSplit)
            .where(RaceResultSplit.race_result_id == result.id)
            .order_by(col(RaceResultSplit.order))
        ).all()
        return {
            **result.model_dump(mode="json"),
            "splits": [s.model_dump(mode="json") for s in splits],
        }


def _db_save_race_result(activity_id: int, data: dict, splits: list[dict]) -> None:
    with Session(engine) as session:
        existing = session.exec(
            select(RaceResult).where(RaceResult.activity_id == activity_id)
        ).first()
        if existing:
            for k, v in data.items():
                setattr(existing, k, v)
            session.add(existing)
        else:
            existing = RaceResult(activity_id=activity_id, **data)
            session.add(existing)
        session.commit()
        session.refresh(existing)
        result_id = require_id(existing.id)

        for s in session.exec(
            select(RaceResultSplit).where(RaceResultSplit.race_result_id == result_id)
        ).all():
            session.delete(s)

        for i, split in enumerate(splits):
            session.add(
                RaceResultSplit(
                    race_result_id=result_id,
                    label=split["label"],
                    order=i,
                    duration_seconds=split.get("duration_seconds"),
                    rank=split.get("rank"),
                )
            )
        session.commit()


def _db_delete_race_result(activity_id: int) -> None:
    with Session(engine) as session:
        result = session.exec(
            select(RaceResult).where(RaceResult.activity_id == activity_id)
        ).first()
        if result:
            for s in session.exec(
                select(RaceResultSplit).where(RaceResultSplit.race_result_id == result.id)
            ).all():
                session.delete(s)
            session.delete(result)
            session.commit()


# ── Race result UI helpers ────────────────────────────────────────────────────


def _format_time_input(seconds: float | None) -> str:
    if not seconds:
        return ""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def _parse_time_input(s: str) -> float | None:
    if not (s := s.strip()):
        return None
    parts = s.split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
        return float(parts[0])
    except (ValueError, IndexError):
        return None


def _ordinal(n: int) -> str:
    suffix = "th"
    if n % 100 not in (11, 12, 13):
        if n % 10 == 1:
            suffix = "st"
        elif n % 10 == 2:
            suffix = "nd"
        elif n % 10 == 3:
            suffix = "rd"
    return f"{n}{suffix}"


def _show_race_result_dialog(
    activity_id: int,
    sport: str,
    existing: dict | None,
    on_save,
) -> None:
    from dataclasses import dataclass

    @dataclass
    class SplitRow:
        label: str = ""
        time_str: str = ""
        rank_str: str = ""

    rr = existing or {}
    existing_splits = rr.get("splits", [])

    if existing_splits:
        splits_data = [
            SplitRow(
                label=s["label"],
                time_str=_format_time_input(s.get("duration_seconds")),
                rank_str=str(s["rank"]) if s.get("rank") else "",
            )
            for s in existing_splits
        ]
    else:
        _defaults: dict[str, list[str]] = {
            "triathlon": ["Swim", "T1", "Bike", "T2", "Run"],
            "duathlon": ["Run 1", "T1", "Bike", "T2", "Run 2"],
        }
        splits_data = [SplitRow(label=lbl) for lbl in _defaults.get(sport, [])]

    with (
        ui.dialog() as dialog,
        ui.card()
        .classes("q-pa-md")
        .style("min-width: 520px; max-width: 680px; max-height: 90vh; overflow-y: auto"),
    ):
        ui.label("Race Results").classes("text-h6 q-mb-md")

        with ui.row().classes("gap-3 w-full items-start"):
            official_time = ui.input(
                "Official time",
                value=_format_time_input(rr.get("official_time_seconds")),
                placeholder="H:MM:SS",
            ).style("flex: 1 1 150px")
            bib = ui.input("Bib #", value=rr.get("bib_number") or "").style("width: 80px")
            age_group = ui.input(
                "Age group", value=rr.get("age_group") or "", placeholder="M40-44"
            ).style("width: 110px")

        ui.label("Rankings").classes("text-caption text-grey-6 q-mt-md q-mb-xs")
        with ui.grid(columns=3).classes("gap-x-4 gap-y-1 items-center"):
            ui.label("")
            ui.label("Rank").classes("text-caption text-grey-6 text-center")
            ui.label("Total").classes("text-caption text-grey-6 text-center")

            ui.label("Overall").classes("text-body2")
            overall_rank = ui.number(value=rr.get("overall_rank"), min=1, precision=0).style(
                "max-width: 80px"
            )
            overall_total = ui.number(value=rr.get("overall_total"), min=1, precision=0).style(
                "max-width: 80px"
            )

            ui.label("Gender").classes("text-body2")
            gender_rank = ui.number(value=rr.get("gender_rank"), min=1, precision=0).style(
                "max-width: 80px"
            )
            gender_total = ui.number(value=rr.get("gender_total"), min=1, precision=0).style(
                "max-width: 80px"
            )

            ui.label("Age group").classes("text-body2")
            ag_rank = ui.number(value=rr.get("age_group_rank"), min=1, precision=0).style(
                "max-width: 80px"
            )
            ag_total = ui.number(value=rr.get("age_group_total"), min=1, precision=0).style(
                "max-width: 80px"
            )

        ui.label("Splits").classes("text-caption text-grey-6 q-mt-md q-mb-xs")
        with ui.row().classes("gap-2 q-mb-xs"):
            ui.label("Label").classes("text-caption text-grey-5").style("width: 80px")
            ui.label("Time (M:SS)").classes("text-caption text-grey-5").style("width: 110px")
            ui.label("Rank").classes("text-caption text-grey-5").style("width: 65px")

        @ui.refreshable
        def splits_ui() -> None:
            for i, row in enumerate(splits_data):
                with ui.row().classes("items-center gap-2 q-mb-xs"):
                    ui.input().bind_value(row, "label").props("dense").style("width: 80px")
                    ui.input().bind_value(row, "time_str").props("dense").style("width: 110px")
                    ui.input().bind_value(row, "rank_str").props("dense").style("width: 65px")

                    def remove(i: int = i) -> None:
                        splits_data.pop(i)
                        splits_ui.refresh()

                    ui.button(icon="close", on_click=remove).props(
                        "flat round dense size=xs color=grey-6"
                    )

        splits_ui()
        ui.button(
            "+ Add split", on_click=lambda: [splits_data.append(SplitRow()), splits_ui.refresh()]
        ).props("flat dense size=sm color=primary").classes("q-mt-xs")

        results_url_input = ui.input(
            "Results URL", value=rr.get("results_url") or "", placeholder="https://..."
        ).classes("w-full q-mt-md")
        notes_input = ui.textarea("Notes", value=rr.get("notes") or "").classes("w-full")

        with ui.row().classes("justify-end gap-2 q-mt-md"):
            ui.button("Cancel", on_click=dialog.close).props("flat")

            async def save() -> None:
                def to_int(v) -> int | None:
                    return int(v) if v is not None else None

                data = {
                    "official_time_seconds": _parse_time_input(official_time.value or ""),
                    "bib_number": bib.value or None,
                    "age_group": age_group.value or None,
                    "overall_rank": to_int(overall_rank.value),
                    "overall_total": to_int(overall_total.value),
                    "gender_rank": to_int(gender_rank.value),
                    "gender_total": to_int(gender_total.value),
                    "age_group_rank": to_int(ag_rank.value),
                    "age_group_total": to_int(ag_total.value),
                    "results_url": results_url_input.value or None,
                    "notes": notes_input.value or None,
                }
                split_dicts = [
                    {
                        "label": row.label,
                        "duration_seconds": _parse_time_input(row.time_str),
                        "rank": int(row.rank_str) if row.rank_str.strip().isdigit() else None,
                    }
                    for row in splits_data
                    if row.label.strip()
                ]
                await run.io_bound(_db_save_race_result, activity_id, data, split_dicts)
                dialog.close()
                await on_save()

            ui.button("Save", on_click=save).props("color=primary")

    dialog.open()


def _render_race_results_card(
    activity_id: int,
    activity: dict,
    race_result: dict | None,
    on_refresh,
) -> None:
    sport = activity.get("sport", "other")
    kind = activity.get("kind", "other")
    gps_dur = activity.get("duration_seconds", 0)

    if race_result is None and kind != "race":
        return

    with ui.card().classes("w-full q-pa-md q-mb-md"):
        with ui.row().classes("items-center justify-between q-mb-sm"):
            with ui.row().classes("items-center gap-2"):
                ui.icon("emoji_events", size="20px").classes("text-amber-500")
                ui.label("Race Results").classes("text-weight-bold")
            with ui.row().classes("gap-1"):
                if race_result:
                    ui.button(
                        icon="edit",
                        on_click=lambda: _show_race_result_dialog(
                            activity_id, sport, race_result, on_refresh
                        ),
                    ).props("flat round dense size=sm")

                    async def do_delete() -> None:
                        await run.io_bound(_db_delete_race_result, activity_id)
                        await on_refresh()

                    ui.button(icon="delete", on_click=do_delete).props(
                        "flat round dense size=sm color=negative"
                    )
                else:
                    ui.button(
                        "Add race results",
                        icon="add",
                        on_click=lambda: _show_race_result_dialog(
                            activity_id, sport, None, on_refresh
                        ),
                    ).props("flat dense size=sm color=primary")

        if race_result is None:
            ui.label("No official results recorded yet.").classes("text-caption text-grey-5")
            return

        rr = race_result

        # Time + bib + age group
        official_t = rr.get("official_time_seconds")
        with ui.row().classes("items-center gap-4 q-mb-sm flex-wrap"):
            if official_t:
                with ui.row().classes("items-center gap-1"):
                    ui.icon("timer", size="16px").classes("text-grey-6")
                    ui.label(f"Official: {format_duration(official_t)}").classes(
                        "text-weight-medium"
                    )
                    if gps_dur and abs(gps_dur - official_t) > 5:
                        delta = int(abs(official_t - gps_dur))
                        label = "faster" if official_t < gps_dur else "slower"
                        ui.label(
                            f"(GPS {format_duration(gps_dur)}, {format_duration(delta)} {label})"
                        ).classes("text-caption text-grey-6")
            if rr.get("bib_number"):
                with ui.row().classes("items-center gap-1"):
                    ui.icon("confirmation_number", size="16px").classes("text-grey-6")
                    ui.label(f"#{rr['bib_number']}").classes("text-body2")
            if rr.get("age_group"):
                with ui.row().classes("items-center gap-1"):
                    ui.icon("group", size="16px").classes("text-grey-6")
                    ui.label(rr["age_group"]).classes("text-body2")

        # Rank mini-cards
        rank_items: list[tuple[str, int, int | None]] = []
        if rr.get("overall_rank"):
            rank_items.append(("Overall", rr["overall_rank"], rr.get("overall_total")))
        if rr.get("gender_rank"):
            rank_items.append(("Gender", rr["gender_rank"], rr.get("gender_total")))
        if rr.get("age_group_rank"):
            label = rr.get("age_group") or "Age group"
            rank_items.append((label, rr["age_group_rank"], rr.get("age_group_total")))

        if rank_items:
            with ui.row().classes("gap-3 q-mb-sm flex-wrap"):
                for label, rank, total in rank_items:
                    with ui.card().classes("q-pa-sm text-center").style("min-width: 90px"):
                        ui.label(_ordinal(rank)).classes("text-h6 text-weight-bold text-amber-600")
                        if total:
                            pct = rank / total * 100
                            ui.label(f"/ {total}  ({pct:.0f}%)").classes("text-caption text-grey-6")
                        ui.label(label).classes("text-caption text-grey-6")

        # Splits
        splits = rr.get("splits", [])
        if splits:
            ui.label("Splits").classes("text-caption text-grey-6 q-mt-xs q-mb-xs")
            with ui.row().classes("gap-2 flex-wrap"):
                for split in splits:
                    with ui.card().classes("q-pa-sm text-center").style("min-width: 70px"):
                        ui.label(split["label"]).classes("text-caption text-grey-6")
                        dt = split.get("duration_seconds")
                        ui.label(format_duration(dt) if dt else "–").classes(
                            "text-weight-medium text-body2"
                        )
                        if split.get("rank"):
                            ui.label(_ordinal(split["rank"])).classes("text-caption text-amber-600")

        # Footer: link + notes
        if rr.get("results_url") or rr.get("notes"):
            with ui.column().classes("gap-0 q-mt-sm"):
                if rr.get("results_url"):
                    with ui.row().classes("items-center gap-1"):
                        ui.icon("link", size="16px").classes("text-grey-6")
                        ui.link("Official results", rr["results_url"], new_tab=True).classes(
                            "text-body2 text-primary"
                        )
                if rr.get("notes"):
                    ui.label(rr["notes"]).classes("text-caption text-grey-6 q-mt-xs")


def _stat_card(label: str, value: str, color: str = "#f97316") -> None:
    with ui.card().classes("q-pa-md text-center").style("min-width: 96px"):
        ui.label(value).classes("text-h6 text-weight-bold").style(f"color: {color}")
        ui.label(label).classes("text-caption text-grey-6")


async def activity_detail_page(activity_id: int) -> None:
    from kinetic.pages.activities import confirm_delete, show_edit_dialog

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
                f"{a.get('date', '')[:10]}  \u2022  "
                f"{a.get('kind', '').replace('_', ' ').title()}  \u2022  {sport.title()}"
            ).classes("text-caption text-grey-6")
        ui.button(icon="edit", on_click=lambda: show_edit_dialog(a, on_refresh)).props(
            "flat round dense"
        )
        ui.button(icon="delete", on_click=lambda: confirm_delete(a, on_refresh)).props(
            "flat round dense color=negative"
        )

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
                        label_parts.append(f"{child_dist / 1000:.2f} km")
                    if child_dur:
                        label_parts.append(format_duration(child_dur))
                    ui.button(
                        text=" · ".join(label_parts),
                        icon=child_icon,
                        on_click=lambda cid=child["id"]: ui.navigate.to(f"/activity/{cid}"),
                    ).props("outline dense").style(
                        f"color: {child_color}; border-color: {child_color}"
                    )

    # ── Stats ─────────────────────────────────────────────────────────────────
    with ui.row().classes("flex-wrap gap-3 q-mb-md"):
        if dist:
            _stat_card("Distance", f"{dist / 1000:.2f} km", color)
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

    # ── Race Results ──────────────────────────────────────────────────────────
    results_container = ui.column().classes("w-full")

    async def render_race_results() -> None:
        results_container.clear()
        rr = await run.io_bound(_db_get_race_result, activity_id)
        with results_container:
            _render_race_results_card(activity_id, a, rr, render_race_results)

    await render_race_results()

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
            rows.append(
                {
                    "lap": lap["lap_number"],
                    "duration": format_duration(lt) if lt else "–",
                    "distance": f"{ld / 1000:.2f} km" if ld else "–",
                    "pace": format_pace(ld, lt) if ld and lt else "–",
                    "hr": str(lap["avg_heart_rate"]) if lap.get("avg_heart_rate") else "–",
                    "elev": f"{lap['elevation_gain']:.0f} m" if lap.get("elevation_gain") else "–",
                }
            )
        ui.table(columns=cols, rows=rows, row_key="lap").classes("w-full q-mb-md").props(
            "flat bordered dense"
        )

    # ── Best Efforts ──────────────────────────────────────────────────────────
    if best_efforts:
        ui.label("Best Efforts").classes("text-h6 text-weight-bold q-mb-sm")
        with ui.row().classes("flex-wrap gap-3"):
            for be in best_efforts:
                label = DISTANCE_LABELS.get(
                    be["distance_meters"], f"{be['distance_meters'] / 1000:.1f} km"
                )
                with ui.card().classes("q-pa-sm text-center").style("min-width: 80px"):
                    ui.label(label).classes("text-caption text-grey-6")
                    ui.label(format_duration(be["duration_seconds"])).classes(
                        "text-weight-bold text-body1"
                    )
                    bd = be.get("distance_meters")
                    bt = be.get("duration_seconds")
                    if bd and bt:
                        ui.label(format_pace(bd, bt)).classes("text-caption text-grey-6")

    # ── Friends ───────────────────────────────────────────────────────────────
    all_friends = await run.io_bound(_db_get_all_friends) or []

    friends_col = ui.column().classes("w-full")

    async def render_friends() -> None:
        friends_col.clear()
        current = await run.io_bound(_db_get_activity_friends, activity_id) or []
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

                        with (
                            ui.row()
                            .classes("items-center gap-1 q-px-sm q-py-xs rounded-full")
                            .style("background: rgba(249,115,22,0.12)")
                        ):
                            ui.label(f["name"]).classes("text-body2 text-weight-medium")
                            ui.button(icon="close", on_click=_remove).props(
                                "flat round dense size=xs color=grey-6"
                            )

                if available:
                    sel = (
                        ui.select(
                            options={f["id"]: f["name"] for f in available},
                            label="Add friend",
                            clearable=True,
                        )
                        .classes("q-mt-sm")
                        .style("min-width: 180px")
                    )

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
