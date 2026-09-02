# Prompt 10 — CGPA Flight Path: notes

The signature CGPA PILOT visualization: a responsive milestone line graph from
the student's current position to graduation, with a printable offline sheet.

## Service — `src/services/flightPathService.ts`

`buildFlightPath(input, grading, classification)` produces `FlightPathModel`:

- **Inputs:** confirmed quality points / credits / CGPA, current level, the
  curriculum's **remaining semester slots** (`structureService`), an assumed
  steady future GPA, the target CGPA, and flat fallback assumptions.
- **Milestones** (`FlightMilestone[]`): **Now** (current position), a point for
  each future semester, with **end-of-level** markers (end of current level,
  next level, following levels…) and a final **Graduation** milestone. Each
  carries cumulative credits, the **projected** cumulative CGPA and the
  **required** cumulative CGPA at that point.
- **Projected path** — credit-weighted: confirmed points + (assumed future GPA ×
  future credits) over cumulative credits, using the curriculum's *real*
  per-semester credit loads.
- **Required path** — the cumulative CGPA that must be held at each milestone
  to reach the target: `requiredFutureGpa = (target×totalCredits −
  currentPoints) ÷ futureCredits`, blended cumulatively so the required line
  lands exactly on the target at graduation. `targetReachable` is false only
  when that required average exceeds the configured ceiling.
- **Graduation projection** — projected final CGPA and its classification,
  total programme credits, required future GPA.
- **Fallback** — when the published curriculum has no credit/slot data yet, it
  keeps the curriculum's level/semester labels but substitutes a flat credit
  load, or synthesizes two-semesters-per-level legs; the view flags this and
  exposes the assumptions.

All math is full precision; the service never mutates student state.

## View — `src/views/FlightPath.tsx`

A single responsive **SVG** graph (`viewBox` scales to any width — mobile,
tablet, desktop) showing, clearly distinguished in the legend:

- **Current** — solid black marker at Now;
- **Projected** — solid indigo line (assumed future GPA);
- **Required** — dashed amber line (must-hold path to target);
- **Target** — solid emerald horizontal line, plus faint dashed class-band
  lines (First / 2:1 / …) from the configured classification.

Level-end milestone labels (Now, L200, L300, …, Grad) sit on the x-axis with
faint level guides. Controls (touch-friendly, wrap on small screens): an
**assumed future GPA** slider with a **“Fly the required line”** shortcut, and
fallback credits/semester inputs only when the curriculum is unpublished. A
summary strip shows Current CGPA, Target CGPA, Required future GPA and
Projected-at-graduation; a **graduation projection** card and a milestone table
(end of each level: credits, projected CGPA, required CGPA, projected class)
round it out.

Projections are explicitly labelled as scenarios — the graph note and legend
state they are **not guaranteed outcomes**; an unreachable target gets a 🔴
badge proving the required average exceeds the ceiling.

## Print Flight Path (offline)

- **🖨️ Print Flight Path** calls `window.print()`. Everything is local: the
  graph is inline SVG (prints as crisp vectors), uses no network fonts/images
  beyond the bundled app, and the PWA shell works offline.
- `src/index.css` print rules hide the app chrome (`aside`, `header`, `nav`,
  `.no-print` controls) and reveal a `.print-only` header (institution, date,
  “projections are scenarios, not guaranteed outcomes”), so the printout is a
  clean flight-path sheet. Nothing about the student is persisted or sent.

## Automated tests (`npm test`)

`test/flightPath.test.mjs` — **9 tests** (**80 total**) — verify milestone
structure (current / level-ends / graduation), cumulative credit growth over
curriculum loads, the credit-weighted projected path, the required-future-GPA
equation, the required line landing on target at graduation, unreachable
target above the ceiling, graduation class, and both fallback modes
(no curriculum; zero-credit slots).

## Files

- New: `src/services/flightPathService.ts`, `test/flightPath.test.mjs`,
  `docs/PROMPT-10-FLIGHT-PATH.md`.
- Changed: `src/views/FlightPath.tsx` (rebuilt around the service with
  required line, milestones, responsive graph, print), `src/index.css`
  (print-sheet rules).
- The older generic `flightPath()` in `projectionService.ts` is no longer used
  by the view (retained as a pure helper).
