# Prompt 8 — Student Input Experience: notes

A guided, three-mode input experience. **No student account is ever created.**
Everything the student enters is **temporary, in-memory only** — not stored,
not sent to a server, and never put in a URL.

## Institution selection (config-driven, not hard-coded)

The student selects **University → School → Programme** via
`src/components/InstitutionSelector.tsx` (a cascade on the Dashboard, with a
**Change** control). It reads the bundled/published catalog
(`curriculumService.listUniversities()` etc.); the shipped default is
**University of Cape Coast → School of Pharmacy → PharmD**. The choice lives in
an in-memory React context (`src/state/institutionSelection.tsx`), defaulting
to the active context, and is **not persisted** (no localStorage / sessionStorage
/ IndexedDB / cookies), not transmitted, and never encoded in a URL.
`useDerived()` resolves grading/classification/curriculum against the selected
context and recomputes when it changes.

## Three input modes

A `state.inputMode: 'quick' | 'history' | 'planning'` drives the Calculate tab
(three mode cards; also launchable from the Dashboard). Internally `quick` and
`planning` resolve to the current-CGPA engine mode; `history` to the
semester-history mode (`store.setInputMode` maps and auto-adds the first
semester when history is first chosen).

### Mode A — Quick mode ⚡
Requires only **current level** and **current CGPA**. The configured curriculum
derives credits completed/remaining and the remaining structure
(“semesters to go”); last-semester, manual-credit and pending-result fields are
tucked behind **Advanced**. No individual course grades are asked for.

### Mode B — GPA History mode 📚
Semester-by-semester GPA entry (L100 S1, L100 S2, L200 S1, …), labels and
credit loads taken from the configured curriculum. The student only adds the
semesters they have actually completed — **“Add next completed semester”
disables at the published curriculum's last slot** (“All semesters entered”) —
and a note reinforces entering only completed history. Semester GPAs are
credit-weighted by curriculum loads (Prompt 6); pending results are supported
(Prompt 7).

### Mode C — Planning mode 🗺️
**Current CGPA → target classification → future GPA scenario.** The student
picks a target classification (chips from the configured classification
bands), sets a future-GPA slider, and immediately sees projected final CGPA,
best-possible finish, and whether the target is reachable (required future
average) over the curriculum's remaining credits. Degrades to a clear note
when the curriculum isn't published yet (no fabricated credits).

## Validation against the configured grading system

`gradingService` gains `minGradePoints`, `validateGpa(value, system)` and
`clampGpa`. `validateGpa` returns null when valid (an empty value = “not
entered”, which is allowed) or a message: non-numeric, below the scale floor,
or above the scale ceiling — **the ceiling is derived from the active grading
system's bands**, so it reports 4.00 for UCC and 5.00 for a 5-point system.
Every GPA/CGPA input (Quick, History, Planning, Current) shows inline
validation and is clamped in derived defaults.

## Privacy guarantees (enforced)

- Student academic state (including the institution choice) is in-memory
  React state only; there is no storage or network call in the state/service
  path.
- `smoke.mjs` adds a static guard: every student state file and calculation
  service must contain **no** URL/history writes (`location`, `pushState`,
  `replaceState`, `URLSearchParams`, `history.push/replace`) and **no** network
  calls (`fetch`, `XMLHttpRequest`, `sendBeacon`) — student values can never
  enter a URL or leave the device.
- The existing storage boundary still holds: the only student-bundle storage
  user is `configCache.ts` (non-personal curriculum config).

## Automated tests (`npm test`)

`test/studentInput.test.mjs` — **8 tests** — plus the 49 prior tests (**57
total**) verify ceiling/floor derivation, empty = valid, in-range validity,
above-ceiling rejection with the configured value, negative/NaN rejection,
correct behaviour on a non-4.0 scale, and `clampGpa`. The URL/network privacy
guard runs in the smoke test.

## Files

- New: `src/state/institutionSelection.tsx`,
  `src/components/InstitutionSelector.tsx`,
  `test/studentInput.test.mjs`.
- Changed: `src/state/studentState.ts` (`InputMode`), `src/state/store.tsx`
  (`setInputMode`, mode mapping), `src/state/derived.ts` (selected-institution
  resolution + recompute), `src/views/Calculate.tsx` (three-mode shell, Quick
  simplification, Planning mode, GPA validation, history slot limit),
  `src/views/Dashboard.tsx` (selector + mode-launch cards, mode label),
  `src/services/gradingService.ts` (validation), `src/services/curriculumService.ts`
  (`listUniversities`), `src/main.tsx` (provider), `smoke.mjs` (privacy guard).
