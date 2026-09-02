# Prompt 1 — Master Foundation: implementation notes

## Delivered

- **Offline-first**: all calculations are pure functions in `src/engine/`;
  zero network calls. Web/PWA installs a service worker (cache-first shell).
- **Privacy / zero persistence**: student data lives only in React in-memory
  state (`src/state/store.tsx`). `smoke.mjs` asserts the shipped bundle
  contains no `localStorage` / `sessionStorage` / `indexedDB` /
  `document.cookie` references.
- **Multi-tenant config**: `src/config/types.ts` models
  University → School → Programme → CurriculumVersion → Level → Semester →
  Course, plus `GradingScale` and `ClassificationRules`.
  Active instance: `src/config/institutions/ucc.ts` (UCC · School of
  Pharmacy · PharmD). Grading scale & degree classification taken from
  https://ucc.edu.gh/main/applicants-and-students/grading-system — course
  lists left empty for the administrator to publish (nothing fabricated).
- **Navigation**: Dashboard, Calculate, Target, What-If, Flight Path,
  Next Semester, Print, Privacy + visible Refresh/Clear.
- **Calculate modes**: GPA-history (semester tables with score→grade
  derivation, direct grade pick, pending toggle) and Current-CGPA
  (baseline CGPA + total credits).
- **Foundation features all working**: target calc, classification,
  feasibility, max possible CGPA, required future GPA, Flight Path graph,
  milestone projections, what-if simulator, next-semester pilot, pending
  handling, Pilot Brief, print/reset/clear, privacy view.

## Build pipeline (skeleton, CLINICAL-RX- pattern)

- electron-builder config in `package.json` (appId `com.cgpapilot.app`,
  `asarUnpack: dist/**, build/**`, GitHub publish feed, NSIS + deb/AppImage).
- Electron `main.ts`/`preload.ts` with electron-updater + update banner.
- Capacitor 8: `capacitor.config.ts`, committed `android/` project with
  release-signing fallback (PKCS12 secret → debug fallback).
- Workflow: `docs/workflow-build-desktop.yml` (copy to
  `.github/workflows/`); push to main → release with exe/deb/AppImage/APK +
  latest.yml/latest-linux.yml.
- Cloudflare: static `dist/` + `wrangler.toml`; PWA manifest + `public/sw.js`.

## Verified locally

`typecheck` ✅ · `build:web` ✅ · `smoke` (incl. no-storage-APIs assertion) ✅ ·
`cap add android` + `cap sync` ✅ · electron-builder config parses ✅
(Electron binary packaging runs in CI — sandbox blocks the Electron CDN).

## Hooks for later prompts

- New universities: add to `src/config/institutions/` and registry.
- Published curriculum (levels/courses) populates `curriculum.levels`; the
  engine and views already key off credits/grades and will consume course
  metadata when present.
- Every new module extends `src/engine/` (pure) + a view; state stays in the
  in-memory store.
