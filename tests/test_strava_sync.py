import json
import tempfile
import time
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import httpx
import sqlalchemy
from sqlmodel import Session, create_engine, select

from kinetic import database, strava_sync
from kinetic.models import Activity, Lap, SportType


class StravaSyncTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.engine = create_engine(f"sqlite:///{Path(self.directory.name) / 'test.db'}")
        self.db_patch = patch.object(database, "engine", self.engine)
        self.sync_patch = patch.object(strava_sync, "engine", self.engine)
        self.env_patch = patch.dict(
            "os.environ",
            {
                "STRAVA_CLIENT_ID": "123",
                "STRAVA_CLIENT_SECRET": "test-secret",
            },
        )
        self.db_patch.start()
        self.sync_patch.start()
        self.env_patch.start()
        self.addCleanup(self.directory.cleanup)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.db_patch.stop)
        self.addCleanup(self.sync_patch.stop)
        self.addCleanup(self.env_patch.stop)
        database.create_db_and_tables()
        self.session = strava_sync.StravaSession(
            tokens={
                "access_token": "test-access",
                "refresh_token": "test-refresh",
                "expires_at": time.time() + 3600,
            }
        )
        self.payload = {
            "id": 987,
            "name": "Trail run",
            "sport_type": "TrailRun",
            "start_date": "2026-10-16T08:00:00Z",
            "moving_time": 600,
            "elapsed_time": 660,
            "distance": 2000,
            "average_heartrate": 140.4,
            "map": {"polyline": "_p~iF~ps|U_ulLnnqC_mqNvxq`@"},
            "laps": [{"distance": 2000, "elapsed_time": 660}],
        }

    def http_client(self, handler):
        client_class = httpx.Client
        transport = httpx.MockTransport(handler)
        return patch.object(
            strava_sync.httpx,
            "Client",
            side_effect=lambda **kwargs: client_class(transport=transport, **kwargs),
        )

    def test_migration_is_repeatable_on_existing_database(self):
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
            self.assertIn("strava_activity_id", columns)

    def test_oauth_url_state_and_missing_configuration(self):
        url = strava_sync.authorization_url(self.session, "http://localhost:8080/strava/callback")
        query = parse_qs(urlparse(url).query)
        self.assertEqual(query["state"], [self.session.state])
        self.assertEqual(query["scope"], ["activity:read_all"])
        self.assertNotIn("client_secret", query)
        with patch.dict("os.environ", {"STRAVA_CLIENT_SECRET": ""}):
            with self.assertRaises(ValueError):
                strava_sync.authorization_url(self.session, "http://localhost/strava/callback")

    def test_oauth_rejects_invalid_expired_denied_and_missing_scope(self):
        for invalid in ("wrong-state", ""):
            strava_sync.authorization_url(self.session, "http://localhost/strava/callback")
            with self.assertRaises(ValueError):
                strava_sync.complete_login(self.session, invalid, "code", "activity:read_all")
        strava_sync.authorization_url(self.session, "http://localhost/strava/callback")
        self.session.state_created -= 601
        with self.assertRaises(ValueError):
            strava_sync.complete_login(
                self.session, self.session.state, "code", "activity:read_all"
            )
        for scope, error in (("read", ""), ("activity:read_all", "access_denied")):
            strava_sync.authorization_url(self.session, "http://localhost/strava/callback")
            with self.assertRaises(ValueError):
                strava_sync.complete_login(self.session, self.session.state, "code", scope, error)
            self.assertEqual(self.session.state, "")

    def test_oauth_success_is_single_use(self):
        strava_sync.authorization_url(self.session, "http://localhost/strava/callback")
        state = self.session.state

        def respond(request):
            self.assertEqual(request.url.path, "/oauth/token")
            body = parse_qs(request.content.decode())
            self.assertEqual(body["grant_type"], ["authorization_code"])
            return httpx.Response(200, json=self.session.tokens)

        with self.http_client(respond):
            strava_sync.complete_login(self.session, state, "code", "read,activity:read_all")
            self.assertTrue(self.session.connected)
            with self.assertRaises(ValueError):
                strava_sync.complete_login(self.session, state, "code", "activity:read_all")

    def test_sync_paginates_maps_fields_and_skips_duplicates(self):
        pages = []

        def respond(request):
            if request.url.path.endswith("athlete/activities"):
                page = int(request.url.params["page"])
                pages.append(page)
                return httpx.Response(200, json=[self.payload] if page == 1 else [])
            self.assertEqual(request.headers["Authorization"], "Bearer test-access")
            return httpx.Response(200, json=self.payload)

        with self.http_client(respond):
            first = strava_sync.sync_activities(self.session, date(2026, 10, 16))
            second = strava_sync.sync_activities(self.session, date(2026, 10, 16))
        self.assertEqual(first, {"imported": 1, "skipped": 0, "errors": []})
        self.assertEqual(second, {"imported": 0, "skipped": 1, "errors": []})
        self.assertEqual(pages, [1, 2, 1, 2])
        with Session(self.engine) as db:
            activity = db.exec(select(Activity)).one()
            self.assertEqual(activity.sport, SportType.trail_running)
            self.assertEqual(activity.avg_heart_rate, 140)
            self.assertEqual(activity.duration_seconds, 600)
            self.assertEqual(json.loads(activity.route_json)[0], [38.5, -120.2])
            self.assertEqual(len(db.exec(select(Lap)).all()), 1)

    def test_refresh_rotates_tokens(self):
        self.session.tokens["expires_at"] = 0

        def respond(request):
            if request.url.path == "/oauth/token":
                body = parse_qs(request.content.decode())
                self.assertEqual(body["refresh_token"], ["test-refresh"])
                return httpx.Response(
                    200,
                    json={
                        "access_token": "new-access",
                        "refresh_token": "new-refresh",
                        "expires_at": time.time() + 3600,
                    },
                )
            self.assertEqual(request.headers["Authorization"], "Bearer new-access")
            return httpx.Response(200, json=[])

        with self.http_client(respond):
            strava_sync.sync_activities(self.session, date(2026, 10, 16))
        self.assertEqual(self.session.tokens["refresh_token"], "new-refresh")

    def test_garmin_source_id_links_existing_activity(self):
        with Session(self.engine) as db:
            strava_sync._import_activity(db, self.payload)
            activity = db.exec(select(Activity)).one()
            activity.strava_activity_id = None
            activity.garmin_activity_id = 123
            db.add(activity)
            db.commit()
            summary = {**self.payload, "external_id": "garmin_push_123"}
            self.assertTrue(strava_sync._existing_activity(db, summary))
            self.assertEqual(db.exec(select(Activity)).one().strava_activity_id, 987)

    def test_date_validation_rate_limit_and_logout(self):
        with self.assertRaises(ValueError):
            strava_sync.sync_activities(self.session, date(2026, 10, 16), date(2026, 10, 15))
        with self.http_client(lambda request: httpx.Response(429)):
            with self.assertRaisesRegex(RuntimeError, "rate limit"):
                strava_sync.sync_activities(self.session, date(2026, 10, 16))
        self.assertFalse(self.session.lock.locked())
        strava_sync.logout(self.session)
        self.assertFalse(self.session.connected)
        with self.assertRaisesRegex(RuntimeError, "Connect"):
            strava_sync.sync_activities(self.session, date(2026, 10, 16))


if __name__ == "__main__":
    unittest.main()
