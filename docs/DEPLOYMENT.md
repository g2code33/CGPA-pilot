# Backend deployment — Cloudflare Worker + D1 (configuration API)

CGPA PILOT is **offline-first** but **backend-persisted**: the admin console
publishes the academic configuration to a Cloudflare **Worker** that stores it
in **D1** (the source of truth), and student devices sync it into their local
cache (IndexedDB) on every open — then keep working fully offline from that
cache. The committed seed (`src/config/seed/admin-catalog.json`) is only the
**bootstrap / emergency fallback**, never the normal persistence path.

This deployment uses **two Cloudflare projects** from this one repo:

- **Cloudflare Pages `cgpapilot`** → hosts the static site (student app +
  admin console) at **`https://cgpapilot.pages.dev`** — the URL students and
  the admin already use.
- **Cloudflare Worker `cgpa-pilot`** → the **API only** (`/api/*`, D1 +
  passcode auth) at `https://cgpa-pilot.<account>.workers.dev`. When served
  from `cgpapilot.pages.dev` the app uses that API address automatically
  (baked into the code); `VITE_CONFIG_API_BASE` is an optional override.

```
Pages (cgpapilot.pages.dev)            Worker (cgpa-pilot.<acct>.workers.dev)
┌──────────────────────────────┐       ┌────────────────────────────────────┐
│ student app  +  admin.html   │ ──/api──►  session/token-gated admin ──► D1 │
│ (built from this repo, dist/) │ ◄─/api──  public config reads    (authoritative)
└──────────────────────────────┘       └────────────────────────────────────┘
```

(A single-origin alternative — Worker serving the site too — is available by
re-adding the commented `[assets]` section in `wrangler.toml`; then the API
is same-origin and no address is needed at all.)

**There is exactly ONE admin.** The admin console is opened with a single
passcode — the same passcode signs in on every device. The backend stores only
a salted PBKDF2-SHA256 digest of that passcode (never the plaintext), and
issues server-signed session tokens to devices that verify it.

**Student privacy is preserved**: the API only ever serves the published,
non-personal catalog. Student academic data is never sent anywhere, and the
app works identically with the network unavailable (last cached config, or
the bundled seed on a truly fresh device).

---

## 1. One-time setup (owner, ~10 minutes)

Everything below can be done in the Cloudflare dashboard (no terminal
needed) — CLI equivalents in parentheses.

**A. D1 database** — dashboard → **D1** → *Create database*
`cgpa-pilot-config` → copy the **Database ID (UUID)** → paste it into
`wrangler.toml` (`database_id`) and commit.
(Already done in this repo: the UUID is committed.) Then create the tables —
dashboard → D1 → `cgpa-pilot-config` → **Console** → paste the SQL from
`worker/migrations/0001_init.sql` + `0002_admin_auth.sql` → **Execute**.
(Or: `npm run db:init`.)

**B. Worker (API only)** — dashboard → **Workers & Pages** → *Create* →
**Worker** named `cgpa-pilot`. On the worker: **Settings → Builds** →
*Connect* this repo (branch `main`) with build command
`npm ci --ignore-scripts`. The D1 binding (`CONFIG_DB`) comes from
`wrangler.toml`. Then **Settings → Variables and Secrets** → add the
encrypted secret **`ADMIN_TOKEN`** (any long random string — keep it safe;
it's only needed for first-time passcode setup + automation).
(Or: `npx wrangler login && npx wrangler secret put ADMIN_TOKEN && npx wrangler deploy`.)
Every push to `main` then auto-redeploys the API.

**C. Pages project `cgpapilot` (the site)** — dashboard → **Pages** →
`cgpapilot` → **Settings → Git integration** → this repo, branch `main`,
build command `npm ci --ignore-scripts && npm run build:web`, output
directory `dist`. Redeploy. No environment variable is needed: when served
from `cgpapilot.pages.dev` the app automatically uses the production API
address baked into the code. (`VITE_CONFIG_API_BASE` remains as an optional
override for other deployments or an API move.) The app + admin console
talk cross-origin to the Worker (its CORS already allows the
`authorization` header).

**D. First-time passcode + migration** — open
`https://cgpapilot.pages.dev/admin.html` → **First-time setup** (paste the
`ADMIN_TOKEN` secret, choose the ONE admin passcode) → **Dashboard →
💾 Save & Publish** (one-time upload of your catalog). Done.

After this:

- Students: `https://cgpapilot.pages.dev/` — as before, plus automatic
  config sync from the backend.
- Admin: `https://cgpapilot.pages.dev/admin.html` — passcode sign-in on any
  device.
- Admin *configuration* changes never need a deploy (Save & Publish);
  only *app code* changes trigger the Pages/Worker rebuilds on push.

> **Single-origin alternative:** re-add the commented `[assets]` section to
> `wrangler.toml` and drop the Pages env var — the Worker then serves the
> site **and** the API from one origin (`https://cgpa-pilot.<acct>.workers.dev`).
> Use this if you ever abandon the Pages project.

## 2. First-time passcode setup + migrating your current admin data (one-time)

If you have real data in the admin console's browser storage today:

1. Open the admin console (online, from the deployed site).
2. The login screen detects "backend configured, no passcode yet" and shows
   **First-time setup**: paste your `ADMIN_TOKEN` (the operator secret) and
   choose the ONE admin passcode (min 8 characters). Click
   *Create passcode & sign in*. Setup is one-time — a second attempt is
   rejected, and the passcode is the only thing you'll need on any device
   from now on.
3. On **Dashboard** click **💾 Save & Publish** (the passcode session is
   enough — no token field needed). The **first-time migration** callout
   explains this; after it, the backend holds your catalog (version 1) and
   every student device receives it on its next online open.

From then on the **backend is authoritative**: fresh admin devices sign in
with the same passcode and load the backend catalog automatically, and admin
devices that fall behind are offered a pull.

> **Device that predates the passcode (old per-device passcode)?** It keeps
> working *offline* with its old passcode as a transition; the moment it
> signs in online with the new passcode, the old digest is retired.

## 3. Day-to-day admin workflow

- **Sign in** to the admin console with the passcode — on any device.
  Sessions last 30 days; while a session is valid the console works without
  re-entering the passcode. If the device is offline, sign-in verifies
  against the credential synced to that device, so it works without
  internet too (a brand-new offline device has nothing to verify against —
  connect it once).
- **Edit** anything in the admin console — every edit autosaves to the
  admin device (local working copy) as before.
- **Publish a curriculum** (Draft → Review → Published) in the Curricula
  views — that marks the version as the active published one *in the
  catalog*.
- **Dashboard → 💾 Save & Publish** — one click, one atomic backend
  operation:
  - stores the full admin catalog (all versions, trash, branding), and
  - publishes the student document (universities + **published** curricula +
    branding) with a new monotonic `version`.
  - Clear success shows the new versions; validation failures show the
    blocking issues and nothing is published (client-side gate **and**
    server-side gate — same shared validation module).
- Students (and other admin devices) pick up the new version on their next
  open while online; mid-session they get a "Reload to apply" banner.
- **Change the passcode** (Dashboard → *Change admin passcode*, current +
  new) — online only; the backend rotates the salted digest, so the new
  passcode immediately works everywhere and the old one stops.

There is **no** file export, Git commit, or redeploy step in this loop.
(Backup file download/upload remains available on the Dashboard as a local
utility, and `npm run seed:apply` remains a *development* tool for updating
the committed bootstrap seed — not the publishing workflow.)

## 4. Local development

```bash
npm install --ignore-scripts
npx wrangler dev                 # Worker + local D1 on http://127.0.0.1:8787
# (local D1: npx wrangler d1 execute … --local, or it starts empty)

CF_API_TARGET=http://127.0.0.1:8787 npm run dev
# Vite dev server proxies /api/* to the Worker → admin Save & Publish and
# the student sync work exactly as in production.
```

Without `CF_API_TARGET`, the dev app reports "backend unreachable /
not configured" and runs purely from the local cache + seed — which is the
normal offline behavior.

## 5. API reference

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /api/health` | — | liveness |
| `GET /api/config/meta` | public | `{ version, updatedAt }` or `404 no-config-published` — the cheap version probe |
| `GET /api/config/latest` | public | the full published document `{ format, version, updatedAt, payload }` |
| `GET /api/admin/auth-state` | public | `{ configured, hasCredential }` — lets the login screen choose *sign in* vs *first-time setup*; discloses nothing else |
| `POST /api/admin/login` | passcode in body | body `{ passcode }` → `{ session, expiresAt, credential }` (the PBKDF2 params for offline sign-in — never the plaintext); `404 no-credential`, `401 invalid-passcode` |
| `POST /api/admin/setup` | **operator token** | body `{ passcode }` → one-time creation of the single passcode + session; `409 credential-exists`, `400 weak-passcode` |
| `POST /api/admin/passcode` | session/token | body `{ current, next }` → rotate the passcode; `401 invalid-current` |
| `GET /api/admin/status` | session/token | versions currently stored on the backend |
| `GET /api/admin/catalog` | session/token | the authoritative admin catalog |
| `POST /api/admin/publish` | session/token | body `{ catalog, note? }` → persists catalog + publishes student config atomically; `400 { issues }` on validation failure |

Auth, in priority order:

1. **Session token** — `Authorization: Bearer cps1.<expiryMs>.<hmac>`,
   returned by `login`/`setup`. The HMAC is SHA-256 keyed with the
   `ADMIN_TOKEN` secret, so a session can only be issued or forged by the
   Worker itself; expiry is embedded and enforced (default TTL 30 days,
   `SESSION_TTL_MS` env for tests).
2. **Operator token** — `Authorization: Bearer <ADMIN_TOKEN>` (or
   `x-admin-token` header), constant-time compared. This is what `setup`
   requires (no session exists yet) and what automation may keep using.

If `ADMIN_TOKEN` is not set, admin endpoints return `503` (fail closed).
Body limit 15 MB.

## 6. Fallback matrix (what users see)

| Situation | Student device behavior |
| --- | --- |
| Online, backend has a newer version | Downloads, validates, stores, runs the new config (before first paint when fast enough) |
| Online, up to date | Meta probe only (a few KB), runs cached config |
| Offline | Zero network; runs the last cached config from IndexedDB |
| Fresh device, offline | Runs the committed seed bundled in the app |
| Backend unreachable / not deployed | Same as offline (graceful), last cache or seed |
| Backend serves a corrupt payload | Rejected by validation; last cache kept, flagged in logs/console |
| Local cache cleared (Privacy → Restart) | Falls back to seed until the next online sync |

| Situation | Admin device behavior |
| --- | --- |
| Backend ahead of this device | Auto-adopts the backend catalog on login (backend is authoritative) |
| Backend empty, this device has data | First-time migration callout (Save & Publish once) |
| Backend unreachable, device already signed in | Signs in **offline** against the synced credential (same passcode); full local console works; publish deferred until online |
| Backend unreachable, brand-new device | Cannot sign in (nothing to verify against) — clear message; connect once to sign in |
| Session expired | Dashboard offers *Sign in again*; the passcode session is re-issued on login |
| No session and no operator token saved | Reads still show public state; writes disabled with a clear message |

## 7. Security notes

- **Only the published catalog is public.** Students cannot read drafts,
  trash, the admin passcode, or anything student-specific (nothing
  student-specific exists in this service at all).
- **One admin, one passcode, never stored in plaintext.** D1 holds a single
  row with a 16-byte random salt and the PBKDF2-SHA256 digest (12,000
  iterations — sized to fit the Workers Free plan's ~10 ms CPU time per
  request; online brute force is network-limited per guess, and the
  ≥8-character policy + salt defend the offline path). Devices that sign in
  store only the *credential params* (salt + digest) — to verify the same
  passcode **offline** — never the passcode itself. Changing the passcode
  rotates the digest, so a stolen old-device credential is useless after a
  change. If the Worker moves to the Paid plan, `PBKDF2_ITERATIONS` can be
  raised again (each stored credential records its own iteration count).
- **Writes require a valid credential**: a server-signed session token
  (HMAC-SHA256 keyed by the `ADMIN_TOKEN` secret — unforgeable without the
  secret, expiry embedded) or the raw operator token. `setup` requires the
  raw token (no session exists yet) and is one-time (409 afterwards).
- **The operator token stays useful for automation**; for everyday use the
  passcode session is all a device needs, so a lost/lapsed token is not a
  lockout (the token can be rotated any time with
  `npx wrangler secret put ADMIN_TOKEN` — existing sessions remain valid
  until they expire, re-issue on next login).
- **Server-side validation** mirrors the client gate; a tampered or buggy
  client cannot publish a broken catalog.
- The D1 database is not publicly readable — only through the Worker's
  gated endpoints.
- No cookies, no session tracking. The public endpoints are cache-less
  (`cache-control: no-store`) so a stale CDN edge never serves old config.

## 8. Operations

- **View data**: `npx wrangler d1 execute cgpa-pilot-config --command="SELECT version, updated_at FROM published_config"`
- **Roll back a bad publish**: republish the previous catalog (from an admin
  backup file or another admin device) — it becomes the next version; clients
  only ever move forward by version.
- **Reset everything**: `DROP TABLE published_config; DROP TABLE admin_catalog; DROP TABLE admin_auth;`
  then re-run the migration. Dropping `admin_auth` returns the console to
  *first-time setup* (the passcode must be created again). Devices keep
  their local caches and simply re-sync the new v1 on the next open.
- **Rebuild the bootstrap seed** (dev only): export a backup from the admin
  console and run `npm run seed:apply -- file.json`, commit
  `src/config/seed/admin-catalog.json` — this updates the *fallback* that
  fresh offline devices boot from.
