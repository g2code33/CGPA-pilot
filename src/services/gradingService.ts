// ─────────────────────────────────────────────────────────────────────────
// gradingService — grade/score conversions against a configured grading
// system. Pure functions; the GradingSystem is always passed in (config-driven,
// never hard-coded per university).
// ─────────────────────────────────────────────────────────────────────────

import type { GradeBand, GradingSystem } from '../config/types';
import type { CourseEntry } from '../state/studentState';

export function bandForScore(
  score: number,
  system: GradingSystem
): GradeBand {
  const band = system.bands.find((b) => score >= b.minScore && score <= b.maxScore);
  return band ?? system.bands[system.bands.length - 1];
}

export function bandForGrade(
  grade: string,
  system: GradingSystem
): GradeBand | undefined {
  return system.bands.find((b) => b.grade === grade);
}

export function gradeFromScore(score: number, system: GradingSystem): string {
  return bandForScore(score, system).grade;
}

export function pointsForGrade(grade: string, system: GradingSystem): number | null {
  return bandForGrade(grade, system)?.points ?? null;
}

export function isValidGrade(grade: string, system: GradingSystem): boolean {
  return system.bands.some((b) => b.grade === grade);
}

/** Effective letter grade for a student entry (manual grade wins over score). */
export function effectiveGrade(
  course: CourseEntry,
  system: GradingSystem
): string | null {
  if (course.pending) return null;
  if (course.grade) return course.grade;
  if (course.score !== null && !Number.isNaN(course.score)) {
    return gradeFromScore(course.score, system);
  }
  return null;
}

/** Grade points earned = credit hours × grade point; null if ungraded. */
export function gradePointsForCourse(
  course: CourseEntry,
  system: GradingSystem
): number | null {
  const grade = effectiveGrade(course, system);
  if (grade === null) return null;
  const pts = pointsForGrade(grade, system);
  if (pts === null) return null;
  return pts * (course.creditHours || 0);
}
