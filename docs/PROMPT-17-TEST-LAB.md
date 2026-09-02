# Prompt 17 — Admin Calculation Test Lab

A built-in, offline test harness so CGPA PILOT is mathematically trustworthy.
It lives in the **separate admin console** (🧪 Test Lab) — it never ships to
students and never touches real student data.

## Components

- `src/admin/testLab.ts` — the test engine:
  - **Fabricated test configuration**: `TEST_GRADING` (A=4.00…E=0.00 UCC-style
    scale), `TEST_CLASSIFICATION`, and `buildTestCurriculum()` which generates
    synthetic level/semester structures with configurable loads (e.g. a
    4-level 144-credit programme, a 6-level 216-credit PharmD-style programme,
    or mixed per-semester loads). All clearly prefixed `TEST`.
  - `LabCase` — a test case with inputs for every field the prompt requires:
    current CGPA, current level, completed credits, semester GPA, semester
    credits, target CGPA, future GPA, curriculum version, grade points (raw
    score → points), pending credits.
  - `Metric` — the measured value: weighted history CGPA, current-mode CGPA,
    course-derived semester GPA, classification label, required future GPA,
    target feasibility status, maximum possible final CGPA, What-If projected /
    held-average CGPA, milestone graduation projection, required next-semester
    GPA, and grade points for a raw score.
  - `runLabCase()` runs the case through the **real** student engines
    (`coreCgpaService`, `gradingService`, `classificationService`,
    `targetService`, `scenarioService`, `milestoneService`,
    `nextSemesterService`, `structureService`) and compares actual vs expected.
  - Comparison is at **full internal precision** with a 1e-6 floating-point
    tolerance — intermediates are never rounded; string metrics
    (classification label, feasibility status) compare exactly.
- `src/admin/testLabCases.ts` — **43 built-in fabricated cases** covering:
  different credit loads (10/30, 15/21/18), different semester GPAs, maximum
  GPA (ceiling finishes, score 80/100 → 4.00), minimum GPA (scores 0/49 →
  0.00), target feasibility (achievable / very-demanding / extremely-demanding
  / impossible / met tiers), pending results (whole-semester pending excluded,
  individual pending course excluded, current-mode pending credits),
  classification boundaries (3.60/3.59/3.00/2.99/2.50/2.49/2.00/1.00),
  rounding/full-precision, curriculum changes (4-level vs 6-level change the
  required GPA), different programme structures (mixed loads), What-If
  projection & trajectory, milestone graduation projections, and
  next-semester planning (including ceiling-clamp on impossible targets).
- `src/admin/views/TestLab.tsx` — the console UI:
  - **Run all tests** → grouped PASS/FAIL table with **Expected / Actual /
    Status** per case, plus engine detail (credits, points, tier reasons).
  - **Custom test case builder**: name, metric, curriculum version (the
    synthetic TEST curricula *and* real published curricula from the admin
    catalog — run cases against the actual programme rules), current CGPA,
    completed credits, level/semester, pending credits, target, future GPA,
    future credits, raw score, and the expected result (numeric or a dropdown
    for label/status metrics). Validation blocks empty/NaN expectations.
  - Custom cases are **session-only** and visibly marked fabricated; nothing
    about them is published or persisted.

## Publication gate (strengthened)

Critical validation already blocked publish in the UI (`canPublish` /
`reviewCurriculum` errors disable the Publish button). Added a
**service-layer guard** in `transitionCurriculum()`: any transition to
`published` re-runs validation and returns `ok:false` with the blocking
reasons, so no critical-invalid curriculum can ever reach students through
any code path. Blocking errors include: no courses, missing academic
year/levels/semesters, bad level/semester indexes, course placement or
programme mismatches, missing course code/name, invalid credits (≤0 or >20),
and duplicate course codes. The Curricula view now surfaces the service
reason on failure.

## Automated tests

`test/testLab.test.mjs` (5 tests) and
`test/curriculumPublishGate.test.mjs` (5 tests):
- every required category is present;
- all 43 built-in cases PASS against the real engines (a wrong expectation
  produces FAIL — verified by a sentinel);
- cases use only fabricated, `TEST`-marked data (no personal-data fields);
- curriculum structure changes produce different required GPAs;
- empty draft and zero-credit/duplicate-code curricula fail validation and
  are refused at the service boundary; a valid curriculum publishes.

**Total: 150 tests, all passing.** `npm run typecheck`, web/electron builds
and `cap sync` all green.
