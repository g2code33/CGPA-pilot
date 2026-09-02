// ─────────────────────────────────────────────────────────────────────────
// MILESTONES & AFFORDABLE DROP ANALYSIS (Prompt 13)
//
// For every remaining stage this reports the required GPA, projected CGPA,
// target CGPA, remaining credits and maximum possible CGPA under three
// scenarios:
//   • BEST CASE    — every future credit earns the configured top grade;
//   • TARGET CASE  — the steady average needed to reach the target;
//   • USER SCENARIO — a (possibly lower) future GPA the student wants to test
//                     ("If I get 3.20 next semester, can I still reach 3.60?").
//
// "How much can I afford to drop?" is answered by the user scenario: after the
// lower next-semester GPA, the future average still required shows whether the
// target is reachable (and the flight path updates). No real-world performance
// data is invented — the "best" grade is the configured maximum and all other
// values are the student's. Full precision; nothing is persisted.
// ─────────────────────────────────────────────────────────────────────────

import type {
  ClassificationSystem,
  GradingSystem,
} from '../config/types';
import { classifyCgpa } from './classificationService';
import { maxGradePoints } from './gradingService';
import { buildFlightLegs, type FlightLeg } from './flightPathService';
import type { TargetStatus } from './targetService';

export type ScenarioId = 'best' | 'target' | 'user';

export interface MilestoneStage {
  label: string;
  detail: string;
  levelIndex: number;
  isLevelEnd: boolean;
  isGraduation: boolean;
  cumulativeCredits: number;
  /** Remaining credits AFTER this stage. */
  creditsRemainingAfter: number;
  /** Projected cumulative CGPA under each scenario at this stage. */
  projected: Record<ScenarioId, number>;
  /**
   * Future average still required AFTER this stage to reach the target under
   * each scenario (null when no credits remain).
   */
  requiredGpaAfter: Record<ScenarioId, number | null>;
  /** Best achievable CGPA from this stage forward (same for all scenarios). */
  maxPossibleCgpa: number;
  /** Reachability of the target from after this stage per scenario. */
  reachable: Record<ScenarioId, boolean>;
}

export interface ScenarioInfo {
  id: ScenarioId;
  label: string;
  description: string;
  futureGpa: number;
}

export interface DropVerdict {
  status: TargetStatus;
  statusLabel: string;
  projectedCgpaAfter: number;
  requiredFutureGpaAfter: number | null;
  remainingCreditsAfter: number;
  maxPossibleFinal: number;
  answer: string;
}

export interface MilestoneAnalysis {
  stages: MilestoneStage[];
  scenarios: Record<ScenarioId, ScenarioInfo>;
  targetCgpa: number;
  currentCgpa: number | null;
  maxPoints: number;
  /** Verdict for the user scenario's first ("next") semester. */
  dropVerdict: DropVerdict | null;
  fallback: boolean;
}

export interface MilestoneInput {
  currentPoints: number;
  currentCredits: number;
  currentCgpa: number | null;
  currentLevelIndex: number;
  remainingSlots: import('../services/structureService').SemesterSlot[];
  targetCgpa: number;
  /** Future GPA the student wants to test (the affordable-drop value). */
  userGpa: number;
  fallbackCreditsPerSemester: number;
  fallbackSemesterCount: number;
}

function statusLabel(status: TargetStatus): string {
  switch (status) {
    case 'met':
      return 'Target achieved';
    case 'achievable':
      return 'Reachable — comfortably achievable';
    case 'very-demanding':
      return 'Reachable — very demanding';
    case 'extremely-demanding':
      return 'Reachable — extremely demanding';
    case 'impossible':
      return 'Mathematically impossible from here';
    default:
      return 'Awaiting data';
  }
}

function classifyStatus(requiredGpa: number | null, currentCgpa: number | null, target: number, max: number): TargetStatus {
  if (currentCgpa === null || requiredGpa === null) return 'unknown';
  if (currentCgpa >= target - 1e-9) return 'met';
  if (requiredGpa > max + 1e-9) return 'impossible';
  // Band thresholds derived from the ceiling (mirror targetService):
  const second = max * 0.875; // ≈ 3.5 on a 4.0 scale
  const orange = (second + max) / 2; // ≈ 3.75
  if (requiredGpa <= second + 1e-9) return 'achievable';
  if (requiredGpa <= orange + 1e-9) return 'very-demanding';
  return 'extremely-demanding';
}

export function analyzeMilestones(
  input: MilestoneInput,
  grading: GradingSystem,
  classification: ClassificationSystem
): MilestoneAnalysis {
  const max = maxGradePoints(grading);
  const { legs, fallback } = buildFlightLegs(input);
  const target = input.targetCgpa;

  // Steady future GPA for each scenario.
  const totalFutureCredits = legs.reduce((s, l) => s + l.credits, 0);
  const totalCredits = input.currentCredits + totalFutureCredits;
  const uniformRequired =
    totalFutureCredits > 0 && input.currentCgpa !== null
      ? (target * totalCredits - input.currentPoints) / totalFutureCredits
      : max;
  const targetGpa = Math.min(max, Math.max(0, uniformRequired));

  const futureGpa: Record<ScenarioId, number> = {
    best: max,
    target: targetGpa,
    user: input.userGpa,
  };

  const scenarios: Record<ScenarioId, ScenarioInfo> = {
    best: {
      id: 'best',
      label: 'Best case',
      description: `Every future credit earns the maximum configured grade (${max.toFixed(2)}).`,
      futureGpa: max,
    },
    target: {
      id: 'target',
      label: 'Target case',
      description: `The steady average needed to finish on ${target.toFixed(2)}.`,
      futureGpa: targetGpa,
    },
    user: {
      id: 'user',
      label: 'Your scenario',
      description: `A future GPA of ${input.userGpa.toFixed(2)} — see what a lower result does to the target.`,
      futureGpa: input.userGpa,
    },
  };

  // Walk the legs, accumulating each scenario independently.
  const cumCredits: Record<ScenarioId, number> = {
    best: input.currentCredits,
    target: input.currentCredits,
    user: input.currentCredits,
  };
  const cumPoints: Record<ScenarioId, number> = {
    best: input.currentPoints,
    target: input.currentPoints,
    user: input.currentPoints,
  };

  const stages: MilestoneStage[] = [];

  legs.forEach((leg: FlightLeg, idx) => {
    (Object.keys(futureGpa) as ScenarioId[]).forEach((sc) => {
      cumPoints[sc] += futureGpa[sc] * leg.credits;
      cumCredits[sc] += leg.credits;
    });

    const isLast = idx === legs.length - 1;
    const nextLeg = legs[idx + 1];
    const isLevelEnd =
      leg.semesterIndex === 2 || (nextLeg ? nextLeg.levelIndex !== leg.levelIndex : true);

    const cumulativeCredits = cumCredits.user; // identical across scenarios
    const remainingAfter = totalCredits - cumulativeCredits;

    const projected: Record<ScenarioId, number> = {
      best: cumPoints.best / cumCredits.best,
      target: cumPoints.target / cumCredits.target,
      user: cumPoints.user / cumCredits.user,
    };

    // Required future average AFTER this stage for each scenario:
    // (target × total − pointsSoFar) / remainingAfter.
    const requiredGpaAfter: Record<ScenarioId, number | null> = {
      best: null,
      target: null,
      user: null,
    };
    const reachable: Record<ScenarioId, boolean> = {
      best: true,
      target: true,
      user: true,
    };
    (Object.keys(futureGpa) as ScenarioId[]).forEach((sc) => {
      if (remainingAfter > 0) {
        const req = (target * totalCredits - cumPoints[sc]) / remainingAfter;
        requiredGpaAfter[sc] = req;
        reachable[sc] = req <= max + 1e-9;
      } else {
        // At graduation the target is met if the projection reaches it.
        reachable[sc] = projected[sc] >= target - 1e-9;
      }
    });

    // Maximum possible CGPA from here (best case forward) = the best scenario.
    const maxPossibleCgpa = projected.best;

    stages.push({
      label: isLast ? 'Graduation' : isLevelEnd ? `L${leg.levelIndex * 100}` : `S${leg.semesterIndex}`,
      detail: isLast
        ? `Graduation · end of Level ${leg.levelIndex * 100}`
        : leg.label,
      levelIndex: leg.levelIndex,
      isLevelEnd,
      isGraduation: isLast,
      cumulativeCredits,
      creditsRemainingAfter: remainingAfter,
      projected,
      requiredGpaAfter,
      maxPossibleCgpa,
      reachable,
    });
  });

  // ── Affordable-drop verdict for the user scenario's NEXT semester ──────
  let dropVerdict: DropVerdict | null = null;
  const firstLeg = legs[0];
  if (input.currentCgpa !== null && firstLeg) {
    const afterPoints = input.currentPoints + input.userGpa * firstLeg.credits;
    const afterCredits = input.currentCredits + firstLeg.credits;
    const projectedCgpaAfter = afterPoints / afterCredits;
    const remainingAfter = totalCredits - afterCredits;
    const requiredAfter =
      remainingAfter > 0 ? (target * totalCredits - afterPoints) / remainingAfter : null;
    const maxPossibleFinal =
      remainingAfter > 0
        ? (afterPoints + max * remainingAfter) / totalCredits
        : projectedCgpaAfter;
    const status = classifyStatus(requiredAfter, projectedCgpaAfter, target, max);

    let answer: string;
    if (remainingAfter <= 0) {
      answer =
        projectedCgpaAfter >= target - 1e-9
          ? `A ${input.userGpa.toFixed(2)} semester lands you on ${projectedCgpaAfter.toFixed(2)} — target reached.`
          : `A ${input.userGpa.toFixed(2)} semester finishes on ${projectedCgpaAfter.toFixed(2)}, short of ${target.toFixed(2)}.`;
    } else if (requiredAfter !== null && requiredAfter > max + 1e-9) {
      answer = `No — even straight ${max.toFixed(2)} after a ${input.userGpa.toFixed(2)} semester only reaches ${maxPossibleFinal.toFixed(2)}, below ${target.toFixed(2)}.`;
    } else if (requiredAfter !== null && requiredAfter <= 1e-9) {
      answer = `Yes — a ${input.userGpa.toFixed(2)} semester already secures ${target.toFixed(2)} (projected ${projectedCgpaAfter.toFixed(2)}).`;
    } else {
      answer = `Yes, but — after a ${input.userGpa.toFixed(2)} semester you'd need about ${requiredAfter!.toFixed(2)} over the remaining ${remainingAfter} credits to still reach ${target.toFixed(2)}.`;
    }

    dropVerdict = {
      status,
      statusLabel: statusLabel(status),
      projectedCgpaAfter,
      requiredFutureGpaAfter: requiredAfter,
      remainingCreditsAfter: remainingAfter,
      maxPossibleFinal,
      answer,
    };
  }

  return {
    stages,
    scenarios,
    targetCgpa: target,
    currentCgpa: input.currentCgpa,
    maxPoints: max,
    dropVerdict,
    fallback,
  };
}

/** Classification label helper for the milestone table. */
export function classAt(cgpa: number, classification: ClassificationSystem): string {
  return classifyCgpa(cgpa, classification)?.label ?? '—';
}
