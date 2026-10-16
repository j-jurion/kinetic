# Kinetic

Activity tracking web app built with NiceGUI + FastAPI.

## Features
- Upload Garmin `.fit` files or add activities manually
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
- Friends management
- Dark / light mode toggle

## Setup

```bash
pip install -e .
python run.py
```

Open http://localhost:8000

## Strava Sync

Create a Strava API application at https://www.strava.com/settings/api and set its
Authorization Callback Domain to `localhost` for local use. Before starting Kinetic,
set these environment variables in PowerShell:

```powershell
$env:STRAVA_CLIENT_ID = "your-client-id"
$env:STRAVA_CLIENT_SECRET = "your-client-secret"
python run.py
```

Use **Connect with Strava** on the Sync page and grant activity access. The default
callback is `/strava/callback` on the same host and port as the app (for example,
`http://localhost:8080/strava/callback`). Set `STRAVA_REDIRECT_URI` to override it
when running behind a proxy, and configure the matching callback domain in Strava.
Keep the client secret out of source control.

The Strava card imports activity details, laps, and available GPS routes for the
selected dates (inclusive, UTC). Repeated syncs skip previously imported Strava IDs.
Activities with a matching Garmin source ID are linked to existing Garmin records
instead of being imported twice; activities without that identifier may still
appear twice if imported from both services. Strava API rate limits apply.
Strava tokens are held only in server memory per browser session. Logging out
clears the local connection, and restarting Kinetic requires signing in again.
Strava best efforts and original FIT files are not imported.

## Apple Watch Imports

Apple Health does not expose a web sign-in or workout-sync API. Direct HealthKit
access requires a native Apple-device app with the user's permission; Apple ID
credentials and Sign in with Apple do not grant access to workout data.

On your iPhone, open **Health > Summary > profile picture > Export All Health Data**.
Transfer the exported ZIP to this computer. In Kinetic's Sync page, use the
**Apple Watch** card to select a date range and upload the ZIP, or its `export.xml`.
Dates are inclusive and use UTC. Limits are 250 MB uploaded and 1 GB of XML inside
a ZIP. A new export is needed to import later workouts; this is not automatic sync.

Only workout summaries are imported: sport, start time, duration, distance, calories,
and heart-rate statistics when included in the workout. Other health records are
ignored, and the uploaded export is deleted after processing. GPS routes, laps,
and best efforts are not imported. Health exports may also contain workouts from
third-party apps, not only Apple Watch. Reimporting the same workout is skipped;
the same activity imported separately from Garmin or Strava may still appear twice.

## Stack
- **NiceGUI** – reactive UI framework
- **FastAPI** – REST API (served at `/api`)
- **SQLModel** – ORM with SQLite
- **fitparse** – Garmin .fit file parsing
- **Plotly** – interactive charts
