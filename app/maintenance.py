"""One-off maintenance on existing data, for every account. Shows what it would change; add
``--apply`` to change it.

    python -m app.maintenance recalc-multisport [--apply]
        Re-read the FIT file of every multisport event and update the event's duration and
        its legs' durations, routes and best efforts where the current parser differs. Events
        imported before multisport files used elapsed time kept a swim the watch auto-paused
        at its timer time (a minute instead of twenty).

    python -m app.maintenance recalc-durations [--apply]
        Set the duration of single-sport activities to the time without pauses (the timer
        time), as new imports do: before, it was the elapsed time, so a run with pauses showed
        a slower pace than the watch or app. Durations changed by hand are left alone.

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
from typing import Callable, Optional

from sqlalchemy.orm import defer
from sqlmodel import Session, col, select

from app import fit_parser, fit_summary, streams
from app.database import engine
from app.fit_parser import parse_fit_file
from app.models import Activity, ActivityMetrics, BestEffort, Lap, SportType
from app.ownership import current_owner

MULTISPORT = (SportType.triathlon, SportType.duathlon, SportType.multisport)
# A leg in the file and in the database are the same leg when they start this close together
_SAME_START_SECONDS = 5
# Durations closer than this are the same (rounding)
_SAME_DURATION_SECONDS = 1
# Average speeds closer than this share are the same (rounding in the file)
_SAME_SPEED_SHARE = 0.005
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


def recalc_multisport(
    apply: bool = False, progress: Optional[Callable[[int, int, int], None]] = None
) -> list[EventReport]:
    """Compare every multisport event with its FIT file; with ``apply``, update it.
    ``progress`` is called with (checked, total, changes so far) as it goes."""
    with Session(engine) as session:
        ids = session.exec(
            select(Activity.id).where(
                col(Activity.sport).in_(MULTISPORT), col(Activity.parent_id).is_(None)
            )
        ).all()
    reports = []
    for done, event_id in enumerate(ids, start=1):
        with Session(engine) as session:
            event = session.get(Activity, event_id)
            if event is not None:
                reports.append(_recalculate_event(session, event, apply))
        if progress:
            progress(done, len(ids), sum(1 for r in reports if r.changes))
    return reports


# ── Durations without pauses ─────────────────────────────────────────────────


@dataclass
class DurationReport:
    activity_id: int
    name: str
    old: float = 0.0
    new: float = 0.0
    laps: int = 0
    skipped: str = ""


def _file_summaries(path: Path) -> tuple[list[dict], list[dict]]:
    """The session and lap messages of a FIT file: read quickly without decoding the records,
    or with fitparse for a file the quick reader cannot follow."""
    try:
        return fit_summary.read_summaries(path.read_bytes())
    except fit_summary.FitSummaryError:
        pass
    import fitparse

    sessions: list[dict] = []
    laps: list[dict] = []
    for message in fitparse.FitFile(str(path)).get_messages(["session", "lap"]):
        values = {f.name: f.value for f in message.fields}
        (sessions if message.name == "session" else laps).append(values)
    return sessions, laps


def _recalculate_duration(
    session: Session, activity: Activity, apply: bool
) -> Optional[DurationReport]:
    """None when the activity already has the right duration."""
    report = DurationReport(activity.id, activity.name, old=activity.duration_seconds)
    path = streams.fit_path_for(activity.fit_file_path)
    if path is None:
        return None  # nothing to compare with; not worth listing
    try:
        sessions, lap_records = _file_summaries(path)
    except Exception as exc:
        report.skipped = f"its FIT file could not be read ({type(exc).__name__})"
        return report
    if not sessions or fit_parser._is_multisport(sessions):
        return None
    main = fit_parser._main_session(sessions)
    sport = fit_parser.resolve_sport(str(main.get("sport", "other")).lower(), main.get("sub_sport"))
    elapsed = float(main.get("total_elapsed_time") or main.get("total_timer_time") or 0)
    report.new = fit_parser.activity_duration(main, sport, main)
    if abs(report.new - report.old) <= _SAME_DURATION_SECONDS:
        return None
    if abs(report.old - elapsed) > _SAME_DURATION_SECONDS:
        report.skipped = f"its duration {_clock(report.old)} was changed by hand"
        return report

    laps = session.exec(
        select(Lap).where(Lap.activity_id == activity.id).order_by(col(Lap.lap_number))
    ).all()
    if len(laps) == len(lap_records):
        for lap, record in zip(laps, lap_records):
            new = fit_parser.activity_duration(record, sport, main) or None
            if new is not None and lap.duration_seconds != new:
                report.laps += 1
                if apply:
                    lap.duration_seconds = new
    if apply:
        activity.duration_seconds = report.new
        session.commit()
    return report


def _paused(duration: float, distance: Optional[float], avg_speed: Optional[float]) -> bool:
    """Whether the activity may have pauses to leave out, judged from its stored numbers.

    The stored average speed comes from the file and leaves the pauses out, so when distance
    over duration matches it, the timer ran the whole time and the file need not be read
    (reading a FIT file takes seconds). Without a distance or a speed, only the file can tell.
    """
    if not distance or not avg_speed or duration <= 0:
        return True
    return abs(distance / duration - avg_speed) / avg_speed > _SAME_SPEED_SHARE


def recalc_durations(
    apply: bool = False, progress: Optional[Callable[[int, int, int], None]] = None
) -> list[DurationReport]:
    """Compare every single-sport activity's duration with its FIT file; with ``apply``,
    update it. Lists only the activities that change or are skipped. ``progress`` is called
    with (checked, total, changes so far) as it goes."""
    with Session(engine) as session:
        rows = session.exec(
            select(
                Activity.id,
                Activity.duration_seconds,
                Activity.distance_meters,
                Activity.avg_speed_ms,
            ).where(
                col(Activity.parent_id).is_(None),
                col(Activity.sport).not_in(MULTISPORT),
                col(Activity.fit_file_path).is_not(None),
            )
        ).all()
    ids = [
        row.id
        for row in rows
        if _paused(row.duration_seconds, row.distance_meters, row.avg_speed_ms)
    ]
    reports = []
    for done, activity_id in enumerate(ids, start=1):
        with Session(engine) as session:
            activity = session.exec(
                select(Activity)
                .where(Activity.id == activity_id)
                .options(defer(Activity.route_json), defer(Activity.map_route_json))
            ).first()
            if activity is not None:
                report = _recalculate_duration(session, activity, apply)
                if report is not None:
                    reports.append(report)
        if progress:
            progress(done, len(ids), len(reports))
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


def _progress(what: str) -> Callable[[int, int, int], None]:
    """Prints how far the run is, every 50 activities and at the end."""
    print(f"Checking the {what} against their FIT files…", flush=True)

    def report(done: int, total: int, changes: int) -> None:
        if done % 50 == 0 or done == total:
            print(f"  {done} of {total} checked, {changes} to change so far", flush=True)

    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    for name, text in (
        ("recalc-multisport", "update multisport events from their FIT files"),
        ("recalc-durations", "leave the pauses out of single-sport activities' durations"),
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
        reports = recalc_multisport(args.apply, _progress("events"))
        changed = [r for r in reports if r.changes]
        for r in changed:
            print(f"{verb} #{r.event_id} {r.name}: " + "; ".join(r.changes))
        for r in reports:
            if r.skipped:
                print(f"Skipped #{r.event_id} {r.name}: {r.skipped}")
        unchanged = len(reports) - len(changed) - sum(1 for r in reports if r.skipped)
        print(f"{len(reports)} multisport events: {len(changed)} to update, {unchanged} already "
              f"right, {sum(1 for r in reports if r.skipped)} skipped")
    elif args.command == "recalc-durations":
        reports = recalc_durations(args.apply, _progress("activities"))
        changed = [r for r in reports if not r.skipped]
        for r in changed:
            laps = f" ({r.laps} lap{'s' if r.laps != 1 else ''})" if r.laps else ""
            print(f"{verb} #{r.activity_id} {r.name}: {_clock(r.old)} -> {_clock(r.new)}{laps}")
        for r in reports:
            if r.skipped:
                print(f"Skipped #{r.activity_id} {r.name}: {r.skipped}")
        print(f"{len(changed)} activities to update, {len(reports) - len(changed)} skipped")
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
