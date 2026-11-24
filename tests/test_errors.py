import unittest
from unittest.mock import patch

from app import apple_health, strava
from app.errors import UserError, public_message


class PublicMessageTests(unittest.TestCase):
    def test_user_errors_keep_their_message(self):
        self.assertEqual(public_message(UserError("Bad file"), "fallback"), "Bad file")
        self.assertEqual(public_message(strava.StravaFileError("Not a GPX file"), "x"),
                         "Not a GPX file")

    def test_other_errors_are_replaced(self):
        internal = RuntimeError("psycopg.OperationalError: /var/lib/postgresql/data is full")
        self.assertEqual(public_message(internal, "Import failed"), "Import failed")
        self.assertEqual(public_message(KeyError("secret_column"), "Import failed"),
                         "Import failed")

    def test_parser_details_are_not_echoed(self):
        with self.assertRaises(strava.StravaFileError) as caught:
            strava.decompress("a.gpx.gz", b"\x1f\x8b" + b"not really gzip")
        self.assertEqual(str(caught.exception), "Corrupt gzip file")

    def test_apple_health_hides_unexpected_errors(self):
        def broken(_item):
            raise RuntimeError("relation \"activity\" does not exist")

        with patch.object(apple_health, "parse_workout", broken):
            result = apple_health.import_workouts([{"name": "Run"}])
        expected = {"index": 0, "name": "Run", "error": "Could not import this workout"}
        self.assertEqual(result["errors"], [expected])


if __name__ == "__main__":
    unittest.main()
