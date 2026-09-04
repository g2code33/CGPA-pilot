# 🧭 CGPA PILOT

**Navigate Your Academic Future.**

A privacy-first, **fully offline** academic CGPA calculator, projection,
planning and visualization tool.

Initial configuration: **University of Cape Coast · School of Pharmacy · PharmD**.
The architecture is multi-tenant (university → school → programme → versioned
curriculum) and ready for additional institutions via published configuration —
student-facing, no records are stored.

## Privacy model (non-negotiable)

- **No account**, no name/ID/email, no transcript upload.
- Student entries are **temporary in-memory state only** — no `localStorage`,
  `sessionStorage`, IndexedDB, cookies, databases, or URLs carry academic data.
  Refresh or hit **Refresh/Clear** and everything is gone.
- **Every calculation runs locally on the device** — no API, cloud function,
  authentication or external AI is involved in any calculation.
- The app is **offline-first**: it always runs from the locally stored
  configuration (IndexedDB cache, falling back to the committed seed bundled
  in the app). When online it quietly checks the public configuration API for
  a **newer published version** and stores it for offline use — only
  non-personal academic configuration ever syncs, never anything a student
  typed.

## Features

| Module | What it does |
| --- | --- |
| 🧭 Dashboard | Large CGPA instrument, classification badge, target indicator, **Pilot Brief** |
| 🧮 Calculate | GPA-history mode (semester tables) and Current-CGPA mode; pending results |
| 🎯 Target | Degree-class targets, feasibility, maximum possible CGPA, required future GPA |
| 🔀 What-If | Scratchpad simulator for pending results / hypothetical semesters |
| 🛩️ Flight Path | SVG projection graph + per-semester milestone classifications |
| ▶️ Next Semester | Scenario table (A/B+/B…) and co-pilot read for the coming semester |
| 🖨️ Print | Anonymous printable/PDF Pilot Brief |
| 🔒 Privacy | Plain-language privacy statement |

UCC grading & classification rules are from the university's published
grading system (ucc.edu.gh). Course curricula are configured by the
administrator — no UCC course data is fabricated.

## Develop

```bash
npm install
npm run dev            # web (Vite) — student app at /, admin console at /admin.html
npm run dev:desktop    # Electron dev window
npx wrangler dev       # local config backend (Worker + D1) on :8787
CF_API_TARGET=http://127.0.0.1:8787 npm run dev   # dev with live backend sync
```

### Admin console

A separate application bundle at **`admin.html`** (`/admin.html`), unlinked
from the student app and `noindex`. It manages institutions and curriculum
behind **one admin passcode for every device** — created once (first-time
setup, operator token), verified by the backend, stored only as a salted
PBKDF2 digest (never plaintext) and also usable offline via the credential
synced to each signed-in device. Curriculum workflow is **Draft → Review →
Published → Archived**; only **published** curricula reach students,
published versions are locked (edit via Duplicate) and cannot be deleted.
**Dashboard → Save & Publish** pushes the catalog to the configuration
backend (Cloudflare Worker + D1 — the source of truth, passcode-session
gated) and publishes the student document in one atomic, validated step;
every device picks it up on its next open online. No student data ever
enters admin/sync. Deployment & administration guide:
**`docs/DEPLOYMENT.md`**.

## Build

```bash
npm run typecheck      # TS checks (web + electron)
npm run build:web      # static site → dist/
npm run smoke          # build + privacy/structure assertions
npm run dist           # electron-builder (exe / deb / AppImage)
npm run mobile:sync    # build web + cap sync android
```

## Ship: one `dist/`, four targets

- **Web/PWA** → build `dist/` and deploy to **Cloudflare Pages** (`cgpapilot.pages.dev` — student app + `admin.html`), with the **API-only Worker** (`cgpa-pilot`) holding D1 + the passcode-gated `/api/*`; the Pages build bakes `VITE_CONFIG_API_BASE=<worker URL>` in. Installable & offline via service worker. Full guide: `docs/DEPLOYMENT.md`.
- **Windows** → NSIS `CGPA-Pilot-Setup-<v>.exe` + `latest.yml`
- **Linux** → `cgpa-pilot-<v>-x64.deb` + `.AppImage` + `latest-linux.yml`
- **Android** → Capacitor `cgpa-pilot-<v>.apk`

Pushing to `main` triggers the GitHub Actions workflow
(`docs/workflow-build-desktop.yml` → install at `.github/workflows/`) which
builds all desktop artifacts **and** the APK and publishes them to a GitHub
Release automatically — no tags. Bump `version` in `package.json`
(`npm run release:patch`) to ship an update; the desktop app self-updates via
`latest.yml`. Optional signed APK: set the `ANDROID_KEYSTORE_*` secrets;
otherwise the release APK falls back to the debug key (still installable).

## Architecture

```
src/
  config/                      configuration-driven academic model
    types.ts                     University→School→Programme→Curriculum→Level→Semester→Course
    context.ts                   active institution context (resolved against the runtime catalog)
    runtime.ts                   in-memory catalog the app runs under (boot → cache → sync)
    apiBase.ts                   config API base (same-origin by default)
    seed/                        COMMITTED SEED — bootstrap / emergency fallback only
    institutions/ucc.ts          UCC grading & classification (ucc.edu.gh)
    curricula/ucc-pharmd.ts      UCC PharmD curriculum (draft; admin publishes courses)
  services/                    pure, offline, config-driven services
    curriculumService.ts         catalog lookups, published-curriculum selection, validation
    gradingService.ts            score↔grade↔points (per a GradingSystem)
    classificationService.ts     degree classification (per a ClassificationSystem)
    cgpaCalculationService.ts    course/semester/history/confirmed totals
    projectionService.ts         feasibility, max-possible CGPA, required GPA, flight path
    scenarioService.ts           what-if runs, next-semester scenarios
    pilotBriefService.ts         Pilot Brief text
    printService.ts              anonymous printable report
    privacyService.ts            privacy copy + reset/clear
    configCache.ts               ONLY student storage: non-personal config cache (IndexedDB + version meta)
    configSync.ts                offline-first sync: version probe → conditional download → cache
  admin/                        separate admin console bundle (admin.html)
    adminApi.ts                  backend client (auth-state / login / setup / passcode / status / publish / pull)
    catalogValidation.ts         shared validation (also enforced server-side by the Worker)
    catalogPublish.ts            publish gate + distribution payload builder (pure)
    adminConfigService.ts        catalog operations (tree, workflow, imports, reviews)
    adminStorage.ts              ONLY admin storage: catalog, session + passcode credential params, token, sync meta
worker/        Cloudflare Worker: hosts dist/ + /api (public reads, passcode-session-gated admin writes) → D1
electron/      desktop main/preload + electron-updater
android/       Capacitor project (committed; CI also scaffolds if missing)
public/        PWA manifest + service worker (bypasses /api so sync sees real network outcomes)
```

Calculation logic lives in `services/`; UI components never hard-code
university rules. Student data is temporary in-memory state; only published
non-personal curriculum configuration is stored on the device
(`configCache.ts`) and synced from the backend (`configSync.ts`) — which the
admin console publishes via the token-gated Worker API
(`docs/DEPLOYMENT.md`). The committed seed is the bootstrap fallback when a
device has never synced.
