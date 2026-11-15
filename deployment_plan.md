## Recommended architecture

```text
Mobile app / browser
        ↓ HTTPS
Cloudflare DNS + WAF + Tunnel
        ↓
Ubuntu: NiceGUI + FastAPI
        ↓
PostgreSQL + private file storage
```

**Assumption:** anyone can register, but each user’s activities, GPS routes and health-related data are private by default. Public profiles or sharing would be separate, opt-in features.

**Important:** this is a substantial app change, not just a deployment change. The current `models.py` has no user ownership, and `api.py` exposes shared data without authentication.

## Step-by-step plan

### 1. Define the public service

Decide the initial registration rules, supported countries, data retention, storage limits and whether sharing is allowed. Start with private accounts and no public activity sharing.

### 2. Add accounts and authentication

- Use an established authentication provider or library for registration, email verification, login, password reset and session management.
- Protect both NiceGUI pages and FastAPI endpoints, including WebSocket connections.
- Use secure, HTTP-only cookies, session expiration and revocation, and CSRF protection.
- Replace the hard-coded secret in `main.py` with a protected environment secret.
- Provide account export and deletion flows.

### 3. Isolate every user’s data

- Add a user table and ownership to activities, friends, files and integrations.
- Scope **every** query and mutation—including maps, statistics, child activities, laps and UI callbacks—to the authenticated user.
- Never trust a user ID supplied by the client as proof of ownership.
- Add tests proving user A cannot read, change or delete user B’s data, even by guessing IDs.
- Migrate your existing data to your own account after taking a backup.

### 4. Redesign Garmin sync

The current Garmin email and tokens are shared globally in `sync.py` and `garmin_sync.py`.

- Disable public Garmin sync until it supports isolated, encrypted per-user credentials and tokens.
- Verify Garmin’s permitted integration and credential-handling requirements before offering it publicly.
- Add per-user disconnect and token deletion; prevent one user’s sync or logout affecting another.

### 5. Harden uploads and processing

- Replace client-provided filenames with generated names; validate file type and enforce upload and processing limits.
- Store uploads outside publicly served paths, organized by owner.
- Handle malformed FIT files safely and limit concurrent imports and Garmin sync jobs.
- Test uploads, authorization, error handling and storage exhaustion.

### 6. Move to production data storage

1. Install PostgreSQL on Ubuntu, accessible only locally.
2. Add versioned database migrations and move the application from SQLite to PostgreSQL.
3. Keep uploads and configuration in persistent directories outside the code checkout.
4. Back up PostgreSQL and uploads together; encrypt backups off-machine and regularly test restoration.

### 7. Prepare Ubuntu and deploy

1. Install security updates, Python 3.12+, PostgreSQL and `uv`.
2. Run the app under a dedicated, minimally privileged service account.
3. Install locked dependencies and configure secrets outside the repository.
4. Adapt `kinetic.service`; keep the app listening on localhost.
5. Verify migrations, service restart, logs, database connectivity and backups before public launch.

### 8. Publish through Cloudflare

1. Point a Cloudflare-managed domain at a **Cloudflare Tunnel** routing to the local app.
2. Unlike the private plan, **do not require Cloudflare Access for the whole site**: public users authenticate in the app. You may still use Access for administrator-only tools.
3. Enable suitable WAF and rate-limit rules for registration, login, reset, uploads and API abuse.
4. Do not cache authenticated pages, API responses or personal data. Test HTTPS, WebSockets, mobile reconnects and upload limits.
5. Keep the origin private; do not forward the app port from your router. See [Cloudflare Tunnel routing](https://developers.cloudflare.com/tunnel/concepts/routing/).

### 9. Address privacy and legal requirements

Before accepting real users:

- Publish a privacy notice and terms; identify data processors and retention periods.
- Review applicable privacy laws with qualified advice. GPS routes and heart-rate data are sensitive; health data may require an additional legal basis under GDPR.
- Define deletion, breach-response and backup-retention procedures.
- Review third-party services used by maps, fonts, email, analytics and authentication.

See the European Commission’s [guidance on legal grounds for processing](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/legal-grounds-processing-data_en).

### 10. Deliver the mobile app

1. Make the UI responsive and add a web app manifest and icons.
2. Support installation from the browser on Android and **Add to Home Screen** on iPhone.
3. For an Android file, build a signed APK with [Bubblewrap](https://developer.android.com/develop/ui/views/layout/webapps/guide-trusted-web-activities-version2), publish the required `assetlinks.json`, and securely back up the signing key.
4. Check [Android developer verification requirements](https://developer.android.com/developer-verification/guides) before distribution.
5. For iPhone, use the installed web app unless you choose an Apple-supported native distribution route; an IPA cannot generally be distributed like an APK.

### 11. Test and launch gradually

- Test registration, verification, login, isolation, password reset, uploads, sync, deletion and recovery with multiple accounts.
- Perform a security review and load test before opening registration.
- Launch with a small pilot, monitor errors and resource usage, then expand.
- Monitor uptime, disk space, database health and abuse; plan for your home internet, power or machine failing. Cloudflare cannot keep the app available when the Ubuntu origin is offline.

No changes have been made yet.
