import io
import tempfile
import unittest
import zipfile
from datetime import date
from pathlib import Path
from unittest.mock import patch

import sqlalchemy
from sqlmodel import Session, create_engine, select

from kinetic import apple_health, database
from kinetic.models import Activity, SportType

WORKOUT = (
    '<Workout workoutActivityType="HKWorkoutActivityTypeRunning" sourceName="Apple Watch" '
    'sourceVersion="1" startDate="2026-10-16 08:00:00 +0200" '
    'endDate="2026-10-16 08:30:00 +0200" duration="30" durationUnit="min" '
    'totalDistance="5" totalDistanceUnit="km" totalEnergyBurned="250" '
    'totalEnergyBurnedUnit="kcal">{children}</Workout>'
)


class AppleHealthTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.engine = create_engine(f"sqlite:///{Path(self.directory.name) / 'test.db'}")
        self.db_patch = patch.object(database, "engine", self.engine)
        self.import_patch = patch.object(apple_health, "engine", self.engine)
        self.db_patch.start()
        self.import_patch.start()
        self.addCleanup(self.directory.cleanup)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.db_patch.stop)
        self.addCleanup(self.import_patch.stop)
        database.create_db_and_tables()
        self.path = Path(self.directory.name) / "export.xml"

    def write_export(self, workout=WORKOUT, children=""):
        self.path.write_text(
            '<HealthData locale="en_US">' + workout.format(children=children) + "</HealthData>",
            encoding="utf-8",
        )

    def import_export(self):
        return apple_health.import_workouts(self.path, date(2026, 10, 16), date(2026, 10, 16))

    def test_workout_fields_units_and_timezone(self):
        self.write_export(
            children=(
                '<WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" '
                'average="143.2" maximum="178" unit="count/min"/>'
            )
        )
        self.assertEqual(self.import_export(), {"imported": 1, "skipped": 0, "errors": []})
        with Session(self.engine) as db:
            activity = db.exec(select(Activity)).one()
            self.assertEqual(activity.sport, SportType.running)
            self.assertEqual(activity.date.hour, 6)
            self.assertEqual(activity.duration_seconds, 1800)
            self.assertEqual(activity.distance_meters, 5000)
            self.assertEqual(activity.calories, 250)
            self.assertEqual(activity.avg_heart_rate, 143)
            self.assertEqual(activity.max_heart_rate, 178)

    def test_statistics_and_unit_conversion(self):
        workout = WORKOUT.replace('totalDistance="5" totalDistanceUnit="km" ', "").replace(
            'totalEnergyBurned="250" totalEnergyBurnedUnit="kcal"', ""
        )
        self.write_export(
            workout,
            children=(
                '<WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" '
                'sum="1" unit="mi"/>'
                '<WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" '
                'sum="418.4" unit="kJ"/>'
            ),
        )
        self.assertEqual(self.import_export()["imported"], 1)
        with Session(self.engine) as db:
            activity = db.exec(select(Activity)).one()
            self.assertAlmostEqual(activity.distance_meters, 1609.344)
            self.assertEqual(activity.calories, 100)

    def test_reimport_is_stable_across_source_version_changes(self):
        self.write_export()
        self.assertEqual(self.import_export()["imported"], 1)
        self.write_export(WORKOUT.replace('sourceVersion="1"', 'sourceVersion="2"'))
        self.assertEqual(self.import_export()["skipped"], 1)

    def test_external_uuid_is_stable(self):
        children = '<MetadataEntry key="HKExternalUUID" value="test-workout-id"/>'
        self.write_export(children=children)
        self.assertEqual(self.import_export()["imported"], 1)
        self.write_export(
            WORKOUT.replace('sourceName="Apple Watch"', 'sourceName="New Watch"'), children=children
        )
        self.assertEqual(self.import_export()["skipped"], 1)

    def test_dates_and_invalid_workouts(self):
        self.write_export()
        result = apple_health.import_workouts(self.path, date(2026, 10, 17), date(2026, 10, 17))
        self.assertEqual(result["skipped"], 1)
        with self.assertRaises(ValueError):
            apple_health.import_workouts(self.path, date(2026, 10, 17), date(2026, 10, 16))
        self.write_export(WORKOUT.replace('duration="30"', 'duration="NaN"'))
        self.assertEqual(len(self.import_export()["errors"]), 1)

    def test_zip_import(self):
        self.path = Path(self.directory.name) / "export.zip"
        with zipfile.ZipFile(self.path, "w") as archive:
            archive.writestr(
                "apple_health_export/export.xml",
                "<HealthData>" + WORKOUT.format(children="") + "</HealthData>",
            )
        self.assertEqual(self.import_export()["imported"], 1)

    def test_bad_archives_roots_and_limits(self):
        self.path = Path(self.directory.name) / "export.zip"
        with zipfile.ZipFile(self.path, "w") as archive:
            archive.writestr("other.xml", "<HealthData/>")
        with self.assertRaisesRegex(ValueError, "exactly one"):
            self.import_export()
        with zipfile.ZipFile(self.path, "w") as archive:
            archive.writestr("export.xml", "<HealthData/>")
        with patch.object(apple_health, "MAX_XML_BYTES", 1):
            with self.assertRaisesRegex(ValueError, "uncompressed"):
                self.import_export()
        with patch.object(apple_health, "MAX_UPLOAD_BYTES", 1):
            with self.assertRaisesRegex(ValueError, "upload limit"):
                self.import_export()
        self.path = Path(self.directory.name) / "export.xml"
        self.path.write_text("<other/>")
        with self.assertRaisesRegex(ValueError, "not an Apple Health"):
            self.import_export()

    def test_xml_entities_rejected_and_non_workout_records_ignored(self):
        self.path.write_text(
            '<!DOCTYPE HealthData [<!ENTITY secret SYSTEM "file:///not-accessed">]>'
            "<HealthData><Record>&secret;</Record></HealthData>"
        )
        with self.assertRaisesRegex(ValueError, "unsafe"):
            self.import_export()
        result = apple_health._import_stream(
            io.BytesIO(b'<HealthData><Record type="private-health-data"/></HealthData>'),
            date(2026, 10, 16),
            date(2026, 10, 16),
            None,
        )
        self.assertEqual(result, {"imported": 0, "skipped": 0, "errors": []})

    def test_malformed_export_rolls_back_all_workouts(self):
        self.path.write_text("<HealthData>" + WORKOUT.format(children="") + "<broken>")
        with self.assertRaises(ValueError):
            self.import_export()
        with Session(self.engine) as db:
            self.assertEqual(db.exec(select(Activity)).all(), [])

    def test_legacy_schema_migration(self):
        legacy = create_engine("sqlite://")
        self.addCleanup(legacy.dispose)
        with legacy.begin() as conn:
            conn.execute(sqlalchemy.text("CREATE TABLE activity (id INTEGER PRIMARY KEY)"))
        with patch.object(database, "engine", legacy):
            database.create_db_and_tables()
            database.create_db_and_tables()
        with legacy.connect() as conn:
            columns = {
                row[1] for row in conn.execute(sqlalchemy.text("PRAGMA table_info(activity)"))
            }
            self.assertIn("apple_health_workout_id", columns)


if __name__ == "__main__":
    unittest.main()
