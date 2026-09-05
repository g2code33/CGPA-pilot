// ─────────────────────────────────────────────────────────────────────────
// privacyService / resetService
//
// Student academic state is held ONLY in memory (React store). "Reset" is a
// full state reset; no clearing of persistent storage is needed for student
// data because none is ever written. The only persistent storage in the app
// belongs to configCache and holds non-personal curriculum configuration.
// ─────────────────────────────────────────────────────────────────────────

import { resetCurriculumCache } from './curriculumService';

export const PRIVACY_PROMISES: string[] = [
  'No account required — the app opens straight to the calculator with no sign-up or login.',
  'No student identity required: you are never asked for your name, student ID, email or phone number.',
  'Every calculation runs locally on your device — CGPA, targets, feasibility, what-ifs, flight path and projections.',
  'Works fully offline after first load. No internet, API calls, cloud functions, online databases, logins or external AI are used for calculations.',
  'Everything you type is a temporary session: close the tab, refresh the browser, or press 🔄 Refresh / Clear and it is gone.',
  'Prints are anonymous — no name or student ID appears, and the file stays on your device.',
];

export const PRIVACY_NEVERS: string[] = [
  'No grades are stored — grades exist only in temporary memory while you use the app.',
  'No CGPA is stored — your CGPA, semester GPAs, targets and projections are never written to localStorage, sessionStorage, IndexedDB, cookies or any database.',
  'There is no student academic database — CGPA PILOT holds no records about any student.',
  'No academic tracking — no analytics, beacons or telemetry tied to your academic data.',
  'Your student academic information is never shared and never uploaded — reconnecting to the internet syncs only published curriculum configuration, never your calculations.',
  'Your academic data is never put in the web address (URL).',
];

export const PRIVACY_OFFLINE_NOTE =
  'The app caches only published, non-personal academic configuration ' +
  '(grading and classification rules, and published curricula) so it works ' +
  'offline. That configuration contains no information about any student.';

/**
 * The AI assistant disclosure — the ONE place student data may leave the
 * device, and only under explicit, per-question conditions. The admin can
 * switch the whole feature off (AI Settings), which also removes this.
 */
export const PRIVACY_AI_NOTE =
  'If your administrator has enabled the AI assistant, then ONLY when you ' +
  'actively send a question, your current tool data (results, semesters, ' +
  'target and planned credits) is sent to the AI provider they configured, ' +
  'for that question. It is not stored by the app, not included in anything ' +
  'you do not ask, and it is never used for the local calculations. When the ' +
  'assistant is off, or you never ask it, nothing about you is ever sent.';

/**
 * Clear the temporary academic session. The actual reset is performed by the
 * in-memory store dispatch; this is the service entry point the UI calls.
 */
export function resetSession(resetStore: () => void): void {
  resetStore();
}

/**
 * Full clear: temporary session AND the optional cached curriculum config.
 * The app then falls back to the curriculum bundled in the build, so it
 * remains functional offline.
 */
export function clearEverything(resetStore: () => void): void {
  resetStore();
  resetCurriculumCache();
}
