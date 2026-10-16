"""Garmin Connect sync UI page."""

from datetime import date, timedelta

from nicegui import app as nicegui_app
from nicegui import run, ui
from sqlmodel import Session, col, select

from kinetic import garmin_sync
from kinetic.database import engine
from kinetic.models import Activity
from kinetic.ui_helpers import DATE_MASK, format_date, parse_date_input


def _date_field(label_text: str, value: str) -> ui.input:
    """A dd-mm-yyyy text field with an attached calendar picker."""
    with ui.input(label=label_text, value=value).props(
        "outlined dense style='width:200px'"
    ) as field:
        with ui.menu().props("no-parent-event") as menu:
            with ui.date(mask=DATE_MASK).bind_value(field):
                with ui.row().classes("justify-end"):
                    ui.button("Close", on_click=menu.close).props("flat")
        with field.add_slot("append"):
            ui.icon("edit_calendar").on("click", menu.open).classes("cursor-pointer")
    return field


def _latest_activity_date() -> date | None:
    with Session(engine) as session:
        result = session.exec(select(Activity.date).order_by(col(Activity.date).desc())).first()
        return result.date() if result else None


async def sync_page(refresh_garmin_status=None, set_sync_action=None) -> None:
    # ── Persistent state for MFA handshake ───────────────────────────────────
    _mfa_holder: dict = {}
    _sync_running = [False]
    sync_section_ref = []

    # ── Status card ──────────────────────────────────────────────────────────
    stored_email: str = nicegui_app.storage.general.get("garmin_email", "")

    with ui.card().classes("w-full q-pa-md q-mb-md"):
        with ui.row().classes("items-center gap-3 q-mb-md"):
            ui.label("Garmin Connect").classes("text-h6 text-weight-bold")
            logout_btn = ui.button("Log out", icon="logout", on_click=lambda: _do_logout()).props(
                "flat dense color=negative size=sm"
            )

        def _refresh_status() -> None:
            ok = garmin_sync.tokens_exist()
            login_panel.set_visibility(not ok)
            logout_btn.set_visibility(ok)
            if sync_section_ref:
                sync_section_ref[0].set_visibility(ok)
            if refresh_garmin_status:
                refresh_garmin_status()

        def _do_logout() -> None:
            garmin_sync.logout()
            _refresh_status()
            ui.notify("Logged out — tokens removed", type="info")

        ui.separator().classes("q-my-sm")

        with ui.column().classes("w-full gap-3") as login_panel:
            with ui.row().classes("items-start gap-4 flex-wrap"):
                email_input = ui.input(
                    label="Garmin email",
                    value=stored_email,
                ).props("outlined dense clearable style='width:280px'")
                pw_input = ui.input(
                    label="Password (not stored)", password=True, password_toggle_button=True
                ).props("outlined dense style='width:280px'")

        async def _do_authenticate() -> None:
            email = (email_input.value or "").strip()
            password = pw_input.value
            if not email or not password:
                ui.notify("Email and password are required", type="negative")
                return
            nicegui_app.storage.general["garmin_email"] = email
            auth_btn.props("loading")
            auth_status.text = "Authenticating…"
            try:
                result = await run.io_bound(garmin_sync.attempt_login, email, password)
            except Exception as exc:
                auth_btn.props(remove="loading")
                auth_status.text = ""
                ui.notify(str(exc), type="negative", timeout=8000)
                return
            auth_btn.props(remove="loading")
            if result and result.get("needs_mfa"):
                _mfa_holder["client"] = result["_client"]
                _mfa_holder["state"] = result["_state"]
                auth_status.text = "MFA code required — check your authenticator app"
                mfa_dialog.open()
            else:
                auth_status.text = ""
                _refresh_status()
                ui.notify("Authenticated successfully!", type="positive")

        with login_panel:
            with ui.row().classes("items-center gap-3"):
                auth_btn = ui.button(
                    "Authenticate", icon="login", on_click=_do_authenticate
                ).props("outlined color=primary")
                auth_status = ui.label("").classes("text-caption text-grey-6")

        with ui.column().classes("w-full") as sync_section:
            pass
        sync_section_ref.append(sync_section)

        _refresh_status()

    # ── MFA dialog ───────────────────────────────────────────────────────────
    with ui.dialog() as mfa_dialog, ui.card().classes("q-pa-lg"):
        ui.label("Two-factor Authentication").classes("text-h6 q-mb-sm")
        ui.label(
            "Enter the 6-digit code from your authenticator app or the code sent via email/SMS."
        ).classes("text-body2 text-grey-7 q-mb-md")
        mfa_input = ui.input(label="MFA code", placeholder="123456").props(
            "outlined dense maxlength=8 style='width:200px'"
        )

        async def _submit_mfa() -> None:
            code = (mfa_input.value or "").strip()
            if not code:
                return
            mfa_dialog.close()
            try:
                await run.io_bound(
                    garmin_sync.complete_mfa,
                    _mfa_holder["client"],
                    _mfa_holder["state"],
                    code,
                )
                _refresh_status()
                auth_status.text = ""
                ui.notify("MFA complete — tokens saved!", type="positive")
            except Exception as exc:
                ui.notify(f"MFA failed: {exc}", type="negative", timeout=8000)

        with ui.row().classes("q-mt-md gap-2"):
            ui.button("Cancel", on_click=mfa_dialog.close).props("flat")
            ui.button("Submit", on_click=_submit_mfa).props("color=primary")

        mfa_input.on("keydown.enter", _submit_mfa)

    # ── Sync section ─────────────────────────────────────────────────────────
    with sync_section:
        ui.label("Sync Activities").classes("text-h6 text-weight-bold q-mb-sm")
        ui.separator().classes("q-my-sm")

        latest = await run.io_bound(_latest_activity_date)
        default_since = (
            (latest - timedelta(days=1)) if latest else (date.today() - timedelta(days=90))
        )

        with ui.row().classes("items-center gap-4 q-mb-md flex-wrap"):
            since_input = _date_field("Sync since (dd-mm-yyyy)", format_date(default_since))
            until_input = _date_field("Until (optional, dd-mm-yyyy)", "")

        sync_buttons = []

        def _set_sync_loading(loading: bool) -> None:
            for button in sync_buttons:
                if loading:
                    button.props("loading")
                else:
                    button.props(remove="loading")

        async def _do_sync() -> None:
            if _sync_running[0]:
                ui.notify("Sync already in progress", type="warning")
                return
            if not garmin_sync.tokens_exist():
                email = (email_input.value or "").strip()
                password = pw_input.value
                if not email or not password:
                    ui.notify(
                        "No cached tokens — authenticate first or enter credentials",
                        type="negative",
                    )
                    return
            else:
                email = nicegui_app.storage.general.get("garmin_email", "")
                password = ""

            since_str = (since_input.value or "").strip()
            until_str = (until_input.value or "").strip()
            try:
                since_date = parse_date_input(since_str).date()
                until_date = parse_date_input(until_str).date() if until_str else None
            except ValueError:
                ui.notify("Invalid date — use dd-mm-yyyy", type="negative")
                return

            _sync_running[0] = True
            _set_sync_loading(True)
            result_box.clear()
            progress_col.clear()
            progress_col.set_visibility(True)

            progress_labels: list[ui.label] = []

            def _progress(msg: str) -> None:
                with progress_col:
                    lbl = ui.label(f"› {msg}").classes("text-caption text-grey-7")
                    progress_labels.append(lbl)
                    # Keep the last 50 lines to avoid unbounded growth
                    if len(progress_labels) > 50:
                        progress_labels[0].delete()
                        progress_labels.pop(0)

            try:
                result = await run.io_bound(
                    garmin_sync.sync_garmin_activities,
                    since_date,
                    until_date,
                    email,
                    password,
                    _progress,
                )
            except Exception as exc:
                _set_sync_loading(False)
                _sync_running[0] = False
                ui.notify(str(exc), type="negative", timeout=8000)
                return

            _set_sync_loading(False)
            _sync_running[0] = False

            with result_box:
                _render_result(result or {})

        with ui.row().classes("items-center gap-3"):
            card_sync_button = ui.button("Sync", icon="sync", on_click=_do_sync).props(
                "color=primary"
            )
            sync_buttons.append(card_sync_button)
            if set_sync_action:
                sync_buttons.append(set_sync_action(_do_sync))

        # Progress log
        progress_col = ui.column().classes("w-full gap-0 q-mt-md")
        progress_col.set_visibility(False)

        # Results card
        result_box = ui.element("div").classes("w-full")

    # ── Result renderer (called after sync completes) ─────────────────────────


def _render_result(result: dict) -> None:
    imported = result["imported"]
    skipped = result["skipped"]
    errors: list[str] = result["errors"]

    with ui.column().classes("w-full q-pt-md"):
        ui.label("Sync complete").classes("text-h6 text-weight-bold q-mb-sm")
        with ui.row().classes("gap-6 q-mb-sm"):
            _stat("Imported", str(imported), "text-positive")
            _stat("Skipped", str(skipped), "text-grey-6")
            _stat("Errors", str(len(errors)), "text-negative" if errors else "text-grey-6")

        if errors:
            ui.separator().classes("q-my-sm")
            ui.label("Errors").classes("text-subtitle2 q-mb-xs")
            for err in errors:
                ui.label(f"• {err}").classes("text-caption text-negative")


def _stat(label: str, value: str, value_class: str = "") -> None:
    with ui.column().classes("items-center gap-0"):
        ui.label(value).classes(f"text-h5 text-weight-bold {value_class}")
        ui.label(label).classes("text-caption text-grey-6")
