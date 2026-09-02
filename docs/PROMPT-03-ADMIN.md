# Prompt 3 — Admin Foundation: implementation notes

## Separate admin application

- **Separate entry**: `admin.html` → `src/admin-main.tsx`, producing its own
  bundle (`assets/admin-*.js`). The student entry (`index.html`) never imports
  the admin code (enforced by `smoke.mjs`). It ships in the same static
  package (`dist/`) but is an unlinked console at `/admin.html` with
  `noindex` and a passcode gate.
- **Persistent admin auth** (allowed for admins): `src/admin/adminStorage.ts`
  is the admin counterpart to the student `configCache`. It stores only the
  admin catalog (non-personal config) and a **SHA-256-hashed** passcode plus a
  local session flag. Factory passcode `pilot-admin` (change on first run).
- Admin storage is the **only** storage-using module under `src/admin/`, and
  it never imports student state — synchronization is one-way (config →
  student); no student academic data is ever read or uploaded. Enforced by
  smoke tests.

## Management features

| Area | Operations |
| --- | --- |
| Universities | add, edit (name/short/country), activate/deactivate, delete (only when no schools) |
| Schools/Colleges | add, edit, activate/deactivate, delete (only when no programmes) |
| Programmes | add, edit (name/short/years), activate/deactivate, delete blocked when a published curriculum exists |
| Curriculum versions | create (level scaffold), edit, **duplicate**, review, **publish**, archive, delete |
| Academic structure | levels, semesters, courses (code/name), credit hours, core flag, active/inactive |

All entities gained a `status: active | inactive` field. All destructive
actions and activations/deactivations route through `confirmThen(...)`.

## Workflow: DRAFT → REVIEW → PUBLISHED → ARCHIVED

- `src/admin/adminConfigService.ts` enforces legal transitions
  (draft⇄review, review→published, published→archived, archived→draft).
- **Published versions are locked** — no structure edits, and deletion is
  refused ("archive instead"). To change a published curriculum an admin
  **Duplicates** it into a new draft.
- Publishing a version automatically **archives** other published versions of
  the same programme (only one live published version per programme).
- **Review** (`reviewCurriculum`) blocks publishing on errors: missing
  academic year, empty curricula/courses, missing course codes/names, invalid
  credit hours (1–20), duplicate course codes; warnings for empty semesters.

## Initial configuration

UCC · School of Pharmacy · PharmD seeded with **Levels 100–600** (two
semesters each), **no courses** — the draft scaffold contains empty course
lists until the admin enters verified data. It stays in DRAFT and is invisible
to students until published. The student `getActiveCurriculum()` now returns
**only published** versions (previously fell back to the newest version).

## Offline distribution

- `buildDistribution()` produces a versioned document
  (`cgpa-pilot-curriculum-<date>.json`) containing universities and
  **published** curricula only. The admin can download it (to bundle into a
  future release/host it), or **Apply to this device** to write it straight
  into the student `configCache` (that cache falls back to the bundled copy
  offline, so students keep using their last valid published curriculum).
- Import validates the document format before replacing the admin catalog.
- The distribution payload is non-personal configuration only; there is no
  student data path in the admin or sync code.

## Verified

`typecheck` ✅ · `build:web` (two entries) ✅ · `smoke` (26 checks incl. storage
boundaries, separate bundles, no student-state imports) ✅ · `build:electron` ✅
· `cap sync android` (admin.html present in APK assets) ✅.
