# Prompt 4 — Detailed Curriculum Manager: implementation notes

## Course operations (every semester)

In `adminConfigService.ts` + `CurriculumEditor.tsx`:

- **Add course** (`addCourse`), **edit** (inline code/name/credits + core +
  active/inactive), **remove** (`removeCourse`, confirmed),
  **reorder** (`reorderCourse` up/down within the semester),
  **duplicate** (`duplicateCourse` — copies name/credits, clears code so the
  admin supplies a unique code, inserted right after the source).
- **Bulk entry** (`parseBulkCourses` + `bulkAddCourses`): paste one course per
  line, accepting `CODE<TAB>Name<TAB>Credits`, `CODE, Name, Credits`,
  multi-space separated, and single-space heuristic (`PHA 111 Pharmaceutics 3`,
  `PHA211 Pharmaceutics 3`). Live preview marks each row ready/needs-fixing;
  only valid rows (code + credits > 0) are added; zero/negative-credit rows
  are rejected.

## Auto-calculated totals

`curriculumStats(version)` returns semester → level → programme totals,
rendered live:
- semester total credits + course count (on each semester card),
- level total credits + course count (on each level header),
- **programme total credits**, total courses, active courses, levels (hero bar),
- curricula list shows each version's active course count and total credits.

Inactive courses are excluded from credit totals (and from the student
preview), but remain in the records.

## Curriculum preview

`CurriculumPreview.tsx` renders the version exactly as students will see it
— only **active** courses, grouped by level/semester with per-semester
credits and the programme total. Reachable via "Curriculum preview" in the
editor; read-only.

## Validation (`reviewCurriculum`)

Detects and blocks publishing on:
- missing course name, missing course code,
- invalid credits (non-numeric, **zero/negative**, or > 20),
- **duplicate course codes** across the version,
- empty semesters (warning) and no courses at all (error),
- **invalid level** (non-sequential/duplicate level index, missing label),
- **invalid semester** (non-sequential semester index),
- course placements that don't match their stored level/semester or programme,
- missing academic year.
Errors block the Draft→Review→Publish flow; warnings show but don't block.

## Versioning

- Creating a version suggests a name like **`UCC PharmD — 2026/27`**
  (`suggestVersionName`); next year's entry becomes `UCC PharmD — 2027/28`.
- Every version is a separate document with its own id — a new version
  **never overwrites** a historical one.
- Publishing auto-archives the previous published version of the same
  programme, so exactly one published version is active per programme for
  students; older versions remain stored (archived) and restorable via
  Duplicate/Restore.

## Data discipline

No curriculum data is invented: the UCC PharmD scaffold (Levels 100–600)
ships with empty course lists; the admin enters the real, verified UCC
School of Pharmacy curriculum using the tools above.

## Verified

`typecheck` ✅ · `build:web` (student + admin bundles) ✅ · `smoke` (boundary
& separation checks) ✅ · parser format matrix ✅ · `build:electron` ✅ ·
`cap sync android` ✅.
