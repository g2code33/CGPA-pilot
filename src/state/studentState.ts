// ─────────────────────────────────────────────────────────────────────────
// Student academic state — TEMPORARY, IN-MEMORY ONLY.
//
// This data is never persisted (no localStorage / sessionStorage /
// IndexedDB / cookies / URLs) and is destroyed on refresh or Clear. It is
// kept separate from curriculum configuration (which IS cached offline).
// ─────────────────────────────────────────────────────────────────────────

export type CalcMode = 'history' | 'current';

export interface CourseEntry {
  id: string;
  code: string;
  name: string;
  /** Credit hours for this course. */
  creditHours: number;
  /** Raw score 0–100, or null when a letter grade was chosen directly. */
  score: number | null;
  /** Letter grade (may be chosen directly or derived from score). */
  grade: string | null;
  /** Result not yet released — excluded from totals, used in scenarios. */
  pending: boolean;
}

export interface SemesterEntry {
  id: string;
  label: string;
  courses: CourseEntry[];
}

export interface CurrentBaseline {
  cgpa: number | null;
  creditHours: number;
}

export interface AcademicState {
  mode: CalcMode;
  semesters: SemesterEntry[];
  baseline: CurrentBaseline;
  /** Degree target the student is navigating towards (e.g. 3.60). */
  targetCgpa: number | null;
  /** Credit hours planned for the upcoming semester. */
  plannedNextCreditHours: number;
}

export interface Totals {
  creditHours: number; // graded hours counted
  points: number; // grade points counted
  cgpa: number | null;
  pendingCreditHours: number; // hours awaiting results
  pendingCount: number;
}
