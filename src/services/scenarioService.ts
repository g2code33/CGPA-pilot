// ─────────────────────────────────────────────────────────────────────────
// scenarioService — what-if and next-semester projections. Pure functions
// over hypothetical grades; never mutates stored academic state.
// ─────────────────────────────────────────────────────────────────────────

import type { ClassificationSystem, GradingSystem } from '../config/types';
import type { CourseEntry, SemesterEntry } from '../state/studentState';
import { pointsForGrade, maxGradePoints } from './gradingService';
import { classifyCgpa } from './classificationService';
import { analyzeTarget } from './targetService';
import type { TargetStatus } from './targetService';
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

// ─────────────────────────────────────────────────────────────────────────
// FUTURE GPA SCENARIOS (Prompt 11)
//
// "What if my next GPA is 3.0 / 3.5 / 4.0?" — credit-weighted projections of
// a hypothetical future GPA over a future credit load, computed WITHOUT
// mutating the student's confirmed record. Pure functions; nothing is saved,
// and individual course grades are never inferred (an aggregate GPA only).
// ─────────────────────────────────────────────────────────────────────────

export interface FutureScenarioInput {
  /** Confirmed quality points so far. */
  currentPoints: number;
  /** Confirmed credits so far. */
  currentCredits: number;
  /** Confirmed CGPA so far (may be null before entry). */
  currentCgpa: number | null;
  /** Credit load of the hypothetical next period. */
  futureCredits: number;
  /** Hypothetical average GPA for that period. */
  futureGpa: number;
  /** Credits remaining to graduation (for the final-trajectory effect). */
  remainingCredits: number;
  targetCgpa: number;
  label?: string;
}

export type ScenarioVerdict =
  | 'meets-target'
  | 'reachable'
  | 'very-demanding'
  | 'extremely-demanding'
  | 'impossible'
  | 'unknown';

export interface FutureScenario {
  label: string;
  futureGpa: number;
  futureCredits: number;
  /** The hypothetical period's GPA (echoes the assumption). */
  projectedSemesterGpa: number;
  /** CGPA after the hypothetical period. */
  projectedCgpa: number | null;
  /** Δ versus the current confirmed CGPA (positive = improves). */
  differenceFromCurrent: number | null;
  /** projectedCgpa − target (negative = still short). */
  differenceFromTarget: number | null;
  /** CGPA at graduation if the SAME average is held over all remaining. */
  trajectoryFinalCgpa: number | null;
  /** Quality points the future period would add. */
  addedPoints: number;
  /** After the next period, the future GPA still required to hit target. */
  requiredFutureGpaAfter: number | null;
  /** Feasibility after the scenario period. */
  targetStatus: ScenarioVerdict;
  targetStatusLabel: string;
  classification: ClassificationBand | null;
}

const VERDICT_LABEL: Record<ScenarioVerdict, string> = {
  'meets-target': 'Hits the target',
  reachable: 'Target still reachable',
  'very-demanding': 'Very demanding',
  'extremely-demanding': 'Extremely demanding',
  impossible: 'Mathematically impossible',
  unknown: 'Awaiting data',
};

export function futureScenario(
  input: FutureScenarioInput,
  grading: GradingSystem,
  classification: ClassificationSystem
): FutureScenario {
  const {
    currentPoints,
    currentCredits,
    futureCredits,
    futureGpa,
    remainingCredits,
    targetCgpa,
  } = input;
  const addedPoints = futureGpa * futureCredits;
  const projectedCgpa =
    currentCredits + futureCredits > 0
      ? (currentPoints + addedPoints) / (currentCredits + futureCredits)
      : null;

  const totalRemaining = Math.max(remainingCredits, futureCredits);
  const trajectoryFinalCgpa =
    currentCredits + totalRemaining > 0
      ? (currentPoints + futureGpa * totalRemaining) /
        (currentCredits + totalRemaining)
      : null;

  // After this period, what future average is still required?
  const remainingAfter = Math.max(0, remainingCredits - futureCredits);
  let requiredFutureGpaAfter: number | null = null;
  let status: ScenarioVerdict = 'unknown';

  const afterPoints = currentPoints + addedPoints;
  const afterCredits = currentCredits + futureCredits;

  const analysis = analyzeTarget(
    {
      currentPoints: afterPoints,
      creditsCompleted: afterCredits,
      creditsRemaining: remainingAfter,
      targetCgpa,
      currentCgpa: projectedCgpa,
    },
    grading,
    classification
  );

  if (projectedCgpa !== null && projectedCgpa >= targetCgpa - 1e-9) {
    status = 'meets-target';
  } else {
    switch (analysis.status) {
      case 'achievable':
        status = 'reachable';
        break;
      case 'very-demanding':
        status = 'very-demanding';
        break;
      case 'extremely-demanding':
        status = 'extremely-demanding';
        break;
      case 'impossible':
        status = 'impossible';
        break;
      default:
        status = 'unknown';
    }
  }
  requiredFutureGpaAfter = analysis.requiredFutureGpa;

  return {
    label: input.label ?? `GPA ${futureGpa.toFixed(2)}`,
    futureGpa,
    futureCredits,
    projectedSemesterGpa: futureGpa,
    projectedCgpa,
    differenceFromCurrent:
      projectedCgpa !== null && input.currentCgpa !== null
        ? projectedCgpa - input.currentCgpa
        : null,
    differenceFromTarget:
      projectedCgpa !== null ? projectedCgpa - targetCgpa : null,
    trajectoryFinalCgpa,
    addedPoints,
    requiredFutureGpaAfter,
    targetStatus: status,
    targetStatusLabel: VERDICT_LABEL[status],
    classification: classifyCgpa(projectedCgpa, classification),
  };
}

/**
 * Config-driven scenario PRESETS. Conservative holds the current CGPA; Target
 * uses the average required to reach the target (capped at the ceiling);
 * Excellent uses the top grade. All thresholds derive from the grading bands —
 * nothing is hard-coded.
 */
export interface ScenarioPreset {
  id: 'conservative' | 'target' | 'excellent';
  label: string;
  gpa: number;
  hint: string;
}

export function scenarioPresets(
  grading: GradingSystem,
  currentCgpa: number | null,
  requiredFutureGpa: number | null
): ScenarioPreset[] {
  const top = maxGradePoints(grading);
  const conservative =
    currentCgpa === null ? Math.round(top * 0.75 * 100) / 100 : currentCgpa;
  const target =
    requiredFutureGpa === null
      ? top
      : Math.min(top, Math.max(0, requiredFutureGpa));
  return [
    {
      id: 'conservative',
      label: 'Conservative',
      gpa: Math.round(conservative * 100) / 100,
      hint: 'Keep your current CGPA',
    },
    {
      id: 'target',
      label: 'Target',
      gpa: Math.round(target * 100) / 100,
      hint: requiredFutureGpa !== null && requiredFutureGpa <= top + 1e-9
        ? 'Average that reaches your target'
        : 'Top grades still fall short',
    },
    {
      id: 'excellent',
      label: 'Excellent',
      gpa: top,
      hint: 'Straight top grades',
    },
  ];
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
