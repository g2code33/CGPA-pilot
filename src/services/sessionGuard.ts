// ─────────────────────────────────────────────────────────────────────────
// sessionGuard — strict privacy / reset & refresh protection.
//
// Student academic information lives ONLY in memory. Two guarantees are
// enforced here:
//
//  1. hasEnteredAcademicData() detects whether the temporary session holds
//     any student-entered information, so the app can warn before a browser
//     refresh/tab-close would destroy it.
//
//  2. installBeforeUnloadGuard() registers a `beforeunload` warning while a
//     session is dirty. The warning is suppressed for the explicit
//     Refresh/Clear action (markIntentionalReload), because there the user
//     has already approved the wipe in the confirmation modal.
//
// Nothing here reads or writes storage — student data is never persisted,
// never put in a URL, and never synchronized.
// ─────────────────────────────────────────────────────────────────────────

import type { AcademicState, CourseEntry, SemesterEntry } from '../state/studentState';

function courseHasData(c: CourseEntry): boolean {
  return (
    c.score !== null ||
    c.grade !== null ||
    c.pending ||
    c.code.trim() !== '' ||
    c.name.trim() !== ''
  );
}

function semesterHasData(sem: SemesterEntry): boolean {
  return (
    sem.gpa !== null ||
    sem.pending ||
    sem.creditHoursOverride !== null ||
    sem.courses.some(courseHasData)
  );
}

/**
 * Whether any student-entered academic information exists in the temporary
 * session. Configuration choices (target CGPA, planned credit hours, input
 * mode toggles) are NOT counted — only actual academic data.
 */
export function hasEnteredAcademicData(s: AcademicState): boolean {
  if (s.mode === 'history') {
    return s.semesters.some(semesterHasData);
  }
  // Current/quick/planning mode: a position has been entered once the
  // baseline holds a CGPA, completed credits, pending credits, or a level
  // beyond the fresh default (Level 100 · Sem 1).
  return (
    s.baseline.cgpa !== null ||
    s.baseline.creditHours > 0 ||
    s.baseline.pendingCreditHours > 0 ||
    s.baseline.levelIndex !== 1 ||
    s.baseline.semesterIndex !== 1 ||
    s.semesters.some(semesterHasData)
  );
}

/**
 * Set when the user explicitly approves "Clear & Refresh". The next
 * beforeunload (caused by our own reload) must NOT show the loss warning.
 */
let intentionalReload = false;

export function markIntentionalReload(): void {
  intentionalReload = true;
}

/**
 * Warn the user that refreshing or closing the tab will discard temporary
 * calculations, but only while the session holds entered data. Returns a
 * cleanup function. Where a platform does not support beforeunload (e.g.
 * some mobile webviews), this is a safe no-op — the data is still in-memory
 * only and simply does not survive reload.
 */
export function installBeforeUnloadGuard(isDirty: () => boolean): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = (e: BeforeUnloadEvent) => {
    if (intentionalReload || !isDirty()) return;
    e.preventDefault();
    // Browsers show their own generic wording; assigning returnValue is the
    // standard trigger for the confirmation prompt.
    e.returnValue =
      'Your current calculations are temporary and will be lost if you leave or refresh. Use Refresh/Clear to start fresh intentionally.';
    return e.returnValue;
  };

  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}
