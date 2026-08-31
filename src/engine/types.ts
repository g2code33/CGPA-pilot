// ─────────────────────────────────────────────────────────────────────────
// Student-facing academic state.
//
// PRIVACY: this is TEMPORARY, in-memory state only. It is never persisted
// (no localStorage / IndexedDB / cookies / URLs) and is destroyed on refresh
// or when the student clears the cockpit. CGPA PILOT is not a records system.
// ─────────────────────────────────────────────────────────────────────────

export type CalcMode =
  | 'history' // student enters semester-by-semester results
  | 'current'; // student starts from their known current CGPA + credits

export interface CourseEntry {
  id: string;
  code: string;
  name: string;
  credits: number;
  /** Raw score 0–100, or null when a letter grade was chosen directly. */
  score: number | null;
  /** Letter grade (may be chosen directly or derived from score). */
  grade: string | null;
  /** Result not yet released — excluded from totals, included in scenarios. */
  pending: boolean;
}

export interface SemesterEntry {
  id: string;
  label: string;
  courses: CourseEntry[];
}

export interface CurrentBaseline {
  cgpa: number | null;
  credits: number;
}

export interface AcademicState {
  mode: CalcMode;
  semesters: SemesterEntry[];
  baseline: CurrentBaseline;
  /** Degree target the student is navigating towards (e.g. 3.60 First Class). */
  targetCgpa: number | null;
  /** Credits planned for the upcoming semester (Next Semester Pilot). */
  plannedNextCredits: number;
}

export interface Totals {
  credits: number; // graded credits counted
  points: number; // grade points counted
  cgpa: number | null;
  pendingCredits: number; // credits awaiting results
  pendingCount: number;
}
