// ─────────────────────────────────────────────────────────────────────────
// Student academic state — TEMPORARY, IN-MEMORY ONLY.
// Never persisted (no localStorage / sessionStorage / IndexedDB / cookies /
// URLs); destroyed on refresh or Clear. Kept separate from curriculum
// configuration (which IS cached offline, non-personal).
// ─────────────────────────────────────────────────────────────────────────

/**
 * The three student-facing input experiences (Prompt 8):
 *  - 'quick'    : current level + current CGPA only.
 *  - 'history'  : semester-by-semester GPA history.
 *  - 'planning' : current CGPA + target classification + future scenarios.
 * Internally 'quick' and 'planning' both resolve to the current-CGPA engine
 * mode; 'history' resolves to the history engine mode.
 */
export type InputMode = 'quick' | 'history' | 'planning';

/** Engine data mode: a history of semesters, or a current-CGPA baseline. */
export type CalcMode = 'history' | 'current';

/**
 * Result status for a semester/course.
 *  - 'complete'    : a confirmed grade/GPA is entered and counts in the CGPA.
 *  - 'pending'     : results are not released yet. NEVER treated as a known
 *                    grade: excluded from the confirmed CGPA, but its known
 *                    credit hours feed best-/worst-case projections.
 *  - 'not-entered' : the student simply hasn't provided anything yet.
 */
export type ResultStatus = 'complete' | 'pending' | 'not-entered';

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
  /**
   * The whole semester's results are pending release. The semester is
   * excluded from the confirmed CGPA; its (curriculum-known) credit hours
   * are treated as pending and used only in projections.
   */
  pending: boolean;
}

export interface CurrentBaseline {
  /** Student's current level, e.g. 2 for Level 200. */
  levelIndex: number;
  /** Last completed semester within the current level (1 or 2). */
  semesterIndex: number;
  cgpa: number | null;
  /** Manual total credits completed (used when the curriculum is unpublished). */
  creditHours: number;
  /**
   * Credits whose results are pending release within the completed period.
   * The current CGPA reflects only released results; these credits are
   * excluded from the confirmed position and used only in projections.
   */
  pendingCreditHours: number;
  /** True when the student just entered this level/semester — completed credits exclude the current semester. */
  justEntered?: boolean;
}

export interface AcademicState {
  /** The student-facing input experience (quick / history / planning). */
  inputMode: InputMode;
  /** Engine data mode derived from inputMode ('current' for quick/planning). */
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
