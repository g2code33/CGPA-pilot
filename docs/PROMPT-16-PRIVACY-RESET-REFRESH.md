# Prompt 16 — Strict Privacy, Reset & Refresh System

Student academic information is **temporary by architecture** and the reset
flow is explicit and always confirmed.

## Storage & network audit (enforced, not just promised)

| Surface | Student academic data | Allowed (non-personal) |
|---|---|---|
| localStorage | ❌ never | ✅ `cgpa-pilot.config.v1` — published grading/classification/curriculum config (`src/services/configCache.ts`) |
| sessionStorage / IndexedDB / cookies | ❌ never used | — |
| Student database | ❌ none exists | — |
| Analytics / telemetry | ❌ none | — |
| URL parameters / history | ❌ never | — |
| Network fetch (student bundle) | ❌ none | `curriculumService.refreshFromRemote()` — GET of a published curriculum document only (admin-triggered); Electron app self-updater |
| PWA service worker | — | caches same-origin static GET assets only (app shell/hashed JS/CSS) |
| Reconnect sync | ❌ calculations never sync | curriculum configuration may refresh |

Academic state (`src/state/store.tsx`, `studentState.ts`) is a `useReducer`
held in React memory; nothing writes it anywhere durable. A refresh destroys
it; the app never rehydrates it.

## 🔄 Refresh / Clear (`src/components/ClearButton.tsx`)

- **Persistent button** in the desktop sidebar and the mobile header —
  visible on every tab.
- Clicking it **always** opens the confirmation modal first; nothing is
  cleared without explicit approval.
- Modal title **"Clear Your Session?"** with the exact mandated copy:
  all entered information is cleared; nothing is saved or shared; includes
  CGPA, semester GPAs, targets, projections and What-If calculations;
  **"This action cannot be undone."**
- Buttons: **Cancel** (default-focus; Escape and backdrop click also cancel —
  nothing changes) and **Clear & Refresh**.
- On approval: dispatches the store `reset` (wipes all student state), marks
  the reload intentional (suppresses the beforeunload prompt), then performs
  `window.location.reload()` — the app reinitializes from scratch: forms,
  navigation (back to Dashboard), scenarios and graphs all remount clean
  (steps 1–9). The curriculum config cache is deliberately kept (no personal
  data; needed for offline operation).

## Browser refresh protection (`src/services/sessionGuard.ts`)

- `hasEnteredAcademicData(state)` — pure detector: true when any academic
  data exists (baseline CGPA / completed credits / pending credits /
  progressed level; semester GPAs; course scores, grades, pending flags or
  course identifiers). Config-only choices (target CGPA, planned credit
  hours, input-mode toggle) do not count.
- `installBeforeUnloadGuard(isDirty)` — registers a `beforeunload` warning
  only while the session is dirty, so a stray refresh/tab-close warns that
  temporary calculations will be lost. The explicit Clear & Refresh flow
  sets `markIntentionalReload()` so it isn't blocked by its own warning.
  On platforms without `beforeunload` (some mobile webviews) it's a safe
  no-op — data is in-memory only regardless.
- After refresh no academic data returns (there is nothing persisted to
  restore).

## Privacy page (`src/views/Privacy.tsx`, `src/services/privacyService.ts`)

Rewritten claims — every statement is technically enforced:

- No account required
- No student identity required (no name / ID / email / phone)
- No grades stored · No CGPA stored (never in localStorage, sessionStorage,
  IndexedDB, cookies or any database)
- No student academic database
- No academic tracking / analytics
- Student academic information is never shared or uploaded — reconnecting
  syncs only published curriculum config
- New section explaining the temporary session, the Refresh / Clear modal
  and Cancel vs Clear & Refresh behavior, the refresh warning, and the
  reconnect/never-sync guarantee.

## Verification

- `npm run typecheck` — clean (web + electron).
- `npm test` — **140 pass / 0 fail** (added `test/sessionGuard.test.mjs`,
  9 tests covering pristine/config-only/dirty detection across baseline,
  history, course and pending states).
- `npm run build:web`, `npm run build:electron`, `npx cap sync` — all pass.
