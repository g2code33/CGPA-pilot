# Prompt 13 — Milestones & Affordable Drop Analysis: notes

A new **Milestones** tab (`src/views/Milestones.tsx`) plus
`src/services/milestoneService.ts` gives stage-by-stage academic milestone
analysis across the remaining structure and answers **“how much can I afford to
drop?”**.

## Per-stage milestones

For every remaining stage (each future semester, emphasised at end-of-level and
graduation) the analysis reports, under each of three scenarios:

- **Required GPA** — the steady future average still needed *after* that stage
  to reach the target (`(target × total − projectedPoints) ÷ remaining`).
- **Projected CGPA** — credit-weighted cumulative CGPA at that stage.
- **Target CGPA** — the configured target line.
- **Remaining credits** — credits still ahead after the stage.
- **Maximum possible CGPA** — the best-case (configured top grade) projection.

The future legs reuse `flightPathService.buildFlightLegs` (curriculum slots,
with a flat fallback when the curriculum has no credit data), so every stage
uses the real configured credit loads.

## Three labelled scenarios

`analyzeMilestones(input, grading, classification)` accumulates three
independent paths:

- **BEST CASE** — every future credit earns the **maximum configured grade
  point** (`maxGradePoints`; nothing is invented — the ceiling comes from the
  active grading bands).
- **TARGET CASE** — the steady average required to finish exactly on the
  target (capped at the ceiling; clamped at 0).
- **USER SCENARIO** — a future GPA the student enters, including lower values
  they want to test (“If I get 3.20 next semester…”).

All three appear in a responsive comparison graph (best = solid green, target =
dashed amber, user = solid indigo; red target line) and in the milestone table.

## HOW MUCH CAN I AFFORD TO DROP?

The user scenario drives a `dropVerdict` for the **next** semester: after
applying the lower next-semester GPA it returns the **updated projected CGPA**,
the **updated required future GPA** over the remaining credits, the **best
possible** finish from there, the **target status** (achievable / very
demanding / extremely demanding / impossible), and a plain-English answer
(e.g. *“Yes, but — after a 3.20 semester you’d need about 3.90 over the
remaining credits to still reach 3.60.”*). Impossibility is declared only when
even the configured ceiling from the new position falls short.

Quick buttons (2.50 / 3.00 / 3.20 / 3.50) and a slider set the user GPA; the
flight path updates immediately. No real-world pass-rate or performance data is
used anywhere.

## Privacy / offline

All inputs and results are temporary in-memory state — nothing is saved, sent,
or put in a URL (covered by the smoke-test privacy guard). **🖨️ Print
milestones** uses the offline `@media print` sheet (graph + tables print as
vectors/text).

## Automated tests (`npm test`)

`test/milestones.test.mjs` — **13 tests** (**118 total**) — verify stage/
graduation construction, cumulative and remaining credits, best case at the
ceiling, target case landing on target (including an adaptive reachable
target), the user scenario’s credit-weighted projection, required-GPA recovery
after a stage, max possible = best case, affordable-drop reachable vs
impossible verdicts with worked numbers, the updated post-drop CGPA, the
ceiling bound, and a non-4.0 (5-point) scale.

## Files

- New: `src/services/milestoneService.ts`, `src/views/Milestones.tsx`,
  `test/milestones.test.mjs`, `docs/PROMPT-13-MILESTONES-DROP.md`.
- Changed: `src/services/flightPathService.ts` (exported shared
  `buildFlightLegs`/`FlightLeg`), `src/App.tsx` (Milestones tab + nav),
  `src/views/Dashboard.tsx` (navigation card).
