// ─────────────────────────────────────────────────────────────────────────
// PENDING RESULTS PROJECTIONS
//
// A pending course/semester is NEVER a known grade. This service treats the
// confirmed academic position separately from what *could* happen once the
// pending results are released:
//
//   Confirmed position  — CGPA over confirmed credits only.
//   Best case           — every pending credit earns the TOP grade.
//   Worst case          — every pending credit earns the LOWEST grade
//                         (the mathematical minimum of the grading scale).
//   Possible range      — [worst, best].
//   Effect of pending   — how many credits are unresolved and the swing.
//   Target feasibility  — guaranteed / possible-but-not-guaranteed /
//                         unreachable, using the exact credit-weighted math.
//
// All values are unrounded; the UI rounds for display only.
// ─────────────────────────────────────────────────────────────────────────

import type { ClassificationSystem, GradingSystem } from '../config/types';
import { classifyCgpa } from './classificationService';
import {
  maxGradePoints,
  minPositiveGradePoints,
} from './gradingService';
import type { ClassificationBand } from '../config/types';

export interface PendingProjection {
  /** Credits included in the confirmed CGPA. */
  confirmedCreditHours: number;
  /** Confirmed quality points. */
  confirmedPoints: number;
  /** CGPA from confirmed results only (null when no confirmed credits). */
  confirmedCgpa: number | null;
  confirmedClass: ClassificationBand | null;

  /** Credits awaiting results (known from the configured curriculum). */
  pendingCreditHours: number;
  pendingCount: number;

  /** Best-case CGPA if every pending credit earns the top grade. */
  bestCaseCgpa: number | null;
  bestCaseClass: ClassificationBand | null;
  /** Worst-case CGPA if every pending credit earns the lowest grade. */
  worstCaseCgpa: number | null;
  worstCaseClass: ClassificationBand | null;

  /** Best achievable grade point value (top of the active scale). */
  maxPoints: number;
  /**
   * Lowest positive grade point (the weakest *passing* grade) — used to show
   * the "even a minimum pass" scenario distinctly from the mathematical floor.
   */
  minPositivePoints: number;
  /** CGPA if every pending credit earns the weakest passing grade. */
  minPassCgpa: number | null;
  minPassClass: ClassificationBand | null;

  /** Absolute swing in CGPA between the best and worst outcomes. */
  swing: number;

  /** Average GPA the pending credits must earn to reach the target. */
  requiredPendingGpa: number | null;
  /**
   * Target status given the possible outcomes:
   *  - 'guaranteed' : even the worst case still meets the target,
   *  - 'possible'   : target sits within the possible range,
   *  - 'unreachable': even the best case cannot reach the target,
   *  - null         : no pending credits or no target set.
   */
  targetStatus: 'guaranteed' | 'possible' | 'unreachable' | null;
  /** Classification needed on the pending work to reach the target. */
  targetRequiredClass: ClassificationBand | null;
}

interface PendingInput {
  confirmedPoints: number;
  confirmedCreditHours: number;
  pendingCreditHours: number;
  pendingCount: number;
  target: number | null;
}

function cgpaWith(points: number, credits: number): number | null {
  return credits > 0 ? points / credits : null;
}

/**
 * Compute the confirmed position and best/worst-case projections for a set of
 * pending credits. Pure — receives the confirmed totals and pending credit
 * load (which the engine derives from the published curriculum).
 */
export function pendingProjection(
  input: PendingInput,
  grading: GradingSystem,
  classification: ClassificationSystem
): PendingProjection {
  const { confirmedPoints, confirmedCreditHours, pendingCreditHours, pendingCount } =
    input;
  const max = maxGradePoints(grading);
  const minPositive = minPositiveGradePoints(grading);
  const lowest = 0; // mathematical floor of the scale

  const totalCredits = confirmedCreditHours + pendingCreditHours;

  const confirmedCgpa = cgpaWith(confirmedPoints, confirmedCreditHours);
  const bestCaseCgpa = pendingCreditHours
    ? (confirmedPoints + max * pendingCreditHours) / totalCredits
    : confirmedCgpa;
  const worstCaseCgpa = pendingCreditHours
    ? (confirmedPoints + lowest * pendingCreditHours) / totalCredits
    : confirmedCgpa;
  const minPassCgpa = pendingCreditHours
    ? (confirmedPoints + minPositive * pendingCreditHours) / totalCredits
    : confirmedCgpa;

  let targetStatus: PendingProjection['targetStatus'] = null;
  let requiredPendingGpa: number | null = null;
  if (input.target !== null && pendingCreditHours > 0) {
    // Credit-weighted: target × total credits = confirmed points + req × pending
    requiredPendingGpa =
      (input.target * totalCredits - confirmedPoints) / pendingCreditHours;
    if (requiredPendingGpa <= lowest + 1e-9) targetStatus = 'guaranteed';
    else if (requiredPendingGpa <= max + 1e-9) targetStatus = 'possible';
    else targetStatus = 'unreachable';
  }

  const swing =
    bestCaseCgpa !== null && worstCaseCgpa !== null
      ? bestCaseCgpa - worstCaseCgpa
      : 0;

  return {
    confirmedCreditHours,
    confirmedPoints,
    confirmedCgpa,
    confirmedClass: classifyCgpa(confirmedCgpa, classification),
    pendingCreditHours,
    pendingCount,
    bestCaseCgpa,
    bestCaseClass: classifyCgpa(bestCaseCgpa, classification),
    worstCaseCgpa,
    worstCaseClass: classifyCgpa(worstCaseCgpa, classification),
    maxPoints: max,
    minPositivePoints: minPositive,
    minPassCgpa,
    minPassClass: classifyCgpa(minPassCgpa, classification),
    swing,
    requiredPendingGpa,
    targetStatus,
    targetRequiredClass: input.target
      ? classifyCgpa(input.target, classification)
      : null,
  };
}
