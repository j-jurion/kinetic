"""Database helpers shared by several pages."""

from collections.abc import Iterable
from typing import Optional

from sqlmodel import Session, col, select

from kinetic.models import Activity


def multisport_parent_sports(
    session: Session, parent_ids: Iterable[Optional[int]]
) -> dict[int, str]:
    """Map multisport parent id → its sport, used to label the legs of an event."""
    ids = {parent_id for parent_id in parent_ids if parent_id}
    if not ids:
        return {}
    parents = session.exec(select(Activity).where(col(Activity.id).in_(ids))).all()
    return {parent.id: parent.sport.value for parent in parents if parent.id is not None}
