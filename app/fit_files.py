"""Removing FIT files, and their cached streams, once no activity refers to them any more."""

from collections.abc import Iterable
from pathlib import Path

from loguru import logger
from sqlalchemy import text

from app import streams
from app.database import engine


def _still_used(conn, path: Path) -> bool:
    """Whether any activity, of any account, still refers to the file.

    The legs of a multisport event share the event's file, and a copied test account can
    refer to the same files as the original.
    """
    pattern = "%" + path.name.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    rows = conn.execute(
        text("SELECT fit_file_path FROM activity WHERE fit_file_path LIKE :pattern ESCAPE '\\'"),
        {"pattern": pattern},
    ).scalars()
    return any(streams.fit_path_for(stored) == path for stored in rows)


def remove_unreferenced(paths: Iterable[Path]) -> list[Path]:
    """Delete each FIT file (resolved in the uploads folder) that nothing refers to, with its
    cached streams. Call it after the activities are deleted; returns the files removed."""
    removed = []
    with engine.connect() as conn:
        for path in {p.resolve() for p in paths}:
            if _still_used(conn, path):
                continue
            for cached in streams.streams_cache_files(path):
                _unlink(cached)
            if _unlink(path):
                removed.append(path)
    return removed


def _unlink(path: Path) -> bool:
    try:
        path.unlink(missing_ok=True)
        return True
    except OSError as exc:
        logger.warning("Could not delete {}: {}", path.name, exc)
        return False
