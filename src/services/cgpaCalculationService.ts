// ─────────────────────────────────────────────────────────────────────────
// cgpaCalculationService — GPA/CGPA totals. Pure; always takes the grading
// system as an argument so the core never hard-codes a university's rules.
// ─────────────────────────────────────────────────────────────────────────

import type { GradingSystem } from '../config/types';
import type {
  AcademicState,
  CourseEntry,
  SemesterEntry,
  Totals,
} from '../state/studentState';
import { gradePointsForCourse } from './gradingService';

export function courseTotals(
  course: CourseEntry,
  system: GradingSystem
): { points: number; creditHours: number; counted: boolean } {
  if (course.pending) {
    return { points: 0, creditHours: 0, counted: false };
  }
  const points = gradePointsForCourse(course, system);
  if (points === null) return { points: 0, creditHours: 0, counted: false };
  return { points, creditHours: course.creditHours || 0, counted: true };
}

export function semesterTotals(
  semester: SemesterEntry,
  system: GradingSystem
): Totals {
  let creditHours = 0;
  let points = 0;
  let pendingCreditHours = 0;
  let pendingCount = 0;

  for (const c of semester.courses) {
    if (c.pending) {
      pendingCreditHours += c.creditHours || 0;
      pendingCount += 1;
      continue;
    }
    const pts = gradePointsForCourse(c, system);
    if (pts === null) continue;
    creditHours += c.creditHours || 0;
    points += pts;
  }

  return {
    creditHours,
    points,
    cgpa: creditHours > 0 ? points / creditHours : null,
    pendingCreditHours,
    pendingCount,
  };
}

export function historyTotals(
  semesters: SemesterEntry[],
  system: GradingSystem
): Totals {
  let creditHours = 0;
  let points = 0;
  let pendingCreditHours = 0;
  let pendingCount = 0;
  for (const s of semesters) {
    const t = semesterTotals(s, system);
    creditHours += t.creditHours;
    points += t.points;
    pendingCreditHours += t.pendingCreditHours;
    pendingCount += t.pendingCount;
  }
  return {
    creditHours,
    points,
    cgpa: creditHours > 0 ? points / creditHours : null,
    pendingCreditHours,
    pendingCount,
  };
}

export interface ConfirmedRecord {
  points: number;
  creditHours: number;
  cgpa: number | null;
  pendingCreditHours: number;
  pendingCount: number;
}

/**
 * The student's confirmed record regardless of entry mode.
 * In "current" mode the baseline CGPA is converted back into grade points.
 */
export function confirmedRecord(
  state: AcademicState,
  system: GradingSystem
): ConfirmedRecord {
  if (state.mode === 'current') {
    const creditHours = state.baseline.creditHours || 0;
    const cgpa = state.baseline.cgpa;
    return {
      creditHours,
      points: cgpa !== null ? cgpa * creditHours : 0,
      cgpa: creditHours > 0 ? cgpa : null,
      pendingCreditHours: 0,
      pendingCount: 0,
    };
  }
  const t = historyTotals(state.semesters, system);
  return {
    points: t.points,
    creditHours: t.creditHours,
    cgpa: t.cgpa,
    pendingCreditHours: t.pendingCreditHours,
    pendingCount: t.pendingCount,
  };
}

/** Grade points for a hypothetical set of grades (used by projections). */
export function pointsForHypothetical(
  entries: { creditHours: number; grade: string | null }[],
  system: GradingSystem
): { points: number; creditHours: number } {
  let points = 0;
  let creditHours = 0;
  for (const e of entries) {
    if (!e.grade) continue;
    const pts = gradePointsForCourse(
      {
        id: 'hypo',
        code: '',
        name: '',
        creditHours: e.creditHours,
        score: null,
        grade: e.grade,
        pending: false,
      },
      system
    );
    if (pts === null) continue;
    points += pts;
    creditHours += e.creditHours;
  }
  return { points, creditHours };
}
