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
- **Every calculation runs locally on the device** — no APIs, cloud functions,
  internet, authentication or external AI are required.
- Only published, non-personal curriculum/grading configuration ships with the
  app (cached so it works offline).

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
npm run dev            # web (Vite)
npm run dev:desktop    # Electron dev window
```

## Build

```bash
npm run typecheck      # TS checks (web + electron)
npm run build:web      # static site → dist/
npm run smoke          # build + privacy/structure assertions
npm run dist           # electron-builder (exe / deb / AppImage)
npm run mobile:sync    # build web + cap sync android
```

## Ship: one `dist/`, four targets

- **Web/PWA** → static `dist/`; deploy to **Cloudflare Pages** (build `npm run build:web`, output `dist`) — installable & offline via service worker.
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
  config/      multi-tenant institution config (grading, classification, curricula)
    institutions/ucc.ts   ← UCC School of Pharmacy PharmD
  engine/      pure, offline calculation (grades, cgpa, projections, brief)
  state/       in-memory React store (zero persistence) + derived selectors
  views/       Dashboard · Calculate · Target · What-If · FlightPath · NextSemester · Print · Privacy
electron/      desktop main/preload + electron-updater
android/       Capacitor project (committed; CI also scaffolds if missing)
public/        PWA manifest + service worker
```
