// ─────────────────────────────────────────────────────────────────────────
// CORE CGPA CALCULATION ENGINE  (the central mathematical component)
//
// Principles:
//  • CREDIT-WEIGHTED. CGPA = total quality points ÷ total applicable credits.
//    Semester GPAs are NEVER simply averaged — each is weighted by its
//    semester credit load (Quality Points = GPA × Semester Credits).
//  • FULL INTERNAL PRECISION. No rounding of intermediate values; rounding is
//    applied only when results are displayed (see util/format).
//  • CONFIG-DRIVEN. Credit loads come from the configured curriculum; the
//    engine never assumes a fixed load.
//  • A semester GPA is treated only as an aggregate. Individual course grades
//    are NEVER inferred from a semester GPA.
// ─────────────────────────────────────────────────────────────────────────

import type { GradingSystem } from '../config/types';
import type {
  AcademicState,
  CourseEntry,
  ResultStatus,
  SemesterEntry,
} from '../state/studentState';
import { gradePointsForCourse } from './gradingService';
import { maxGradePoints } from './gradingService';

/** Effective per-semester credit load:
 *  manual override → sum of entered graded courses → configured curriculum. */
export function semesterCreditHours(
  semester: SemesterEntry,
  configuredCredits?: number
): number {
  if (semester.creditHoursOverride !== null) {
    return semester.creditHoursOverride;
  }
  const fromCourses = semester.courses
    .filter((c) => !c.pending)
    .reduce((sum, c) => sum + (c.creditHours || 0), 0);
  if (fromCourses > 0) return fromCourses;
  return configuredCredits ?? 0;
}

/** Quality points and GPA for one semester entry (weighted, unrounded). */
export interface SemesterTerm {
  creditHours: number;
  qualityPoints: number;
  gpa: number | null;
  /**
   * 'gpa' = student-provided semester GPA; 'courses' = derived from courses;
   * 'pending' = whole-semester result pending; 'none' = nothing entered.
   */
  source: 'gpa' | 'courses' | 'pending' | 'none';
  pendingCreditHours: number;
  pendingCount: number;
}

/**
 * Status of a semester's results. A whole-semester pending flag is explicit;
 * otherwise it is 'complete' when a confirmed GPA/graded courses exist and
 * 'not-entered' when nothing has been supplied.
 */
export function semesterStatus(semester: SemesterEntry): ResultStatus {
  if (semester.pending) return 'pending';
  if (
    semester.courses.some((c) => !c.pending && (c.grade || c.score !== null)) ||
    (semester.gpa !== null && !Number.isNaN(semester.gpa))
  ) {
    return 'complete';
  }
  return 'not-entered';
}

/** Status of an individual course entry. */
export function courseStatus(course: CourseEntry): ResultStatus {
  if (course.pending) return 'pending';
  if (course.grade || course.score !== null) return 'complete';
  return 'not-entered';
}

export function semesterTerm(
  semester: SemesterEntry,
  grading: GradingSystem,
  configuredCredits?: number
): SemesterTerm {
  // Whole-semester pending: NEVER treated as a known grade. It contributes
  // nothing to the confirmed CGPA, but its known credit load (curriculum /
  // override / entered courses) is reported as pending for projections.
  if (semester.pending) {
    const enteredCourseCredits = semester.courses.reduce(
      (sum, c) => sum + (c.creditHours || 0),
      0
    );
    const pendingCredits =
      semester.creditHoursOverride ?? configuredCredits ??
      (enteredCourseCredits > 0 ? enteredCourseCredits : 0);
    return {
      creditHours: 0,
      qualityPoints: 0,
      gpa: null,
      source: 'pending',
      pendingCreditHours: pendingCredits,
      pendingCount: 1,
    };
  }

  const pendingCourses = semester.courses.filter((c) => c.pending);
  const pendingCreditHours = pendingCourses.reduce(
    (sum, c) => sum + (c.creditHours || 0),
    0
  );
  const pendingCount = pendingCourses.length;

  // 1) Detailed course-level entry → derive GPA from graded courses.
  const gradedCourses = semester.courses.filter((c) => !c.pending);
  const coursePoints = gradedCourses.reduce((sum, c) => {
    const pts = gradePointsForCourse(c, grading);
    return sum + (pts ?? 0);
  }, 0);
  const courseCredits = gradedCourses.reduce((sum, c) => {
    // Count the course only if it produced grade points (has a grade/score).
    const pts = gradePointsForCourse(c, grading);
    return sum + (pts !== null ? c.creditHours || 0 : 0);
  }, 0);

  if (courseCredits > 0) {
    return {
      creditHours: courseCredits,
      qualityPoints: coursePoints,
      gpa: coursePoints / courseCredits,
      source: 'courses',
      pendingCreditHours,
      pendingCount,
    };
  }

  // 2) GPA-history mode: student entered only the semester GPA. Weight it by
  //    the configured/override credit load. Never infers course grades.
  if (semester.gpa !== null && !Number.isNaN(semester.gpa)) {
    const credits =
      semester.creditHoursOverride ?? configuredCredits ?? 0;
    return {
      creditHours: credits,
      qualityPoints: semester.gpa * credits,
      gpa: semester.gpa,
      source: credits > 0 ? 'gpa' : 'none',
      pendingCreditHours,
      pendingCount,
    };
  }

  return {
    creditHours: 0,
    qualityPoints: 0,
    gpa: null,
    source: 'none',
    pendingCreditHours,
    pendingCount,
  };
}

export interface CgpaResult {
  totalCreditHours: number;
  totalQualityPoints: number;
  /** Weighted CGPA at full precision; null when no applicable credits. */
  cgpa: number | null;
  terms: SemesterTerm[];
  pendingCreditHours: number;
  pendingCount: number;
}

/** Credit-weighted CGPA across all entered semesters. */
export function weightedCgpa(
  semesters: SemesterEntry[],
  grading: GradingSystem,
  configuredCreditsFor?: (levelIndex: number, semesterIndex: number) => number
): CgpaResult {
  const terms = semesters.map((s) =>
    semesterTerm(
      s,
      grading,
      configuredCreditsFor?.(s.levelIndex, s.semesterIndex)
    )
  );
  const totalCreditHours = terms.reduce((sum, t) => sum + t.creditHours, 0);
  const totalQualityPoints = terms.reduce((sum, t) => sum + t.qualityPoints, 0);
  return {
    totalCreditHours,
    totalQualityPoints,
    cgpa: totalCreditHours > 0 ? totalQualityPoints / totalCreditHours : null,
    terms,
    pendingCreditHours: terms.reduce((s, t) => s + t.pendingCreditHours, 0),
    pendingCount: terms.reduce((s, t) => s + t.pendingCount, 0),
  };
}

/** Current-CGPA mode record: the baseline CGPA is converted back to quality
 *  points using completed credits (curriculum-derived or manually entered). */
export interface CurrentRecord {
  creditHours: number;
  qualityPoints: number;
  cgpa: number | null;
  fromCurriculum: boolean;
}

export function currentModeRecord(
  baseline: AcademicState['baseline'],
  curriculumCompletedCredits: number | null
): CurrentRecord {
  const fromCurriculum =
    curriculumCompletedCredits !== null && curriculumCompletedCredits > 0;
  const totalCompleted = fromCurriculum
    ? (curriculumCompletedCredits as number)
    : baseline.creditHours || 0;
  // Pending results within the completed period are NOT part of the CGPA the
  // student reported — they are confirmed-excluded and projected separately.
  const pending = Math.max(0, baseline.pendingCreditHours || 0);
  const creditHours = Math.max(0, totalCompleted - pending);
  const cgpa = baseline.cgpa;
  return {
    creditHours,
    qualityPoints: cgpa !== null ? cgpa * creditHours : 0,
    cgpa: creditHours > 0 ? cgpa : null,
    fromCurriculum,
  };
}

export interface EngineSnapshot {
  mode: AcademicState['mode'];
  creditHours: number;
  qualityPoints: number;
  cgpa: number | null;
  pendingCreditHours: number;
  pendingCount: number;
}

/** The single entry point views use: credit-weighted CGPA for either mode. */
export function computeSnapshot(
  state: AcademicState,
  grading: GradingSystem,
  options?: {
    configuredCreditsFor?: (levelIndex: number, semesterIndex: number) => number;
    curriculumCompletedCredits?: number | null;
  }
): EngineSnapshot {
  if (state.mode === 'current') {
    const rec = currentModeRecord(
      state.baseline,
      options?.curriculumCompletedCredits ?? null
    );
    const pendingCredits = Math.max(0, state.baseline.pendingCreditHours || 0);
    return {
      mode: 'current',
      creditHours: rec.creditHours,
      qualityPoints: rec.qualityPoints,
      cgpa: rec.cgpa,
      pendingCreditHours: pendingCredits,
      pendingCount: pendingCredits > 0 ? 1 : 0,
    };
  }
  const r = weightedCgpa(
    state.semesters,
    grading,
    options?.configuredCreditsFor
  );
  return {
    mode: 'history',
    creditHours: r.totalCreditHours,
    qualityPoints: r.totalQualityPoints,
    cgpa: r.cgpa,
    pendingCreditHours: r.pendingCreditHours,
    pendingCount: r.pendingCount,
  };
}

// ── Feasibility helpers (full precision; ceiling from the grading system) ──

export function engineMaxPoints(grading: GradingSystem): number {
  return maxGradePoints(grading);
}

/**
 * Maximum possible FINAL CGPA: every remaining credit earns the top grade.
 * Works in both modes given the confirmed quality points/credits so far.
 */
export function maximumFinalCgpa(
  qualityPoints: number,
  completedCredits: number,
  remainingCredits: number,
  grading: GradingSystem
): number | null {
  const total = completedCredits + remainingCredits;
  if (total <= 0) return null;
  const max = maxGradePoints(grading);
  return (qualityPoints + max * remainingCredits) / total;
}

/** Required average GPA over the remaining credits to hit `target`. */
export function requiredFutureGpaPrecise(
  qualityPoints: number,
  completedCredits: number,
  remainingCredits: number,
  target: number
): number | null {
  if (remainingCredits <= 0) return null;
  return (
    (target * (completedCredits + remainingCredits) - qualityPoints) /
    remainingCredits
  );
}

/** Target feasibility against the configured grading ceiling. */
export function targetFeasible(
  requiredGpa: number | null,
  grading: GradingSystem
): boolean {
  if (requiredGpa === null) return false;
  return requiredGpa <= maxGradePoints(grading) + 1e-9;
}

// re-export for convenience/tests
export type { CourseEntry };
