# Kinetic

Activity tracking web app: a React (Vite) frontend in `web/` on top of a FastAPI backend in `app/`.

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

Account export and deletion, production rate limits and public-deployment security review
are not implemented yet. Do not expose this test configuration publicly.
Every state-changing API request must carry an `Origin` header equal to
`KINETIC_PUBLIC_ORIGIN`; this protects the session cookie against cross-site requests.

Some database, FIT and old NiceGUI storage files are already tracked by Git. Ignore rules do not
remove tracked files or their history; review them before making the repository public.

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
- **SQLModel** – ORM with SQLite
- **fitparse** – Garmin .fit file parsing
