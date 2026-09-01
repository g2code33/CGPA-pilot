// ─────────────────────────────────────────────────────────────────────────
// Student academic state — TEMPORARY, IN-MEMORY ONLY.
// Never persisted (no localStorage / sessionStorage / IndexedDB / cookies /
// URLs); destroyed on refresh or Clear. Kept separate from curriculum
// configuration (which IS cached offline, non-personal).
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
  /** Which configured level/semester this maps to (for auto credit loads). */
  levelIndex: number;
  semesterIndex: number;
  /**
   * Student-entered semester GPA (GPA-history mode). Quality points are
   * derived as GPA × credit hours. This never implies individual grades.
   */
  gpa: number | null;
  /**
   * Optional manual override of the semester's credit load. When null, the
   * configured curriculum's credit load is used (or the course-level total
   * if the student entered courses).
   */
  creditHoursOverride: number | null;
  /** Optional detailed course-level entry (advanced; not required). */
  courses: CourseEntry[];
}

export interface CurrentBaseline {
  /** Student's current level, e.g. 2 for Level 200. */
  levelIndex: number;
  /** Last completed semester within the current level (1 or 2). */
  semesterIndex: number;
  cgpa: number | null;
  /** Manual total credits completed (used when the curriculum is unpublished). */
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
  points: number; // quality/grade points counted
  cgpa: number | null;
  pendingCreditHours: number; // hours awaiting results
  pendingCount: number;
}
