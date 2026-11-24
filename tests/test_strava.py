import gzip
import tempfile
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app import apple_health, garmin_sync, strava
from app.fit_parser import parse_fit_file
from app.models import Activity, SportType
from app.ownership import current_owner

START = datetime(2023, 5, 14, 7, 30, tzinfo=timezone.utc)


def _iso(seconds: int) -> str:
    return (START + timedelta(seconds=seconds)).strftime("%Y-%m-%dT%H:%M:%SZ")


def gpx(seconds: int = 1200, kind: str = "running") -> bytes:
    """A straight-ish track north at ~3 m/s with heart rate and cadence."""
    points = "".join(
        f'<trkpt lat="{50.0 + t * 3 / 111_195:.7f}" lon="4.0"><ele>{10 + t / 100:.1f}</ele>'
        f"<time>{_iso(t)}</time><extensions><gpxtpx:TrackPointExtension>"
        f"<gpxtpx:hr>{140 + t % 10}</gpxtpx:hr><gpxtpx:cad>85</gpxtpx:cad>"
        f"</gpxtpx:TrackPointExtension></extensions></trkpt>"
        for t in range(0, seconds + 1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<gpx creator="StravaGPX" version="1.1" xmlns="http://www.topografix.com/GPX/1/1" '
        'xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">'
        f"<metadata><time>{_iso(0)}</time></metadata>"
        f"<trk><name>Morning Run</name><type>{kind}</type><trkseg>{points}</trkseg></trk></gpx>"
    ).encode()


def tcx(seconds: int = 1800) -> bytes:
    """An indoor ride: no positions, distance from the device, power and heart rate."""
    points = "".join(
        f"<Trackpoint><Time>{_iso(t)}</Time><DistanceMeters>{t * 8.0:.1f}</DistanceMeters>"
        f"<HeartRateBpm><Value>130</Value></HeartRateBpm><Cadence>90</Cadence>"
        f"<Extensions><ns3:TPX><ns3:Watts>200</ns3:Watts></ns3:TPX></Extensions></Trackpoint>"
        for t in range(0, seconds + 1, 2)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<TrainingCenterDatabase "
        'xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" '
        'xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">'
        f'<Activities><Activity Sport="Biking"><Id>{_iso(0)}</Id><Lap StartTime="{_iso(0)}">'
        f"<TotalTimeSeconds>{seconds}</TotalTimeSeconds><DistanceMeters>{seconds * 8.0}"
        f"</DistanceMeters><Calories>500</Calories><Track>{points}</Track></Lap>"
        "</Activity></Activities></TrainingCenterDatabase>"
    ).encode()


class ParseTests(unittest.TestCase):
    def setUp(self):
        workdir = tempfile.TemporaryDirectory()
        self.addCleanup(workdir.cleanup)
        self.dir = Path(workdir.name)

    def roundtrip(self, workout):
        path = self.dir / f"{uuid.uuid4().hex}.fit"
        path.write_bytes(apple_health.to_fit(workout))
        return parse_fit_file(path)

    def test_classify_strava_types(self):
        self.assertEqual(strava.classify("Run"), ("running", "generic"))
        self.assertEqual(strava.classify("Trail Run"), ("running", "trail"))
        self.assertEqual(strava.classify("Virtual Ride"), ("cycling", "indoor_cycling"))
        self.assertEqual(strava.classify("Gravel Ride"), ("cycling", "generic"))
        self.assertEqual(strava.classify("9"), ("running", "generic"))
        self.assertEqual(strava.classify("Weight Training"), ("training", "strength_training"))
        self.assertIsNone(strava.classify("Kitesurf"))
        self.assertIsNone(strava.classify(None))

    def test_gpx_keeps_route_heart_rate_and_distance(self):
        workout = strava.parse_gpx(gpx())
        self.assertEqual(
            (workout.sport, workout.start, workout.name), ("running", START, "Morning Run")
        )
        activity, laps, efforts, _ = self.roundtrip(workout)
        self.assertEqual(activity.sport, SportType.running)
        self.assertEqual(activity.duration_seconds, 1200)
        self.assertAlmostEqual(activity.distance_meters, 3600, delta=20)
        self.assertEqual(activity.avg_heart_rate, 144)
        self.assertIsNotNone(activity.route_json)
        self.assertEqual(len(laps), 4)
        self.assertEqual({e.distance_meters for e in efforts}, {1000})

    def test_csv_type_overrides_gpx_type(self):
        workout = strava.parse_gpx(gpx(kind="running"), strava.classify("Trail Run"))
        self.assertEqual(workout.sport_type, SportType.trail_running)

    def test_tcx_indoor_ride_uses_device_distance(self):
        workout = strava.parse_tcx(tcx())
        self.assertEqual(workout.sport, "cycling")
        activity, *_ = self.roundtrip(workout)
        self.assertEqual(activity.sport, SportType.cycling)
        self.assertAlmostEqual(activity.distance_meters, 14400, delta=1)
        self.assertEqual((activity.avg_power, activity.calories), (200, 500))
        self.assertIsNone(activity.route_json)

    def test_decompress_gzip_and_reject_other_files(self):
        compressed = gzip.compress(b"<gpx/>")
        self.assertEqual(strava.decompress("1.gpx.gz", compressed), (".gpx", b"<gpx/>"))
        self.assertEqual(strava.decompress("1.FIT", b"abc"), (".fit", b"abc"))
        with self.assertRaises(strava.StravaFileError):
            strava.decompress("photo.jpg", b"abc")
        with self.assertRaises(strava.StravaFileError):
            strava.decompress("1.gpx.gz", b"\x1f\x8bnot gzip")

    def test_rejects_doctype(self):
        bomb = b'<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY a "aaaa">]><gpx>&a;</gpx>'
        with self.assertRaises(strava.StravaFileError):
            strava.parse_gpx(bomb)


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        SQLModel.metadata.create_all(self.engine)
        self.addCleanup(self.engine.dispose)
        workdir = tempfile.TemporaryDirectory()
        self.addCleanup(workdir.cleanup)
        for patcher in (
            patch.object(garmin_sync, "engine", self.engine),
            patch.object(apple_health, "engine", self.engine),
            patch.object(strava, "engine", self.engine),
            patch.object(garmin_sync, "UPLOAD_DIR", Path(workdir.name)),
            patch("app.metrics.store_quietly"),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        token = current_owner.set(str(uuid.uuid4()))
        self.addCleanup(current_owner.reset, token)

    def activities(self):
        with Session(self.engine) as session:
            return session.exec(select(Activity)).all()

    def test_import_uses_csv_metadata_and_skips_duplicates(self):
        data = gzip.compress(gpx())
        first = strava.import_file(
            "activities/123.gpx.gz", data, "Parkrun PB", "Run", "Felt great"
        )
        self.assertEqual(first["status"], "imported")
        (activity,) = self.activities()
        self.assertEqual((activity.name, activity.notes), ("Parkrun PB", "Felt great"))

        self.assertEqual(strava.import_file("activities/123.gpx.gz", data)["status"], "skipped")
        self.assertEqual(len(self.activities()), 1)

    def test_fit_files_are_imported_and_deduplicated(self):
        fit = apple_health.to_fit(strava.parse_tcx(tcx()))
        result = strava.import_file("1.fit.gz", gzip.compress(fit), "Zwift")
        self.assertEqual(result["status"], "imported")
        self.assertEqual(strava.import_file("1.fit", fit)["status"], "skipped")
        (activity,) = self.activities()
        self.assertEqual((activity.name, activity.sport), ("Zwift", SportType.cycling))

    def test_files_outside_the_date_window_are_skipped(self):
        data, fit = gpx(), apple_health.to_fit(strava.parse_tcx(tcx()))
        later = (strava.parse_moment("2023-05-15T00:00:00Z"), None)
        earlier = (None, strava.parse_moment("2023-05-14T07:30:00+00:00"))
        for window in (later, earlier):
            self.assertEqual(strava.import_file("1.gpx", data, window=window)["status"], "skipped")
            self.assertEqual(strava.import_file("2.fit", fit, window=window)["status"], "skipped")
        self.assertEqual(self.activities(), [])

        inside = (
            strava.parse_moment("2023-05-14T00:00:00"),
            strava.parse_moment("2023-05-15T00:00:00Z"),
        )
        self.assertEqual(strava.import_file("1.gpx", data, window=inside)["status"], "imported")


if __name__ == "__main__":
    unittest.main()
