import type { GradingScale } from '../config/types';
import type { AcademicState, SemesterEntry, Totals } from './types';
import { courseGrade, coursePoints } from './grades';

const MAX_POINTS = 4.0;

export function semesterTotals(
  semester: SemesterEntry,
  scale: GradingScale
): Totals {
  let credits = 0;
  let points = 0;
  let pendingCredits = 0;
  let pendingCount = 0;

  for (const c of semester.courses) {
    if (c.pending || (!c.grade && c.score === null)) {
      if (c.pending) {
        pendingCredits += c.credits || 0;
        pendingCount += 1;
      }
      continue;
    }
    const pts = coursePoints(c, scale);
    if (pts === null) continue;
    credits += c.credits || 0;
    points += pts;
  }

  return {
    credits,
    points,
    cgpa: credits > 0 ? points / credits : null,
    pendingCredits,
    pendingCount,
  };
}

export function historyTotals(
  semesters: SemesterEntry[],
  scale: GradingScale
): Totals {
  let credits = 0;
  let points = 0;
  let pendingCredits = 0;
  let pendingCount = 0;
  for (const s of semesters) {
    const t = semesterTotals(s, scale);
    credits += t.credits;
    points += t.points;
    pendingCredits += t.pendingCredits;
    pendingCount += t.pendingCount;
  }
  return {
    credits,
    points,
    cgpa: credits > 0 ? points / credits : null,
    pendingCredits,
    pendingCount,
  };
}

/**
 * The student's confirmed record as { points, credits }, regardless of mode.
 * In "current" mode the baseline CGPA is converted back to points.
 */
export function confirmedRecord(
  state: AcademicState,
  scale: GradingScale
): { points: number; credits: number; pendingCredits: number; pendingCount: number; cgpa: number | null } {
  if (state.mode === 'current') {
    const credits = state.baseline.credits || 0;
    const cgpa = state.baseline.cgpa;
    return {
      credits,
      points: cgpa !== null ? cgpa * credits : 0,
      cgpa: credits > 0 ? cgpa : null,
      pendingCredits: 0,
      pendingCount: 0,
    };
  }
  const t = historyTotals(state.semesters, scale);
  return {
    points: t.points,
    credits: t.credits,
    cgpa: t.cgpa,
    pendingCredits: t.pendingCredits,
    pendingCount: t.pendingCount,
  };
}

/** Grade letter for a course — re-exported for views. */
export { courseGrade };

export const GRADE_MAX = MAX_POINTS;
