# Deploying Kinetic: Vercel + Fly.io + Supabase

```text
Browser ──HTTPS──▶ Vercel (React app from web/dist)
                     │  /api/*  proxied, adds x-origin-secret header
                     ▼
                   Fly.io (FastAPI, Dockerfile)  ── volume /data: FIT files, Garmin tokens
                     │
                     ▼
                   Supabase (Postgres)
```

The browser only ever talks to the Vercel domain. Vercel forwards `/api/*` to Fly, so the
session cookie and the `Origin` check keep working exactly as in development (one origin, no
CORS, no third-party cookies). FIT files stay on disk, on a Fly volume.

Configuration the code reads:

| Variable | Where | Value |
| --- | --- | --- |
| `DATABASE_URL` | Fly secret | Supabase **session pooler** connection string |
| `KINETIC_PUBLIC_ORIGIN` | Fly secret | Exact Vercel origin, e.g. `https://kinetic.vercel.app` |
| `KINETIC_ORIGIN_SECRET` | Fly secret **and** Vercel env var | Same long random string on both |
| `KINETIC_GARMIN_TOKEN_KEY` | Fly secret | Key that encrypts the stored Garmin tokens and email (see below) |
| `KINETIC_UPLOAD_DIR`, `KINETIC_GARMIN_TOKEN_DIR` | `fly.toml` | `/data/uploads`, `/data/garmin_tokens` |

Generate the origin secret once (PowerShell):

```powershell
-join ((1..48) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```

Generate the Garmin token key once with `uv run python -m app.token_crypto` (it prints a
Fernet key). Without it, Garmin sync is refused and the API logs a warning at startup. Keep a
copy somewhere safe: if it is lost, every account has to sign in to Garmin again (nothing else
is lost). To rotate it, set `KINETIC_GARMIN_TOKEN_KEY="<new key>,<old key>"`; tokens are
re-encrypted with the new key at each sync, so the old key can be removed after a while.
Plain-text tokens left by earlier versions are encrypted the first time they are read.

## 1. Supabase (database)

1. Create a project. Pick region **Central EU (Frankfurt)** to sit next to Fly's `fra`
   region (or change `primary_region` in `fly.toml` to match whatever you pick). Save the
   database password.
2. **Connect** → copy the **Session pooler** URI (port 5432, IPv4). It looks like
   `postgresql://postgres.<ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`.
   Don't use the transaction pooler (port 6543).
3. Recommended: **Project Settings → Data API** → turn the Data API off. The app never uses
   it. (The API also enables row-level security on every table at startup, so the public
   anon key can't read anything even if you leave it on.)
4. Note: free-tier projects pause after a week without activity; upgrade or keep it in use.
5. Copy your existing data (optional, from this machine, with the app stopped):

   ```powershell
   $env:DATABASE_URL = "<session pooler URI>"
   uv run python -m app.migrate_to_postgres --source app.db
   Remove-Item Env:DATABASE_URL
   ```

   It creates the tables, copies accounts and all activity data with their ids, and refuses
   to run against a database that already has accounts or activities. Everyone signs in again
   afterwards (sessions are not copied). Without this step the app creates empty tables on
   first start.

## 2. Fly.io (API)

Install `flyctl` and sign in (`fly auth login`). From the repository root:

1. Create the app (the name must be globally unique; if `kinetic-api` is taken, use another
   and put it in both `fly.toml` and `web/vercel.json`):

   ```powershell
   fly apps create kinetic-api
   ```

2. Create the volume for FIT files and Garmin tokens (your local `uploads/` is ~124 MB):

   ```powershell
   fly volumes create kinetic_data --region fra --size 3
   ```

3. Set the secrets (use the Vercel domain you'll get in step 3; you can set it now if you
   already know the project name, or update it later):

   ```powershell
   fly secrets set DATABASE_URL="<session pooler URI>" KINETIC_PUBLIC_ORIGIN="https://<your-project>.vercel.app" KINETIC_ORIGIN_SECRET="<random string>" KINETIC_GARMIN_TOKEN_KEY="<generated key>" --stage
   ```

4. Deploy one machine (the app keeps Garmin MFA state in memory and the volume belongs to one
   machine, so don't scale out):

   ```powershell
   fly deploy --ha=false
   ```

5. Check it: `https://kinetic-api.fly.dev/api/health` returns `{"status":"ok"}`, and any
   other `/api` URL on fly.dev returns 404 (it lacks the origin secret, as intended).
   Logs: `fly logs`.

6. Copy your existing FIT files to the volume (optional; needed for the activity charts of
   migrated activities):

   ```powershell
   tar -czf uploads.tgz uploads
   ```

   ```powershell
   fly ssh sftp shell
   ```

   In the sftp prompt run `put uploads.tgz /data/uploads.tgz`, then exit and unpack it:

   ```powershell
   fly ssh console -C "sh -c 'cd /data && tar -xzf uploads.tgz && rm uploads.tgz && chown -R kinetic:kinetic /data/uploads'"
   ```

7. Garmin: tokens are not migrated; connect Garmin again on the **Sync** page.

Password resets now run on the Fly machine:

```powershell
fly ssh console -C "python -m app.reset_password <username>"
```

Machines suspend when idle (`auto_stop_machines = "suspend"`) and resume on the next request
within a second or so; set `min_machines_running = 1` in `fly.toml` if you prefer always-on.
Fly takes daily volume snapshots; Supabase backs up the database.

## 3. Vercel (web app)

1. **Add New → Project**, import the GitHub repository.
2. **Root Directory**: `web`. The framework (Vite), build command and `dist` output come from
   `web/vercel.json`.
3. **Environment Variables**: `KINETIC_ORIGIN_SECRET` = the same string as on Fly (Production,
   and Preview if you want previews to reach the API).
4. Deploy. If the Fly app isn't called `kinetic-api`, edit the `dest` URL in
   `web/vercel.json` first.
5. Make sure `KINETIC_PUBLIC_ORIGIN` on Fly is exactly this project's production URL
   (`https://<project>.vercel.app`, or your custom domain once added, without a trailing
   slash). If you change it: `fly secrets set KINETIC_PUBLIC_ORIGIN=...` (restarts the app).

Preview deployments get other URLs, so sign-in and other POSTs from them are rejected by the
`Origin` check. That's expected; test on production or temporarily point the secret at a
preview URL.

### Custom domain (optional)

Add it under Vercel **Settings → Domains**, then update `KINETIC_PUBLIC_ORIGIN` on Fly to the
new origin. Nothing changes on Fly or Supabase otherwise.

## Automatic deploys from GitHub

After the one-time setup above, pushing to `main` deploys everything:

- **Vercel** builds every push itself (GitHub integration from step 3): `main` goes to
  production, other branches get preview URLs. Optional: **Settings → Build and Deployment →
  Root Directory → "Skip deployments when there are no changes to the root directory"**.
- **Fly.io** is deployed by `.github/workflows/fly-deploy.yml` when backend files change on
  `main` (or manually from the Actions tab). Give it a token once:

  ```powershell
  fly tokens create deploy -x 999999h
  ```

  Add the output as a repository secret named `FLY_API_TOKEN` (GitHub → repository
  **Settings → Secrets and variables → Actions → New repository secret**).
- **Supabase** needs nothing: the API creates and upgrades its own tables when it starts.
  Supabase's GitHub integration is for SQL migration files and branching, which this app
  doesn't use.

Secrets (`DATABASE_URL`, `KINETIC_ORIGIN_SECRET`, …) stay in Fly and Vercel; never commit them.

## Things to watch

- **Long-running streams**: Garmin sync and **Analyse now** stream progress through the
  Vercel proxy. They emit a line per activity so connections stay active, but if a very
  long run is cut off, rerun it (both skip work already done) or sync shorter date ranges.
- **Upload size**: FIT uploads go through the Vercel proxy too; single files are small, so
  this is only an issue for unusually large files.
- The old single-server setup (`kinetic.service`, built web app served by FastAPI) still
  works; without `DATABASE_URL` the app keeps using SQLite in `app.db`.
