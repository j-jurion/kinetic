"""One-off maintenance on existing data, for every account. Shows what it would change; add
``--apply`` to change it.

    python -m app.maintenance recalc-multisport [--apply]
        Re-read the FIT file of every multisport event and update the event's duration and
        its legs' durations, routes and best efforts where the current parser differs. Events
        imported before multisport files used elapsed time kept a swim the watch auto-paused
        at its timer time (a minute instead of twenty).

    python -m app.maintenance clean-uploads [--apply]
        Delete FIT files no activity refers to (left by activities deleted before deleting an
        activity removed its file), cached streams whose FIT file is gone, and unfinished
        temporary files.

On Fly: fly ssh console -a <app> -C "python -m app.maintenance clean-uploads"
"""

import argparse
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from sqlmodel import Session, col, select

from app import streams
from app.database import engine
from app.fit_parser import parse_fit_file
from app.models import Activity, ActivityMetrics, BestEffort, SportType
from app.ownership import current_owner

MULTISPORT = (SportType.triathlon, SportType.duathlon, SportType.multisport)
# A leg in the file and in the database are the same leg when they start this close together
_SAME_START_SECONDS = 5
# Durations closer than this are the same (rounding)
_SAME_DURATION_SECONDS = 1
# An import writes its FIT file just before it saves the activity: leave recent files alone
RECENT_SECONDS = 60 * 60


# ── Multisport events ─────────────────────────────────────────────────────────


@dataclass
class EventReport:
    event_id: int
    name: str
    changes: list[str] = field(default_factory=list)
    skipped: str = ""


def _same_start(a: datetime, b: datetime) -> bool:
    return abs((a - b).total_seconds()) <= _SAME_START_SECONDS


def _recalculate_event(session: Session, event: Activity, apply: bool) -> EventReport:
    report = EventReport(event.id, event.name)
    path = streams.fit_path_for(event.fit_file_path)
    if path is None:
        report.skipped = "its FIT file is not on the server"
        return report
    try:
        parsed, _, _, parsed_legs = parse_fit_file(path)
    except Exception as exc:
        report.skipped = f"its FIT file could not be read ({type(exc).__name__})"
        return report

    legs = session.exec(
        select(Activity).where(Activity.parent_id == event.id).order_by(col(Activity.date))
    ).all()
    parsed_legs = sorted(parsed_legs, key=lambda item: item[0].date)
    if len(legs) != len(parsed_legs) or not all(
        leg.sport == new.sport and _same_start(leg.date, new.date)
        for leg, (new, *_) in zip(legs, parsed_legs)
    ):
        report.skipped = "its legs do not match the file one to one"
        return report

    changed: list[Activity] = []
    if abs(event.duration_seconds - parsed.duration_seconds) > _SAME_DURATION_SECONDS:
        report.changes.append(
            f"event {_clock(event.duration_seconds)} -> {_clock(parsed.duration_seconds)}"
        )
        if apply:
            event.duration_seconds = parsed.duration_seconds
        changed.append(event)

    for leg, (new, _laps, new_efforts, *_rest) in zip(legs, parsed_legs):
        duration_changed = abs(leg.duration_seconds - new.duration_seconds) > _SAME_DURATION_SECONDS
        route_changed = (leg.route_json or None) != (new.route_json or None)
        if not duration_changed and not route_changed:
            continue
        parts = []
        if duration_changed:
            parts.append(f"{_clock(leg.duration_seconds)} -> {_clock(new.duration_seconds)}")
        if route_changed:
            parts.append("route")
        report.changes.append(f"{leg.sport.value} leg: {', '.join(parts)}")
        changed.append(leg)
        if not apply:
            continue
        leg.duration_seconds = new.duration_seconds
        leg.route_json = new.route_json
        for effort in session.exec(select(BestEffort).where(BestEffort.activity_id == leg.id)):
            session.delete(effort)
        for effort in new_efforts:
            effort.activity_id = leg.id
            session.add(effort)

    if apply and changed:
        # The training metrics of these activities are computed again below
        for activity in changed:
            metrics = session.get(ActivityMetrics, activity.id)
            if metrics is not None:
                session.delete(metrics)
        session.commit()
        _store_metrics(event.owner_id, [a.id for a in changed])
    return report


def _store_metrics(owner_id: str | None, activity_ids: list[int]) -> None:
    if not owner_id:
        return
    from app import metrics

    token = current_owner.set(owner_id)
    try:
        metrics.store_quietly(activity_ids)
    finally:
        current_owner.reset(token)


def recalc_multisport(apply: bool = False) -> list[EventReport]:
    """Compare every multisport event with its FIT file; with ``apply``, update it."""
    with Session(engine) as session:
        ids = session.exec(
            select(Activity.id).where(
                col(Activity.sport).in_(MULTISPORT), col(Activity.parent_id).is_(None)
            )
        ).all()
    reports = []
    for event_id in ids:
        with Session(engine) as session:
            event = session.get(Activity, event_id)
            if event is not None:
                reports.append(_recalculate_event(session, event, apply))
    return reports


def _clock(seconds: float) -> str:
    total = round(seconds)
    return f"{total // 3600}:{total % 3600 // 60:02d}:{total % 60:02d}"


# ── Uploads folder ────────────────────────────────────────────────────────────


@dataclass
class CleanupReport:
    unused_fit: list[Path] = field(default_factory=list)
    orphan_caches: list[Path] = field(default_factory=list)
    temporary: list[Path] = field(default_factory=list)

    @property
    def files(self) -> list[Path]:
        return [*self.unused_fit, *self.orphan_caches, *self.temporary]


def clean_uploads(apply: bool = False, now: float | None = None) -> CleanupReport:
    """Find (and with ``apply``, delete) files in the uploads folder nothing uses. Files changed
    in the last hour are left alone: an import may be about to save their activity."""
    report = CleanupReport()
    cutoff = (time.time() if now is None else now) - RECENT_SECONDS
    folder = streams.UPLOAD_DIR
    if not folder.is_dir():
        return report
    with Session(engine) as session:
        stored = session.exec(
            select(Activity.fit_file_path).where(col(Activity.fit_file_path).is_not(None))
        ).all()
    used = {path for path in (streams.fit_path_for(s) for s in stored) if path is not None}

    for path in sorted(folder.iterdir()):
        if not path.is_file() or path.stat().st_mtime > cutoff:
            continue
        if path.name.endswith(".tmp"):
            report.temporary.append(path)
        elif path.name.endswith(streams.STREAMS_CACHE_SUFFIX):
            # <fit stem>.<digest>.streams.json.gz belongs to <fit stem>.fit
            fit = folder / (path.name.split(".", 1)[0] + ".fit")
            if fit.resolve() not in used:
                report.orphan_caches.append(path)
        elif path.suffix.lower() == ".fit" and path.resolve() not in used:
            report.unused_fit.append(path)

    if apply:
        delete_files(report.files)
    return report


def delete_files(paths: list[Path]) -> None:
    for path in paths:
        path.unlink(missing_ok=True)


# ── Command line ──────────────────────────────────────────────────────────────


def _size(paths: list[Path]) -> str:
    total = sum(p.stat().st_size for p in paths if p.exists())
    return f"{total / 1024 / 1024:.1f} MB"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    for name, text in (
        ("recalc-multisport", "update multisport events from their FIT files"),
        ("clean-uploads", "delete files in the uploads folder that nothing uses"),
    ):
        command = sub.add_parser(name, help=text)
        command.add_argument("--apply", action="store_true", help="make the changes")
    args = parser.parse_args(argv)

    import app.models  # noqa: F401  (registers the tables)
    from app.auth import create_auth_tables
    from app.database import create_db_and_tables

    create_db_and_tables()
    create_auth_tables()
    verb = "Updated" if args.apply else "Would update"

    if args.command == "recalc-multisport":
        reports = recalc_multisport(args.apply)
        changed = [r for r in reports if r.changes]
        for r in changed:
            print(f"{verb} #{r.event_id} {r.name}: " + "; ".join(r.changes))
        for r in reports:
            if r.skipped:
                print(f"Skipped #{r.event_id} {r.name}: {r.skipped}")
        unchanged = len(reports) - len(changed) - sum(1 for r in reports if r.skipped)
        print(f"{len(reports)} multisport events: {len(changed)} to update, {unchanged} already "
              f"right, {sum(1 for r in reports if r.skipped)} skipped")
    else:
        report = clean_uploads()  # sizes are listed before anything is deleted
        verb = "Deleted" if args.apply else "Would delete"
        for label, paths in (
            ("FIT files no activity uses", report.unused_fit),
            ("cached streams of missing FIT files", report.orphan_caches),
            ("unfinished temporary files", report.temporary),
        ):
            print(f"{verb} {len(paths)} {label}" + (f" ({_size(paths)})" if paths else ""))
            for path in paths[:20]:
                print(f"  {path.name}")
            if len(paths) > 20:
                print(f"  … and {len(paths) - 20} more")
        if args.apply:
            delete_files(report.files)

    if not args.apply:
        print("Nothing was changed. Run again with --apply to make these changes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
