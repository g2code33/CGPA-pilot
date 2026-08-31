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
  'Every calculation runs locally on your device — CGPA, targets, feasibility, what-ifs, flight path and projections.',
  'Works fully offline after first load. No internet, API calls, cloud functions, online databases, logins or external AI are used for calculations.',
  'Asks only for the numbers needed for a calculation (e.g. credit hours and grades, or current CGPA and total credits).',
  'Treats everything you type as a temporary session: close the tab, refresh, or press Refresh/Clear and it is gone.',
  'Prints an anonymous brief — no name or student ID appears, and the file stays on your device.',
];

export const PRIVACY_NEVERS: string[] = [
  'Does NOT ask for your name, student ID, email or phone number.',
  'Does NOT create accounts or a student database.',
  'Does NOT persist your CGPA, GPA, grades, targets or scenarios in any browser storage or database.',
  'Does NOT put your academic data in the web address (URL).',
  'Does NOT upload your transcript or course results anywhere.',
  'Does NOT use tracking or analytics storage tied to your academic data.',
];

export const PRIVACY_OFFLINE_NOTE =
  'The app caches only published, non-personal academic configuration ' +
  '(grading and classification rules, and published curricula) so it works ' +
  'offline. That configuration contains no information about any student.';

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
