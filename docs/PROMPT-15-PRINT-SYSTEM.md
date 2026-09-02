# Prompt 15 — Complete Offline Print System

Every major result section now has its own **scoped** print action: only the
section/scenario requested is printed (the old whole-page `window.print()`
printed the entire active view). All printing is browser-native
(`window.print()` over a purpose-built hidden print DOM) → works offline, no
online/paid PDF service, Save-as-PDF included on every platform.

## How it works

- `src/services/scopedPrint.ts` — the scoped print engine:
  - `printSection(element, branding)` — clones a live DOM node (stripping
    `.no-print` children) into a hidden `#cgpa-print-root`.
  - `printHtml(sections, branding)` — composes reports from HTML strings
    (supports `pageBreakBefore` per section for multi-page reports).
  - Adds the **CGPA PILOT** brand header: title, institution, programme,
    curriculum version, generation date, and an explicit
    *"Anonymous · no personal data is collected or printed"* line.
  - Adds a disclaimer distinguishing the **target** (a goal the student sets)
    from **projections** (scenarios based on assumed future results).
  - Print CSS (`src/index.css`, `@media print`): `.app-root` (the live app
    shell) is hidden; `#cgpa-print-root` is shown; A4 `@page` with 14 mm
    margins; headings avoid break-after; table rows/thead/SVG/cards avoid
    break-inside; tables width 100% collapse; SVG graphs scale to page width.
  - Root is removed on `afterprint` (+1.5 s fallback timer). In-memory DOM
    only — nothing is persisted (no localStorage/sessionStorage/IndexedDB/
    cookies/URL/network).
- `src/services/reportComposer.ts` — composed reports consuming the shared
  `DashboardModel` (built once in `src/state/derived.ts`, so printed figures
  always match the screen):
  - `summaryReport(m)` — level, CGPA, classification, target, target class,
    required future GPA, projected final CGPA, max possible final CGPA.
  - `fullReport(m)` — four page-broken sections: summary → flight path &
    milestones → next-semester plan → pilot brief.
  - `pilotBriefReport(m)` — the concise co-pilot brief.

## Print documents (all acceptance items)

| Document | Where | Implementation |
|---|---|---|
| Print Summary | Dashboard hero / Print tab | `summaryReport` via `printHtml` |
| Print Flight Path | Flight Path tab (🖨️ button) | `printSection(graphRef)` — trajectory graph + graduation projection + milestones card |
| Print Next Semester Plan | Next Semester tab | `printSection(planRef)` — semester, courses, credits, target grades, required GPA |
| Print Scenario (only the selected) | What-If tab | 🖨️ per scenario row + "Print this scenario" → `printHtml` single-scenario sheet |
| Print Semester Projection | Milestones tab | `printSection(sheetRef)` — updated-flight-path graph + per-stage milestone table (each remaining level/semester stage) |
| Print Pilot Brief | Dashboard hero / Print tab | `pilotBriefReport` |
| Print Full Report | Dashboard hero / Print tab | `fullReport` — 4 sections, page-broken |
| Print Centre (hub) | Print tab rebuilt | one-tap access to every document + privacy notes |

## Privacy

- No Student ID, Name, Email, Phone or Account field exists anywhere in the
  app or any printout — CGPA PILOT does not collect these (enforced by a test
  scanning all composed reports for banned strings).
- All printing happens locally in the browser; the print DOM is discarded
  after printing. Student academic data remains in-memory React state only.

## Verification

- `npm run typecheck` — clean (web + electron).
- `npm test` — **131 pass / 0 fail** (added `test/reportComposer.test.mjs`,
  4 tests: summary figures/labels/version, pilot brief completeness, full
  report sections, no personal-data strings).
- `npm run build:web`, `npm run build:electron`, `npx cap sync` — all pass.
- Legacy `src/services/printService.ts` (whole-page print) removed; no
  references to `window.print()` remain outside the scoped engine.
