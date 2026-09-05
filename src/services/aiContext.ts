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
 */
export function hasAnyStudentData(state: AcademicState): boolean {
  if (state.mode === 'history') {
    return state.semesters.some((s) => s.gpa !== null) || state.semesters.some((s) => s.courses.some((c) => c.grade !== null || c.score !== null));
  }
  return state.baseline.cgpa !== null;
}

/** Build the AI context from the academic state + derived record + context. */
export function buildAiContext(
  state: AcademicState,
  record: AiRecord,
  classification: string | null,
  institution: AiInstitution
): AiStudentContext {
  const hasAnyData = hasAnyStudentData(state);

  const semesters =
    state.mode === 'history'
      ? state.semesters.map((s) => ({
          label: s.label,
          gpa: s.gpa,
          credits:
            s.creditHoursOverride ??
            s.courses.reduce((sum, c) => sum + (Number.isFinite(c.creditHours) ? c.creditHours : 0), 0),
          pending: s.pending,
          courses: s.courses
            .filter((c) => c.pending)
            .map((c) => ({
              code: c.code || '—',
              grade: c.grade,
              credits: c.creditHours,
              pending: true,
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
  };
}
