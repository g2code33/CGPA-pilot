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
  const bands = [...system.bands].sort((a, b) => a.minScore - b.minScore);
  // Exact inclusive-range match (handles the official contiguous UCC ranges).
  const exact = bands.find((b) => score >= b.minScore && score <= b.maxScore);
  if (exact) return exact;
  // Boundary fallback for decimal scores / gaps: the highest band whose
  // minimum the score reaches; below the lowest band → lowest band.
  const reached = [...bands]
    .sort((a, b) => b.minScore - a.minScore)
    .find((b) => score >= b.minScore);
  return reached ?? bands[0];
}

/** Highest grade point available in a grading system (feasibility ceiling). */
export function maxGradePoints(system: GradingSystem): number {
  return system.bands.reduce((m, b) => Math.max(m, b.points), 0);
}

/** Lowest grade point above zero, used for worst-case projections. */
export function minPositiveGradePoints(system: GradingSystem): number {
  const positive = system.bands.filter((b) => b.points > 0).map((b) => b.points);
  return positive.length ? Math.min(...positive) : 0;
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
