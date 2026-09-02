# Prompt 14 — Dashboard & Pilot Brief: notes

The Dashboard is rebuilt as a cockpit, fed by a single pure assembler
`src/services/dashboardService.ts` (`buildDashboard`) that composes the existing
engines (target feasibility, next-semester plan, flight path) so every figure is
config-driven, credit-weighted and unrounded until display.

## Sections

- **CURRENT POSITION** — Current CGPA, current classification (from the active
  classification system) and current level, plus graded credits.
- **DESTINATION** — Target classification and target CGPA.
- **FLIGHT STATUS** — the target feasibility status from
  `targetService.analyzeTarget`: Achievable / Very demanding / Extremely
  demanding / Impossible (plus already-achieved / awaiting-data), colour-coded.
- **REQUIRED PERFORMANCE** — required future average GPA over the remaining
  credits, with the maximum possible final CGPA.
- **NEXT MISSION** — the immediate next semester (from the published
  curriculum), its required GPA and target guidance, with a link to the Next
  Semester Pilot.
- **PROJECTED DESTINATION** — projected final CGPA (and class) on the planned
  steady average, with a link to the Flight Path.
- **FLIGHT PATH** — a compact responsive trajectory sparkline (Now → Graduation,
  with the target line).
- **PILOT BRIEF** — a concise summary assembled by the service covering, in
  order: Current CGPA, Target, Status, Required future GPA, Next-semester
  target, Maximum possible CGPA, Important assumptions, and the Curriculum
  version (with a clear note when none is published).

## Print Pilot Brief (offline)

🖨️ **Print Pilot Brief** calls `window.print()`; the print stylesheet hides the
app chrome/controls (`.no-print`), keeps the data cards (`.print-sheet`) and
shows a print-only header (institution, date, “projections are scenarios, not
guaranteed outcomes; anonymous — no personal data”). Everything is inline
DOM/SVG — no network, fully offline.

## Privacy

All figures are computed from temporary in-memory state — nothing about the
student is stored, transmitted or placed in a URL (enforced by the smoke-test
privacy guard). The only local data remains the non-personal published
curriculum cache.

## Automated tests (`npm test`)

`test/dashboard.test.mjs` — **9 tests** (**127 total**) — verify current
position/destination/level, flight status (extremely-demanding vs impossible
against the ceiling), the next mission’s semester and configured credits, the
projected destination, the flight-path current→graduation series, and that the
brief text contains the required elements including the curriculum version and
the “not published” fallback, plus the no-data state.

## Files

- New: `src/services/dashboardService.ts`, `test/dashboard.test.mjs`,
  `docs/PROMPT-14-DASHBOARD-BRIEF.md`.
- Changed: `src/views/Dashboard.tsx` (rebuilt cockpit sections + compact graph
  + print).
