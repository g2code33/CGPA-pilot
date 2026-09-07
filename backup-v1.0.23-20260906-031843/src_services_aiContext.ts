// ─────────────────────────────────────────────────────────────────────────
// aiContext — builds the AI's "student context" block from the app's LIVE,
// in-memory tool data. Pure + testable (no DOM/network): the AI view calls
// this on each question, and the payload is sent to the configured provider
// ONLY for that question (nothing stored, nothing uploaded otherwise).
//
// The same shape is consumed by the Worker (formatAiContext) so the model
// always receives a compact, deterministic block.
// ─────────────────────────────────────────────────────────────────────────

import type { AiStudentContext } from '../admin/aiSettings';
import type { AcademicState } from '../state/studentState';
import {
  currentLevelEntryKind,
  effectiveHistorySemesters,
  type HistoryJourney,
} from './historyProgress';

export interface AiRecord {
  creditHours: number;
  points: number;
  cgpa: number | null;
  pendingCreditHours: number;
}

export interface AiInstitution {
  university?: string;
  school?: string;
  programme?: string;
}

/**
 * True when the student has entered anything the tools can work with — the
 * AI uses this to decide between "answer with your real numbers" and
 * "refer them to fill in the tools first".
 *
 * History mode counts only CONFIRMED entries: if the chosen level's semester
 * has no released results yet, its entry does not count (same rule as the
 * engine and the journey).
 */
export function hasAnyStudentData(state: AcademicState): boolean {
  if (state.mode === 'history') {
    const confirmed = effectiveHistorySemesters(
      state.semesters,
      state.baseline.levelIndex,
      state.baseline.standing ?? 'released',
      state.baseline.semesterIndex
    );
    return (
      confirmed.some((s) => s.gpa !== null) ||
      confirmed.some((s) => s.courses.some((c) => c.grade !== null || c.score !== null))
    );
  }
  return state.baseline.cgpa !== null;
}

/** Build the AI context from the academic state + derived record + context.
 *  `journey` (GPA-History mode only) carries the Level 100 → now progress
 *  so the assistant can answer about the student's whole trajectory. */
export function buildAiContext(
  state: AcademicState,
  record: AiRecord,
  classification: string | null,
  institution: AiInstitution,
  journey?: HistoryJourney | null
): AiStudentContext {
  const hasAnyData = hasAnyStudentData(state);

  // History mode receives only CONFIRMED entries (the chosen level's entry is
  // dropped when its semester has no released results yet), and a
  // first-semester interpretation is labelled as such so the model never
  // treats it as a whole-level CGPA.
  const historyKind = currentLevelEntryKind(
    state.baseline.standing ?? 'released',
    state.baseline.semesterIndex
  );
  const semesters =
    state.mode === 'history'
      ? effectiveHistorySemesters(
          state.semesters,
          state.baseline.levelIndex,
          state.baseline.standing ?? 'released',
          state.baseline.semesterIndex
        ).map((s) => ({
          label:
            s.levelIndex === state.baseline.levelIndex && historyKind === 'first-semester'
              ? `Level ${s.levelIndex * 100} · First semester CGPA`
              : s.label,
          gpa: s.gpa,
          credits:
            s.creditHoursOverride ??
            s.courses.reduce((sum, c) => sum + (Number.isFinite(c.creditHours) ? c.creditHours : 0), 0),
          pending: s.pending,
          // FULL course list (graded AND pending) — the model needs the real
          // grades/credits to quote or reproduce the student's tables.
          courses: s.courses
            .filter((c) => c.code || c.grade !== null || c.score !== null || c.pending)
            .map((c) => ({
              code: c.code || '—',
              grade: c.grade,
              credits: c.creditHours,
              pending: c.pending,
            })),
        }))
      : [];

  return {
    institution,
    mode: state.mode,
    levelIndex: state.baseline.levelIndex,
    semesterIndex: state.baseline.semesterIndex,
    confirmedCgpa: record.cgpa,
    gradedCredits: record.creditHours,
    classification,
    semesters,
    pendingCredits: record.pendingCreditHours,
    targetCgpa: state.targetCgpa,
    plannedNextCredits: state.plannedNextCreditHours,
    hasAnyData,
    // Level 100 → now journey (History mode) — per-level CGPA, the running
    // CGPA, and which levels are still missing (the model must respect the
    // completeness rule and never invent CGPAs for missing levels).
    journey:
      state.mode === 'history' && journey
        ? journey.levels.map((l) => ({
            level: l.levelIndex,
            cgpa: l.cgpa,
            cumulativeCgpa: l.cumulativeCgpa,
            status: l.status,
          }))
        : undefined,
  };
}
