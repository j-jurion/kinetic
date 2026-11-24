# Kinetic

Activity tracking web app: a React (Vite) frontend in `web/` on top of a FastAPI backend in `app/`.

## Features
- Upload Garmin `.fit` files or add activities manually
- Bulk import of a Strava export (`.fit`, `.gpx` and `.tcx` activity files, gzipped or not); see
  [Strava](#strava)
- Apple Watch workouts, pushed automatically by the Health Auto Export iOS app or imported from
  an Apple Health `export.zip` (see [Apple Watch](#apple-watch))
- Activities list with distance, pace, HR, duration
- Edit and delete activities
- Sport types: Running, Trail Running, Cycling, Swimming, Hiking, Walking, Triathlon, Strength, Yoga
- Activity kinds: Race, Training, Easy, Social, Long Run, Tempo, Interval, Recovery
- Trail runs are detected from the `.fit` sub-sport; an "All running" filter covers road + trail
- Triathlon/duathlon legs count towards their own sport's records and are labelled with the
  event they belong to; the "Multisport" filter covers triathlon, duathlon and multisport
- Swimming is shown in metres with pace per 100 m; every other sport uses km and min/km
- Monthly & yearly distance charts with sport filter
- Sport breakdown pie chart
- Best efforts per distance per sport per year, with gold/silver/bronze medals and a gold medal
  marking the best effort of each year
- Most elevation and longest activity rankings (top 10, with a full sortable table)
- Dedicated page listing every attempt at a given distance, with progression chart
- Activity page: route coloured by speed, profile (heart rate, pace and grade-adjusted pace,
  elevation, cadence, power, running dynamics, temperature) with hover synced to the map,
  heart-rate and power zones, laps with elevation, climbs and pool-swim lengths (SWOLF)
- Training page: fitness, fatigue and form, weekly load and ramp rate, intensity distribution,
  discipline balance, consistency calendar and streaks, running efficiency and dynamics trends,
  heat vs pace, brick runs, swim efficiency and aerobic decoupling
- Race predictor, personal-record timeline, power curve and FTP; triathlon race breakdown
- Friends management
- Dark / light mode toggle

### Training metrics

Charts that look across many activities use a few numbers per activity (heart-rate histogram,
power curve, moving time, running dynamics, …) read once from its FIT file and stored in the
`activitymetrics` table. They are computed when an activity is imported; for activities that
existed before, use **Analyse now** on the Training page (it takes about half a second per
activity). Zones and training load use the maximum and threshold heart rate, FTP and weight
configured on the watch, as recorded in the FIT files, and fall back to estimates.

### Apple Watch

Apple has no web API for workouts; they live in HealthKit on the iPhone. Kinetic accepts them
in two ways, both on the **Sync** page, and converts each workout into a FIT file
(`app/fit_writer.py`), so it goes through the same import, charts and metrics as a Garmin
activity:

- **Automatic** — the Health Auto Export iOS app posts new
  workouts to `POST /api/integrations/apple-health/webhook`. Create a token on the Sync page and
  add a *REST API* automation in the app with that URL, the header
  `Authorization: Bearer <token>`, data type *Workouts*, JSON, export version 2, and *Include
  Route Data* and *Include Workout Metrics* on. The token only opens that one endpoint; only
  its SHA-256 hash is stored. In production use the Vercel URL, so the request gets the origin
  secret; turn on the app's batching if a sync sends many workouts at once (requests are capped
  at 25 MB).
- **History** — choose the `export.zip` from Health → profile → *Export All Health Data*. The
  browser reads it (it can be gigabytes, so it is never uploaded) and sends only the workouts,
  with heart rate, distance, power and GPS route, in batches of a few MB to
  `POST /api/integrations/apple-health/import`.

A workout is skipped when an activity of the same sport already starts within a minute of it,
so re-importing is harmless and workouts that also reached Kinetic from Garmin are not
duplicated. Apple Watch data has heart rate, GPS, distance and (cycling/running) power, but no
Garmin running dynamics or training-effect fields; laps are generated per km (5 km cycling).

### Strava

On the **Strava** tab of the **Sync** page (web or mobile), choose the zip from Strava (Settings →
My Account → *Download or Delete Your Account* → *Request your archive*). The app reads it, so photos and the rest of the
archive are never uploaded, and sends each file from its `activities/` folder to
`POST /api/activities/import-file` with the activity's name, type and description from
`activities.csv`. Loose `.fit`, `.gpx` and `.tcx` files (gzipped or not) can be chosen
instead, many at once. FIT files are imported as they are; GPX and TCX files are converted into
a FIT file (`app/strava.py`) like Apple Watch workouts. As with Apple Health, a file is skipped
when an activity of the same sport already starts within a minute of it, so importing an export
again, or activities that also came in from Garmin, adds nothing.

## Setup

Requirements: Python 3.12+ with [uv](https://docs.astral.sh/uv/), and Node.js 20+.

### Development

Run the API and the web app in two terminals. Vite serves the frontend on
http://localhost:5173 and proxies `/api` to the API on port 8000, so the browser sees one origin.

```bash
uv sync --frozen
export KINETIC_PUBLIC_ORIGIN="http://localhost:5173"
export KINETIC_ALLOW_INSECURE_HTTP=1
uv run python run.py
```

```bash
cd web
npm install
npm run dev
```

Run the same checks as CI before pushing (`uv sync` installs pytest and ruff):

```bash
uv run ruff check app tests run.py
uv run pytest -q
cd web && npm run lint && npm run build
```

On PowerShell, set the variables for the API with:

```powershell
$env:KINETIC_PUBLIC_ORIGIN = "http://localhost:5173"
$env:KINETIC_ALLOW_INSECURE_HTTP = "1"
uv run python run.py
```

### Production

Build the web app once; FastAPI then serves it from `web/dist` next to the API, so a single
process (see the systemd section) runs everything:

```bash
cd web && npm ci && npm run build && cd ..
export KINETIC_PUBLIC_ORIGIN="https://kinetic.example.com"
uv run python run.py
```

`KINETIC_API_HOST` and `KINETIC_API_PORT` change the listen address (default `127.0.0.1:8000`).
`KINETIC_UPLOAD_DIR` sets the folder holding the imported FIT files (default `uploads` in the
working directory); the activity charts and training metrics read them back from there.
The interactive API documentation is at `/api/docs`.

The insecure HTTP option is for local development only and is rejected for non-local origins.
For HTTPS, set `KINETIC_PUBLIC_ORIGIN` to the exact public origin and unset
`KINETIC_ALLOW_INSECURE_HTTP`. Keep the storage secret stable across restarts.

### Accounts

Activities, friends and related data are private to the account that created them. Existing
unassigned records are not visible to any account. Friend records are labels, not yet
connections between accounts; activity sharing is not implemented.

Each account connects its own Garmin account on the **Sync** page. Garmin tokens are stored
per account under `garmin_tokens/<account id>/` in the working directory (keep it private and
out of the repository), and synced activities are imported only into that account. Tokens
from earlier versions in `~/.garminconnect` are not reused; authenticate again once.

Anyone can create an account on the **Register** page with a username and a password of at
least 12 characters; no email address is needed. Usernames are 3 to 32 characters (letters,
digits, `.`, `_` or `-`) and are case-insensitive.

There is no self-service password recovery. To reset a forgotten password, run the following
on the server; it prints a new generated password and signs the account out everywhere:

```bash
uv run python -m app.reset_password <username>
```

Accounts created by earlier email-based versions are converted automatically at startup:
the part of the email address before `@` becomes the username (with a numeric suffix if it is
already taken). Back up `app.db` before upgrading.

For a **local test only**, stop the app and use the following command to copy an existing
single-user SQLite database into an empty `app.db`, back up both databases, assign its
activities and friends to a test account named `test`, and print a generated password once:

```bash
uv run python -m app.bootstrap_test_account --source kinetic.db --backup-dir /secure/backup
```

The backup directory must exist. The source remains unchanged and the command refuses to
overwrite a nonempty destination. Keep the printed password and backups secure.

Login and registration are rate-limited per client address and per username (see
`app/rate_limit.py`): after 10 failed logins for a username, or 20 from one address, within
15 minutes, further attempts get a `429` response until the window passes; one address
can register at most 10 accounts an hour. The counters live in memory, which suits the single
API machine; restarting the API clears them.

Account export and deletion and a public-deployment security review are not implemented yet.
Do not expose this test configuration publicly.
Every state-changing API request must carry an `Origin` header equal to
`KINETIC_PUBLIC_ORIGIN`; this protects the session cookie against cross-site requests.

Personal recordings (`data/`, `*.fit`) are ignored by Git and are no longer tracked; tests
use a generated synthetic run (`tests/fit_samples.py`). Earlier commits still contain FIT files
with GPS tracks, so rewrite the history (e.g. `git filter-repo --path data --invert-paths`)
before making the repository public.

### Deploy to Vercel + Fly.io + Supabase

See [DEPLOYMENT.md](DEPLOYMENT.md): the web app on Vercel, the API on Fly.io (`Dockerfile`,
`fly.toml`) and Postgres on Supabase. Set `DATABASE_URL` to use Postgres instead of the
local SQLite `app.db`; `KINETIC_GARMIN_TOKEN_DIR` moves the Garmin token folder, and
`KINETIC_ORIGIN_SECRET` makes the API reject requests that don't come through the proxy.

### Run with systemd (Ubuntu)

The service file assumes the checkout and virtual environment are at `/opt/kinetic`,
owned by a `kinetic` system user. Install the project dependencies into
`/opt/kinetic/.venv` and build the web app (`npm ci && npm run build` in `web/`). Configure
the HTTPS `KINETIC_PUBLIC_ORIGIN` using a protected systemd environment file or a service
override before starting the service. The app listens on `127.0.0.1:8000`; put a reverse proxy
or tunnel in front of it for HTTPS. Then install and start the service:

```bash
sudo install -m 0644 kinetic.service /etc/systemd/system/kinetic.service
sudo systemctl daemon-reload
sudo systemctl enable --now kinetic
```

Check logs with `sudo journalctl -u kinetic -f`.

## Stack
- **React + Vite** – web frontend (`web/`), with MUI components, Plotly charts and Leaflet maps
- **FastAPI** – JSON API (served at `/api`)
- **SQLModel** – ORM with SQLite locally or Postgres (Supabase) in production
- **fitparse** – Garmin .fit file parsing
