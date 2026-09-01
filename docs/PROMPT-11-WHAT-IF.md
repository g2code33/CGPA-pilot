# Prompt 11 — What-If Simulator: notes

A scratchpad for testing future GPA scenarios — **“What if my next GPA is 3.0 /
3.5 / 4.0?”** — without touching the student's confirmed calculation. All
assumptions live in component state: nothing is saved, nothing is sent, and no
individual course grades are inferred (an aggregate GPA only).

## Future-GPA scenarios

`scenarioService.futureScenario(input, grading, classification)` computes, for
a hypothetical next period (its credit load + assumed GPA), all **credit-weighted**,
at full internal precision:

- **Projected semester GPA** — the assumed GPA for the next period.
- **Projected CGPA** — confirmed points + assumed GPA × future credits, over
  confirmed + future credits.
- **Difference from current CGPA** — projected − confirmed.
- **Difference from target** — projected − target.
- **Effect on final trajectory** — the CGPA at graduation if the *same* average
  is held over all remaining credits.
- **Target feasibility** — after the period, the future average still required
  and a verdict (meets-target / reachable / very demanding / extremely
  demanding / impossible), reusing the Prompt-9 `analyzeTarget` engine from the
  new hypothetical position.

## Three temporary presets + a custom slider, side by side

`scenarioService.scenarioPresets(grading, currentCgpa, requiredFutureGpa)`
returns config-driven presets (thresholds from the grading bands):

- **Conservative** — hold the current CGPA.
- **Target** — the average required to reach the target, capped at the ceiling.
- **Excellent** — the top grade (`maxGradePoints`).

The comparison table shows all three plus a fourth **“What if next GPA is…?”**
row driven by a slider with quick **What if it is 3.0 / 3.5 / 4.0?** buttons —
each row listing next GPA, projected CGPA (+class), Δ vs now, Δ vs target,
final-if-held, and feasibility after the period. Controls for next-period
credits and remaining-to-graduation default from the configured curriculum and
are editable.

## Controls

- **↺ Reset Scenario** — clears the custom scenario, the credit edits and (by
  remounting) the pending-course assumptions.
- **🖨️ Print Scenario** — `window.print()`; `@media print` rules hide the
  controls/chart while the comparison table prints with an offline print-only
  header. Fully local (inline DOM/SVG; no network).
- The pending-course grade scratchpad (Prompt 7) and a course-by-course
  hypothetical semester remain in a secondary, non-printing card.

## Privacy / integrity

Scenarios never mutate the confirmed record (a test asserts the base object is
unchanged after running scenarios), are not persisted, use no storage/network/
URLs (covered by the smoke-test privacy guard), and never derive individual
grades from a GPA.

## Automated tests (`npm test`)

`test/whatIf.test.mjs` — **13 tests** (**93 total**) — verify projected
semester GPA, credit-weighted projected CGPA, Δ-from-current and Δ-from-target,
final trajectory, the 4.0 trajectory landing on target, meets-target /
feasibility / impossible verdicts after the period, required GPA after the
period, config-driven presets (incl. ceiling cap and a non-4.0 scale), and the
no-mutation guarantee.

## Files

- Changed: `src/services/scenarioService.ts` (`futureScenario`,
  `scenarioPresets`), `src/views/WhatIf.tsx` (rebuilt comparison simulator +
  printable table + reset/presets).
- New: `test/whatIf.test.mjs`, `docs/PROMPT-11-WHAT-IF.md`.
