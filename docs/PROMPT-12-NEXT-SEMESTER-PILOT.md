# Prompt 12 — Next Semester Pilot: notes

Tells the student what to achieve in the **immediate next semester**, using the
current level, current CGPA, target CGPA, the published curriculum (next
semester, courses, credit hours, remaining credits) and the grade-point
configuration. Everything is config-driven, credit-weighted, offline and
temporary.

## YOUR NEXT MISSION (hero card)

`nextSemesterService.planNextSemester(...)` produces:

- **Next semester** — `nextSemesterAfter(curriculum, level, sem)` advances
  Sem 1→Sem 2 and wraps to the next level's Sem 1, then reads the **active
  courses and their credit hours** from the published curriculum (inactive
  courses excluded).
- **Required GPA** — the uniform future average that keeps the
  credit-weighted trajectory on target, capped at the grading ceiling:
  `(target × totalCredits − currentPoints) ÷ remainingCredits`.
- **Target** — the classification label from the configured system
  (e.g. *First Class*) and its CGPA.
- **Effect on trajectory** — the cumulative CGPA after earning the required
  next-semester GPA, plus a status: **on-track / already-above / impossible**
  (impossible only when the required average exceeds the ceiling).
- Credits: next-semester total and remaining to graduation from the
  curriculum (manual fallback credit block when the curriculum isn't
  published, clearly noted).

## Target-grade combinations (mathematically derived)

Per-course target grades are **solved**, not guessed, from the grading bands
and each course's credits. `planNextSemester` returns alternatives
(`GradeCombo[]`), each listing `Course | Credits | Target grade | grade points`
and the semester average:

- **Focused plan** (`efficient`) — a minimum-effort greedy solve: start every
  course at the lowest band and upgrade the **highest-credit** course one band
  at a time until the required quality points are cleared. This puts strong
  grades where they carry the most weight (verified by tests).
- **Balanced plan** (`balanced`) — aim every course at the **weakest band whose
  points still meet the required per-credit average**.
- **Maximum cushion** (`top`) — top grade in every course.

Identical grade patterns are de-duplicated, and every combo's points are
asserted to clear the required points. Only grades that exist in the
configured grading system are ever used. If even all-top-grades fall short,
the mission is flagged **impossible** and no misleading combos are shown.

## "What if I get B+ in this course?"

`whatIfGrades(courses, locked, grading, requiredPoints)` lets the student lock
a grade for any course (instant recalculation): locked points are credited,
the remaining courses are re-solved with the same minimum-effort algorithm,
and the panel reports the recalculated semester average, the projected CGPA
after the semester, and whether the picks still **clear** the target (or warn
that the gap can't be covered even with top grades elsewhere).

The table is labelled **“These are planning targets, not predicted grades.”**

## Print Next Semester Plan (offline)

🖨️ calls `window.print()`; `@media print` rules hide the controls and print the
mission header and the course/target-grade table with an offline print-only
header. Inline DOM only — no network, fully offline. Nothing is saved or sent.

## Automated tests (`npm test`)

`test/nextSemester.test.mjs` — **12 tests** (**105 total**) — verify next
semester detection/level wrap, inactive-course exclusion, required GPA and
mission status (on-track / impossible / already-above), that every combo
clears the required points, the focused plan upgrading high-credit courses
first, the balanced band selection, the top combo, what-if recalculation
(locked points and clearing/shortfall), and that no grades outside the
configured system are used.

## Files

- New: `src/services/nextSemesterService.ts`, `test/nextSemester.test.mjs`,
  `docs/PROMPT-12-NEXT-SEMESTER-PILOT.md`.
- Changed: `src/views/NextSemester.tsx` (rebuilt mission card + combo table +
  what-if + print).
