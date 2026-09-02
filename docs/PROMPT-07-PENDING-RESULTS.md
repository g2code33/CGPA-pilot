# Prompt 7 — Pending Results System: notes

Students can flag that results are **not yet available**. A pending result is
**never treated as a known grade** — it is excluded from the confirmed CGPA,
while its known credit hours (from the administrator-configured curriculum)
drive clearly-labelled projections.

## The three statuses

`ResultStatus = 'complete' | 'pending' | 'not-entered'`

- **Complete** — a confirmed GPA/grade is entered; counts in the CGPA.
- **Pending** — results not released. Shows **“Result Pending”** (a 3-credit
  course or a whole semester); no A/B+/B/… is ever assumed or displayed as a
  grade. Excluded from the confirmed CGPA; credits used only in projections.
- **Not entered** — the student simply hasn't provided anything yet.

Helpers: `coreCgpaService.semesterStatus(sem)` and `courseStatus(course)`.

## Where a result can be pending

1. **Individual course** (Calculate → Course detail): the ⏳ button marks a
   course pending. Its grade/score inputs and grade chips are disabled; the
   row reads **Pending**. It yields zero points and contributes no confirmed
   credits, but its credits are counted as pending.
2. **Whole semester** (GPA History mode): a **⏳ Pending / ✓ Released** toggle
   on the semester card. While pending the card shows **Result Pending**, the
   GPA/credits inputs are hidden, and the term's *known* credit load
   (curriculum → override → entered courses) is reported as pending.
3. **Current CGPA mode**: a “Pending-result credits” field for credits whose
   results are pending within the completed period. The reported current CGPA
   reflects released results only; those credits are subtracted from the
   confirmed base and projected separately.

Marking pending never deletes entered values — toggling to *Released* restores
them. Pending data is **temporary in-memory React state only**; there is no
storage call anywhere in the pending path (no localStorage / sessionStorage /
IndexedDB / cookies), and it is cleared on refresh.

## Projections (`src/services/pendingService.ts`)

Pure function `pendingProjection({ confirmedPoints, confirmedCreditHours,
pendingCreditHours, pendingCount, target }, grading, classification)` returns:

- **Confirmed academic position** — `confirmedCgpa` / `confirmedClass` over
  released credits only.
- **Possible result range** — worst → best.
- **Best-case projection** — every pending credit earns the **top** grade
  (`maxGradePoints`, derived from the active grading system — never hard-coded
  4.0).
- **Worst-case projection** — every pending credit earns the **floor** grade
  (0.0). Also a distinct **minimum-pass** scenario using
  `minPositiveGradePoints` (weakest passing grade, e.g. UCC D = 1.0).
- **Effect of pending credits** — `pendingCreditHours`, `pendingCount`, and the
  absolute **swing** between best and worst.
- **Target feasibility under possible outcomes** — `requiredPendingGpa` solves
  the exact credit-weighted equation `target × total = confirmedPoints + req ×
  pendingCredits`, giving one of:
  - **guaranteed** — even the worst case meets the target,
  - **possible** — within range (states the required pending average; notes
    when a minimum pass suffices),
  - **unreachable** — even top grades on the pending credits fall short.

All values are unrounded; the UI rounds only for display (`fmt2`).

## UI

- `src/components/PendingProjection.tsx` — the labelled projection panel
  (Confirmed / Worst / Best cards, a range bar with the confirmed marker, and
  the colour-coded target-feasibility line). Every projection is stamped
  “Projection — depends on results not yet released”. Shown on the Dashboard
  and Calculate tab whenever pending credits exist.
- Calculate totals card is retitled **Confirmed CGPA** and shows the
  projected worst→best spread once results are released.
- Target tab gains a pending-specific card (best/worst vs the target).
- What-If remains the interactive grade scratchpad for pending courses.

## Automated tests (`npm test`)

`test/pendingResults.test.mjs` — **18 tests** — plus the existing 31 engine
tests (49 total) verify:

- the three statuses for semesters and courses;
- a pending semester/course is excluded from confirmed CGPA and QP even when a
  stale GPA/grade value is present, while its known credits are reported;
- pending semester credits fall back to the configured curriculum load;
- current-mode pending credits are removed from the confirmed base and exposed
  for projections;
- best case (top grade), worst case (floor 0.0), minimum-pass (weakest passing
  point), and that the range brackets the confirmed CGPA;
- classifications attached to best/worst cases;
- target feasibility **guaranteed / possible / unreachable** boundary cases and
  the exact required-pending-GPA equation; null status when nothing pending or
  no target.
