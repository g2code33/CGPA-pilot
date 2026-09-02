# Prompt 6 — Core CGPA Calculation Engine: notes

The most critical mathematical component: CGPA is **credit-weighted**, computed
at **full internal precision**, and driven entirely by the **published
curriculum configuration**. Semester GPAs are *never* simply averaged.

## Two entry modes (Calculate tab)

1. **GPA History mode** — the student enters only semester GPAs, one per
   completed semester (Level 100 Sem 1, L100 S2, L200 S1, …). Individual
   course grades are **not required** and are **never inferred** from a
   semester GPA.
2. **Current CGPA mode** — the student enters their current academic level,
   last completed semester, and current CGPA. The configured curriculum
   determines credits completed/remaining; the baseline CGPA is converted
   back to quality points for projections.

Optional per-semester course detail can still be expanded in history mode;
when real graded courses exist they take precedence over the aggregate GPA.

## The math (unrounded until display)

For every semester term:

```
Quality Points (QP) = GPA × Semester Credit Hours
CGPA                = Σ Quality Points ÷ Σ Applicable Credit Hours
```

- Credit loads come from the **published curriculum**
  (`structureService.curriculumSemesters` → active courses' credit hours),
  with an optional manual per-semester override.
- Terms with no data (blank GPA, no graded courses) contribute **zero**
  credits and zero points — they never dilute the CGPA.
- **Pending** courses (results not out) are excluded from totals and reported
  separately as pending count/credits.
- All intermediate values stay at native floating-point precision; the UI
  rounds only what is displayed (`fmt2`).

### Current mode baseline

`QP = currentCGPA × completedCredits`, where completed credits are the sum of
curriculum semester credits through the selected level/semester
(`progressThrough`, inclusive). If the published curriculum carries no credit
data, the student enters completed credits manually.

## Files

- `src/services/structureService.ts` — curriculum → semester slots with credit
  loads; `progressThrough(curriculum, level, semester)` splits completed vs
  remaining slots/credits; inactive courses excluded; `hasCreditData` gates
  curriculum-derived vs manual credits.
- `src/services/coreCgpaService.ts` — the engine:
  - `semesterCreditHours` — override → graded-course credits → configured.
  - `semesterTerm` — per-semester QP/GPA/source (`'gpa'` history aggregate,
    `'courses'` derived from graded courses, `'none'` empty). Course detail
    wins when present; a semester GPA is only ever weighted, never decomposed
    into grades.
  - `weightedCgpa(semesters, grading, configuredCreditsFor?)` — ΣQP ÷ Σcr.
  - `currentModeRecord(baseline, curriculumCompletedCredits)` — baseline QP.
  - `computeSnapshot(state, grading, …)` — the single entry point views use;
    switches on mode.
  - `maximumFinalCgpa(qp, done, remaining, grading)` — ceiling from the active
    grading system's top band (`maxGradePoints`), never hard-coded 4.0.
  - `requiredFutureGpaPrecise(qp, done, remaining, target)` —
    `(target×(done+remaining) − QP) / remaining`; negative ⇒ target already
    exceeded. `targetFeasible(req, grading)` checks against the ceiling.
- `src/state/studentState.ts` — `AcademicState { mode, semesters[], baseline,
  targetCgpa, plannedNextCreditHours }`; semesters hold GPA + optional credit
  override + optional courses.
- `src/state/store.tsx` — in-memory-only reducer; `addSemester` auto-progresses
  L100S1 → L100S2 → L200S1 …; nothing persisted.
- `src/state/derived.ts` — `useDerived()` runs the engine against the active
  config/curriculum and exposes `snapshot`, back-compat `record`
  (`points/creditHours/cgpa/pending*`), per-semester `term`s, `slots`,
  `progress`, `classBand`, `maxPoints`.
- `src/views/Calculate.tsx` — mode toggle; history GPA/credits entry with
  curriculum loads shown; current-mode level/semester/CGPA + curriculum
  completed/remaining summary.
- `src/views/Target.tsx` — remaining credits default from curriculum progress
  (current) or total programme − completed (history); uses the precise engine
  functions for required GPA / max final / feasibility.
- `src/views/NextSemester.tsx` — next-semester credits prefill from the next
  curriculum slot.

## Automated tests (`npm test`)

`test/run-tests.mjs` bundles the TypeScript services with esbuild (already
present via Vite — no added dependency) and runs them on Node's built-in test
runner. `test/coreCgpa.test.mjs` — **31 tests** — verifies:

- credit-weighting differs from a naive GPA average when loads differ;
- equal loads reduce to the ordinary average;
- QP = GPA × credits and CGPA = ΣQP ÷ Σcredits;
- full internal precision (repeating decimals carried; rounding only at
  display);
- history mode weights by **configured curriculum credits**; override
  precedence; blank middle semesters don't dilute;
- a semester GPA never materialises course grades;
- course-derived terms (grade or score), precedence over GPA, pending
  exclusion, inactive-course exclusion from configured loads;
- current-mode baseline QP from curriculum credits, manual fallback;
- `progressThrough` completed/remaining slot & credit split;
- maximum final CGPA at the configured ceiling (incl. a non-4.0 scale);
- required future GPA solves the weighted equation; feasibility boundary;
  negative requirement when target already exceeded;
- `computeSnapshot` for both modes;
- UCC score→grade and degree-classification boundaries (3.6/3.0/2.5/2.0/1.0).

## Privacy / offline

Student academic data remains **in-memory only** — the engine is a set of pure
functions over React state; no persistence was added. All rules and credit
loads come from the cached/bundled published configuration; fully offline.
