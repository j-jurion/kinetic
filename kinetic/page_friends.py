"""Friends page."""
from nicegui import run, ui
from sqlmodel import Session, select

from kinetic.database import engine
from kinetic.models import Friend


def _db_get_friends() -> list[dict]:
    with Session(engine) as session:
        return [f.model_dump() for f in session.exec(select(Friend)).all()]


def _db_delete_friend(friend_id: int) -> None:
    with Session(engine) as session:
        friend = session.get(Friend, friend_id)
        if friend:
            session.delete(friend)
            session.commit()


def _db_create_friend(name: str) -> dict:
    with Session(engine) as session:
        friend = Friend(name=name)
        session.add(friend)
        session.commit()
        session.refresh(friend)
        return friend.model_dump()


async def friends_page() -> None:
    def show_add_dialog():
        with ui.dialog() as dialog, ui.card().classes("q-pa-md").style("min-width: 380px"):
            ui.label("Add Friend").classes("text-h6 q-mb-md")
            name_input = ui.input("Name").classes("w-full")

            with ui.row().classes("justify-end gap-2 q-mt-md"):
                ui.button("Cancel", on_click=dialog.close).props("flat")

                async def do_add():
                    if not name_input.value:
                        ui.notify("Name is required", type="warning")
                        return
                    try:
                        await run.io_bound(_db_create_friend, name_input.value)
                        ui.notify("Friend added!", type="positive")
                        dialog.close()
                        await refresh()
                    except Exception:
                        ui.notify("Failed to add friend", type="negative")

                ui.button("Add", on_click=do_add).props("color=primary")
        dialog.open()

    with ui.row().classes("items-center justify-between w-full q-mb-md"):
        ui.label("Friends").classes("text-h5 text-weight-bold")
        ui.button("+ Add Friend", icon="person_add", on_click=show_add_dialog).props("color=primary dense")

    list_col = ui.column().classes("w-full gap-3")

    async def refresh():
        list_col.clear()
        friends = await run.io_bound(_db_get_friends)
        with list_col:
            if not friends:
                ui.label("No friends added yet.").classes("text-grey-6 q-mt-lg")
                return
            for f in friends:
                with ui.card().classes("w-full q-pa-sm"):
                    with ui.row().classes("items-center justify-between w-full"):
                        with ui.row().classes("items-center gap-3"):
                            ui.avatar(f["name"][0].upper(), color="primary", text_color="white")
                            ui.label(f["name"]).classes("text-weight-medium text-body1")

                        async def do_delete(fid=f["id"]):
                            await run.io_bound(_db_delete_friend, fid)
                            await refresh()

                        ui.button(icon="delete", on_click=do_delete).props("flat round dense size=sm color=negative")

    await refresh()
