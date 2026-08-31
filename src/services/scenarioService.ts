// ─────────────────────────────────────────────────────────────────────────
// scenarioService — what-if and next-semester projections. Pure functions
// over hypothetical grades; never mutates stored academic state.
// ─────────────────────────────────────────────────────────────────────────

import type { ClassificationSystem, GradingSystem } from '../config/types';
import type { CourseEntry, SemesterEntry } from '../state/studentState';
import { pointsForGrade } from './gradingService';
import { classifyCgpa } from './classificationService';
import type { ClassificationBand } from '../config/types';

export interface ScenarioInput {
  basePoints: number;
  baseCreditHours: number;
  /** grade chosen per pending-course id */
  assumedGrades: Record<string, string>;
  pendingCourses: (CourseEntry & { semesterLabel?: string })[];
  /** hypothetical future semester entries (with chosen grades) */
  hypothetical: { creditHours: number; grade: string | null }[];
}

export interface ScenarioResult {
  addedPoints: number;
  addedCreditHours: number;
  scenarioCgpa: number | null;
  classification: ClassificationBand | null;
}

export function runWhatIf(
  input: ScenarioInput,
  grading: GradingSystem,
  classification: ClassificationSystem
): ScenarioResult {
  let addedPoints = 0;
  let addedCreditHours = 0;

  for (const c of input.pendingCourses) {
    const grade = input.assumedGrades[c.id];
    if (!grade) continue;
    const pts = pointsForGrade(grade, grading);
    if (pts === null) continue;
    addedPoints += pts * c.creditHours;
    addedCreditHours += c.creditHours;
  }
  for (const h of input.hypothetical) {
    if (!h.grade) continue;
    const pts = pointsForGrade(h.grade, grading);
    if (pts === null) continue;
    addedPoints += pts * h.creditHours;
    addedCreditHours += h.creditHours;
  }

  const totalCreditHours = input.baseCreditHours + addedCreditHours;
  const totalPoints = input.basePoints + addedPoints;
  const cgpa = totalCreditHours > 0 ? totalPoints / totalCreditHours : null;

  return {
    addedPoints,
    addedCreditHours,
    scenarioCgpa: cgpa,
    classification: classifyCgpa(cgpa, classification),
  };
}

/** Collect pending (awaiting-result) courses across semesters. */
export function collectPending(
  semesters: SemesterEntry[]
): (CourseEntry & { semesterLabel: string })[] {
  return semesters.flatMap((s) =>
    s.courses
      .filter((c) => c.pending)
      .map((c) => ({ ...c, semesterLabel: s.label }))
  );
}

export interface NextSemesterScenario {
  grade: string;
  gpa: number;
  interpretation?: string;
  newCgpa: number | null;
  classification: ClassificationBand | null;
  meetsTarget: boolean | null;
}

export function nextSemesterScenarios(
  basePoints: number,
  baseCreditHours: number,
  nextCreditHours: number,
  target: number | null,
  grading: GradingSystem,
  classification: ClassificationSystem
): NextSemesterScenario[] {
  return grading.bands
    .filter((b) => b.points > 0)
    .map((b) => {
      const newPoints = basePoints + b.points * nextCreditHours;
      const total = baseCreditHours + nextCreditHours;
      const newCgpa = total > 0 ? newPoints / total : null;
      return {
        grade: b.grade,
        gpa: b.points,
        interpretation: b.interpretation,
        newCgpa,
        classification: classifyCgpa(newCgpa, classification),
        meetsTarget:
          target !== null && newCgpa !== null ? newCgpa >= target : null,
      };
    });
}
