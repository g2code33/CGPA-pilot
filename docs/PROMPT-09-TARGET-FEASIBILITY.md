# Prompt 9 — Target & Feasibility Engine: notes

A dedicated, config-driven target system on the **Target** tab
(`src/services/targetService.ts` → `analyzeTarget`).

## Choosing a target

- **Classifications come from the active configured rules**: target chips are
  built from `classification.bands` filtered to the graduation classes (First
  Class, Second Class Upper, Second Class Lower, Third Class, Pass for UCC),
  labelled with each band's configured minimum CGPA. Selecting a class sets the
  target to that band's minimum.
- **Custom CGPA target**: a numeric entry (validated against the configured
  grading ceiling) plus a fine-grained slider. The resolved target class is
  shown next to it.

## What is calculated (full internal precision)

`analyzeTarget({ currentPoints, creditsCompleted, creditsRemaining, targetCgpa,
currentCgpa }, grading, classification)` returns:

- **Current CGPA** — confirmed CGPA (released results only).
- **Target CGPA** and the classification band it belongs to.
- **Credits completed / remaining / total** — remaining defaults to the
  configured curriculum (current mode) or total programme − completed, and is
  editable, with a “Use curriculum remaining” button.
- **Required future quality points** = `target × totalCredits − currentPoints`.
- **Required average future GPA** = required future QP ÷ remaining credits.
- **Maximum possible final CGPA** = `(currentPoints + maxPoints × remaining) ÷
  total`, where `maxPoints` is derived from the active grading system's top
  band (never hard-coded 4.0).

## TARGET STATUS (four tiers)

Thresholds are derived from the grading bands (`tierThresholds`): the green/
yellow boundary is the **second-highest grade point** (e.g. B+ = 3.50) and the
yellow/orange boundary is the **midpoint between that and the top grade** (e.g.
(3.50+4.00)/2 = 3.75). Falls back to fractions of the ceiling for unusual
scales.

| Status | Emoji | Condition |
| --- | --- | --- |
| Target already achieved | 🎯 | current CGPA ≥ target |
| **Achievable** | 🟢 | required future GPA ≤ second-highest grade point (≤ ~3.50) |
| **Very demanding** | 🟡 | required average between ~3.50 and ~3.75 (mostly top grades) |
| **Extremely demanding** | 🟠 | required average between ~3.75 and the ceiling (near straight A) |
| **Mathematically impossible** | 🔴 | required future GPA **exceeds the configured maximum grade point** |

Impossibility is declared **only** when the math proves it: even scoring the
maximum grade in every remaining credit lands below the target (`maxFinalCgpa <
target`). A required average exactly at the ceiling is reachable (extremely
demanding), not impossible. `unknown` covers the not-enough-data states (no
CGPA entered, or no remaining credits configured).

## “Why am I seeing this?”

Each analysis includes an `explanation[]` in plain language — confirmed
position, total quality points the target requires, the QP still to earn over
the remaining credits, the implied average on the configured scale, and what
the tier means (including the mathematical best case). Shown behind a **❓ Why
am I seeing this?** toggle. A note states that figures use full precision and
are rounded only for display.

## Privacy

All target inputs and results are temporary in-memory state — no persistence,
no network, no URLs (enforced by the smoke-test privacy guard from Prompt 8).
Pending results (Prompt 7) are shown separately and remain excluded from the
confirmed base used here.

## Automated tests (`npm test`)

`test/targetFeasibility.test.mjs` — **14 tests** (**71 total**) — verify the
reported figures, required future QP/GPA equations, maximum final CGPA, target
class resolution, all four tiers (with worked numbers), the **met** and
**unknown** states, the ceiling boundary (req == ceiling is *not* impossible),
impossibility proof on a 5-point scale (ceiling derived from bands), and that
explanations are generated.

## Files

- New: `src/services/targetService.ts`, `test/targetFeasibility.test.mjs`,
  `docs/PROMPT-09-TARGET-FEASIBILITY.md`.
- Changed: `src/views/Target.tsx` (rewritten around the engine),
  `src/components/ui.tsx` (added `orange`/`amber` tones).
