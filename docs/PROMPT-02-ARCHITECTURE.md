# Prompt 2 — Multi-University Data Architecture: implementation notes

## Hierarchy implemented

`University → School/College → Programme → Curriculum Version → Level → Semester → Course`

Defined in `src/config/types.ts`:

- **University**: `name`, `country`, grading system, classification system, schools.
- **School**: `name`, `universityId`.
- **Programme**: `name`, `schoolId`, `duration` (years/expectedLevels/label), curriculum version ids.
- **CurriculumVersion**: `versionName`, `effectiveAcademicYear`/`effectiveDate`, `status` (`draft` | `published`), levels.
- **Level** → **Semester** → **Course**.
- **Course**: `code`, `name`, `creditHours`, `level`, `semester`, `programmeId`, `curriculumId`, `status` (`active`|`inactive`), `core`. `FlatCourse` adds denormalized context for easy queries.

Configured instance only: **UCC · School of Pharmacy · PharmD**
(`src/config/institutions/ucc.ts`, `src/config/curricula/ucc-pharmd.ts`).
Grading/classification come from ucc.edu.gh; the PharmD curriculum is held in
`draft` with empty levels — **no courses invented**; the admin publishes real data.

## Services (calculation logic separated from UI)

All services are pure/offline and read configuration as arguments — no
university values are hard-coded in components:

| Service | File | Responsibility |
| --- | --- | --- |
| curriculumService | `src/services/curriculumService.ts` | catalog lookups, active/published curriculum selection, flattening/credits, validation, remote refresh (optional) |
| gradingService | `src/services/gradingService.ts` | score↔grade↔points conversions per a `GradingSystem` |
| classificationService | `src/services/classificationService.ts` | degree classification per a `ClassificationSystem` |
| cgpaCalculationService | `src/services/cgpaCalculationService.ts` | course/semester/history totals, confirmed record |
| projectionService | `src/services/projectionService.ts` | feasibility, max possible CGPA, required future GPA, flight path, milestones |
| scenarioService | `src/services/scenarioService.ts` | what-if runs, pending collection, next-semester scenarios |
| pilotBriefService | `src/services/pilotBriefService.ts` | the Pilot Brief text |
| printService | `src/services/printService.ts` | anonymous printable report model |
| privacyService / reset | `src/services/privacyService.ts` | privacy copy, reset session, clear everything |

`src/state/derived.ts` is the single hook that resolves the active context
(grading/classification/curriculum) and exposes the services to views.

## Offline curriculum cache

`src/services/configCache.ts` is the **only** module allowed to use persistent
storage, and it stores **only published, non-personal configuration**
(universities, grading rules, curricula). It seeds from the bundled
configuration, validates the cache, and falls back to the bundle when offline
or malformed. Student calculations never make network requests; the optional
remote refresh (`refreshFromRemote`) only pulls curriculum documents.

## Privacy enforcement (smoke test)

`smoke.mjs` now enforces architecture, not just build output:

- storage API *calls* appear only in `configCache.ts` (word in comments/prose
  is code-stripped and ignored);
- `configCache.ts` never imports student state types;
- views contain no hard-coded grading points/score tables.

Student data remains purely in-memory (`src/state/store.tsx`, using
`studentState.ts` models) — refresh/Reset/Clear destroys it.

## Verified

`typecheck` ✅ · `build:web` ✅ · `smoke` (build + source architecture checks) ✅ ·
`build:electron` ✅ · `cap sync android` ✅.
