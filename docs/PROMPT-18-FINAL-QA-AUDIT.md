# Prompt 18 — Final Production QA, Security & Offline Audit

A complete production audit of CGPA PILOT. Every item below was verified
against the codebase and/or the production build (`npm run build:web`).
Result: **150 automated tests pass**, typecheck clean, web + Electron builds
green, Capacitor sync green.

## OFFLINE TEST

The app is fully self-contained: no external URLs in shipped HTML, no fonts
or analytics from CDNs, and the student entry chunk contains **zero
application-level `fetch` calls** (the only `fetch` in the chunk is React's
internal `<link rel=preload>` helper). The PWA service worker serves the app
shell cache-first and caches hashed JS/CSS on first load. Verified by serving
the production build locally:

| Offline action | Status |
|---|---|
| Open the application | ✅ (shell, CSS, JS all 200 from same origin) |
| Select UCC → School of Pharmacy → PharmD | ✅ config bundled/cached |
| Calculate CGPA | ✅ `coreCgpaService`, fully local |
| Enter GPA history | ✅ weighted by credit load |
| Set targets | ✅ in-memory |
| Calculate feasibility | ✅ `targetService` tiers |
| Maximum possible CGPA | ✅ `maximumFinalCgpa` |
| What-If | ✅ `scenarioService` |
| Flight Path | ✅ inline SVG, no network |
| Next Semester Pilot | ✅ `nextSemesterService` |
| Pending-result calculations | ✅ `pendingService` |
| Pilot Brief | ✅ `dashboardService` |
| Print reports | ✅ scoped print DOM + `window.print()`, offline |
| Clear everything | ✅ in-memory reset + reload |
| Reset the application | ✅ same flow |

Offline curriculum availability: published configuration is bundled and also
cached in localStorage (`cgpa-pilot.config.v1`); remote refresh is optional
and config-only.

## PRIVACY AUDIT (verified against source and production chunks)

| Check | Result |
|---|---|
| No student database | ✅ none exists (student app has no DB layer) |
| No student account | ✅ no sign-up/login in the student app |
| No academic data persistence | ✅ state is React `useReducer` memory only |
| No localStorage academic data | ✅ only key in student bundle is `cgpa-pilot.config.v1` (config) |
| No sessionStorage academic data | ✅ sessionStorage never used |
| No IndexedDB academic data | ✅ IndexedDB never used |
| No student academic cookies | ✅ `document.cookie` never touched |
| No academic data in URLs | ✅ no pushState/replaceState/URLSearchParams/hash state |
| No academic analytics | ✅ no analytics/telemetry/beacon code |
| No student data uploaded | ✅ zero app-level network calls with student data; one optional config GET |
| No sync after reconnect | ✅ student data has no stored copy to sync; only curriculum config may refresh |
| Admin secrets not in student bundle | ✅ `pilot-admin`, `passHash`, admin modules absent from student chunks |
| Print anonymous | ✅ no name/ID/email/phone fields exist; enforced by a test |

## REFRESH TEST

- Enter fake data → refresh → data is gone: verified by architecture
  (in-memory state, no rehydration) and by `sessionGuard` behavior.
- Close/reopen app → data is gone: same guarantee.
- Clear Everything: the persistent 🔄 Refresh/Clear button **always** shows the
  "Clear Your Session?" modal first; Cancel/Escape/backdrop do nothing;
  Clear & Refresh resets the store and reloads to a clean start.
- Refresh/tab-close warning: `beforeunload` fires while
  `hasEnteredAcademicData()` is true (9 unit tests cover the detector).

## CURRICULUM TEST

Draft → Review → Published → Archived lifecycle with legal-transition
enforcement (`transitionCurriculum`); published versions locked (duplicate to
edit, archive to supersede); course management (add/edit/remove/reorder/
bulk import); credit validation (1–20, positive, numeric); duplicate course-
code detection; version selection (only PUBLISHED reaches students); offline
availability (bundled + config cache). **New this audit:** publish is now
blocked at the **service layer** on any critical error, with reasons surfaced
in the UI. Covered by `curriculumPublishGate.test.mjs`.

## CALCULATION TEST

150 tests across: credit weighting, semester GPA handling, current-CGPA mode,
GPA-history mode, target calculation, required GPA, maximum possible CGPA,
classification (incl. every band boundary), pending results, what-if
scenarios, next-semester planning, milestones, boundary values and full-
precision (no intermediate rounding). The 43-case Test Lab runs the same
engines against fabricated data with Expected/Actual/PASS-FAIL.

## SECURITY

- **Authentication**: admin console gated by passcode; SHA-256 (WebCrypto)
  hash with salting prefix; empty passcodes now rejected.
- **Authorization**: admin is a separate Vite entry (`admin.html`) with its
  own chunk; student bundle contains no admin code/secrets (verified in
  built artifacts).
- **Admin-only editing**: all catalog mutations live behind admin auth;
  published curricula locked.
- **Input validation**: numeric fields bounded/validated; curriculum
  validation blocks publication; lab expectations validated.
- **Injection prevention**: no `dangerouslySetInnerHTML`/`eval`/`new
  Function` in the app; user input renders via React (escaped). The one
  `innerHTML` surface (scoped print templates) now HTML-escapes all
  interpolated config/number values (`esc()`).
- **API security**: there is no student-facing API; the only fetch is an
  optional same-origin curriculum document GET.
- **Credentials**: only a hash is stored, admin-side; default passcode shown
  only in the admin bundle.
- **No student data logging**: no console/telemetry of academic data.

## UX (mobile portrait/landscape, tablet, desktop)

- Sidebar (desktop) / 9-item bottom nav + sticky header (mobile); tables
  wrapped in `overflow-x-auto` containers (Next-Semester table fixed this
  audit) so narrow screens never force page-wide horizontal scroll.
- Graphs are responsive SVGs (`viewBox`, `w-full`) that scale down while
  staying legible.
- Buttons have hover and disabled states; forms validate with understandable
  messages ("Incorrect passcode", "Define the expected result", publish
  blockers list exact reasons).

## ACCESSIBILITY

- Keyboard navigation: every control is a real button/input/select/label.
- Visible focus: global `:focus-visible` outline added; the two previously
  icon-only course buttons (⏳ pending, ✕ remove) now have `aria-label` +
  `title`.
- Screen readers: dialog has `role="dialog"`/`aria-modal`/`aria-labelledby`;
  graphs have `role="img"` + descriptive `aria-label`.
- Labels: all data inputs are wrapped in `<label>` elements.
- Non-color-only status: every status pairs color with emoji + text
  (🎯🟢🟡🟠🔴 / PASS·FAIL text / "impossible", "achievable" labels).
- Contrast: slate-900/brand-700 text on white; status colors are bold
  mid-tone badges with text.

## PRINT QA

A4 `@page`, branding + curriculum version on every sheet, target-vs-projection
disclaimer, anonymous note; Summary, Flight Path (graph), Next-Semester,
per-scenario What-If, Semester Projection (graph + table), Pilot Brief and the
multi-page Full Report all print from isolated scoped DOM; printing is
browser-native and fully offline (P15, `PROMPT-15-PRINT-SYSTEM.md`).

## FINAL FLOWS

- Student: **SELECT → ENTER → CALCULATE → ANALYZE → TARGET → NAVIGATE → PLAN → PRINT → CLEAR** — each step maps to an existing tab (Dashboard/Calculate →
  What-If → Target → Flight Path/Milestones → Next Semester → Print →
  Refresh/Clear).
- Admin: **CONFIGURE → VALIDATE → TEST → REVIEW → PUBLISH → DISTRIBUTE → MAINTAIN** — Institutions/Grading configure; Review panels validate;
  the new Test Lab verifies; publish gates on validation; distribution is the
  offline config payload; published versions are locked/archived for
  maintenance.

Brand: **CGPA PILOT** — *Navigate Your Academic Future.* Initial launch remains
**University of Cape Coast → School of Pharmacy → PharmD**; the calculation
engine is config-driven and ready for future universities without changes.
