# Prompt 5 — Grading & Degree Classification Engine: notes

## Fully configurable rules

- **Grading system** (`GradingSystem.bands`): each band defines raw score
  range (`minScore`–`maxScore`, inclusive), letter grade, grade point and
  interpretation. Editable per university default **or** per programme
  (programme `gradingSystem`/`classificationSystem` overrides; absent →
  inherit the university rules). Admin can customise a copy or reset to
  inheriting.
- **Classification system** (`ClassificationSystem.bands`): each band defines
  classification name and min/max CGPA.
- The initial seed is the official **UCC** grading scale and degree
  classification (from ucc.edu.gh) — nothing invented. "Reset to official UCC"
  restores these.
- Admin console → **Grading & Classes**: add/remove/edit bands live, with
  validation feedback and an **Apply to student app** action that writes the
  rules into the offline curriculum cache (configuration only).

## Calculation engine uses the active published config

- Student code never hard-codes grade values:
  - `gradingService.bandForScore` derives grade/points from the active
    `GradingSystem`; `maxGradePoints(system)` derives the ceiling.
  - `classificationService.classifyCgpa` is **boundary-correct**: bands are
    ordered by minimum (descending) and the first band whose minimum the
    CGPA reaches applies (3.0 → 2:1, 3.6 → First, …), robust to float error.
  - `projectionService` (feasibility, max possible CGPA, credits-to-target)
  now takes `maxPoints` from the active grading system — maximum grade-point
  calculations are config-driven.
- The Dashboard gauge (`/ max`), Target range/sliders and the Flight Path
  graph (axes, class lines derived from classification bands, slider ceiling)
  all use the configured ceiling — no hard-coded 4.0 in the UI.

## Validation (admin `validateGradingSystem` / `validateClassificationSystem`)

Grading errors block valid state:
- duplicate grades, missing grade/grade-points, invalid (negative/NaN) points,
- non-numeric/out-of-range (0–100) scores, min > max,
- **overlapping score ranges** (error); gaps and uncovered 0–100 ranges are
  warnings; points rising as scores rise is a warning.

Classification:
- missing/duplicate names, non-numeric/out-of-range (0–4) CGPA, min > max,
- **overlapping CGPA ranges** (error); gaps are warnings; top band below 4.0
  is a warning.

## Verified

`typecheck` ✅ · two-bundle build ✅ · smoke/boundary separation ✅ ·
runtime boundary matrix (3.6/3.0/2.5/2.0/1.0 edges classify correctly;
overlap & gap detectors fire) ✅ · electron build ✅ · cap sync ✅.
