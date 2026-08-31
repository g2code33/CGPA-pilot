import type { GradeBand, GradingScale, ClassificationRules } from '../config/types';
import type { CourseEntry } from './types';

export function bandForScore(score: number, scale: GradingScale): GradeBand {
  const band = scale.bands.find((b) => score >= b.minScore && score <= b.maxScore);
  return band ?? scale.bands[scale.bands.length - 1];
}

export function pointsForGrade(grade: string, scale: GradingScale): number | null {
  const band = scale.bands.find((b) => b.grade === grade);
  return band ? band.points : null;
}

/** Effective letter grade for a course (manual grade overrides score). */
export function courseGrade(
  course: CourseEntry,
  scale: GradingScale
): string | null {
  if (course.pending) return null;
  if (course.grade) return course.grade;
  if (course.score !== null && !Number.isNaN(course.score)) {
    return bandForScore(course.score, scale).grade;
  }
  return null;
}

/** Grade points earned by a course = credits × grade point; null if not graded. */
export function coursePoints(
  course: CourseEntry,
  scale: GradingScale
): number | null {
  const grade = courseGrade(course, scale);
  if (grade === null) return null;
  const pts = pointsForGrade(grade, scale);
  if (pts === null) return null;
  return pts * (course.credits || 0);
}

export function classify(
  cgpa: number | null,
  rules: ClassificationRules
) {
  if (cgpa === null) return null;
  return (
    rules.bands.find((b) => cgpa >= b.minCgpa && cgpa <= b.maxCgpa) ??
    rules.bands[rules.bands.length - 1]
  );
}
