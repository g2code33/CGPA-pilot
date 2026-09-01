// ─────────────────────────────────────────────────────────────────────────
// CGPA FLIGHT PATH service (Prompt 10)
//
// Builds the signature milestone visualization from the CONFIRMED academic
// position, the configured curriculum structure and the student's target.
// Every future point is a PROJECTION (an assumed steady future GPA over the
// curriculum's real credit loads) — never a guaranteed outcome — and the
// REQUIRED path shows the cumulative CGPA that must be held to reach the
// target. All math is credit-weighted and unrounded until display.
// ─────────────────────────────────────────────────────────────────────────

import type { ClassificationSystem } from '../config/types';
import { classifyCgpa } from './classificationService';
import { maxGradePoints } from './gradingService';
import type { SemesterSlot } from './structureService';
import type { GradingSystem } from '../config/types';

export type MilestoneKind =
  | 'current'
  | 'level-end'
  | 'graduation'
  | 'semester';

export interface FlightMilestone {
  kind: MilestoneKind;
  /** Short x label, e.g. "Now", "L200", "L300", "Grad". */
  label: string;
  /** Full description for tooltips / the table. */
  detail: string;
  levelIndex: number;
  semesterIndex: number;
  /** Cumulative credits accounted for up to and including this point. */
  cumulativeCredits: number;
  /** Projected cumulative CGPA if the assumed future GPA is held. */
  projectedCgpa: number;
  /** Cumulative CGPA that must be held from here to still reach the target. */
  requiredCgpa: number | null;
  isLevelEnd: boolean;
  isGraduation: boolean;
}

export interface FlightPathModel {
  milestones: FlightMilestone[];
  currentCgpa: number | null;
  targetCgpa: number;
  currentLevel: number;
  maxPoints: number;
  requiredFutureGpa: number | null;
  targetReachable: boolean;
  /** Graduation milestone (last point). */
  graduation: FlightMilestone | null;
  /** Flat per-semester assumption only used when no curriculum credits exist. */
  fallback: boolean;
}

export interface FlightInput {
  currentPoints: number;
  currentCredits: number;
  currentCgpa: number | null;
  currentLevelIndex: number;
  /** Remaining curriculum slots (ordered) — empty/credits-less ⇒ fallback. */
  remainingSlots: SemesterSlot[];
  /** Assumed steady GPA for the PROJECTED path over future semesters. */
  assumedFutureGpa: number;
  targetCgpa: number;
  /** Fallback semester credit load when the curriculum has no credit data. */
  fallbackCreditsPerSemester: number;
  /** How many fallback future semesters to plot when no curriculum exists. */
  fallbackSemesterCount: number;
}

function shortLevel(levelIndex: number): string {
  return `L${levelIndex * 100}`;
}

export function buildFlightPath(
  input: FlightInput,
  grading: GradingSystem,
  classification: ClassificationSystem
): FlightPathModel {
  const max = maxGradePoints(grading);
  const target = input.targetCgpa;

  // The future legs: { credits, levelIndex, semesterIndex, label } in order.
  // Use the curriculum's remaining slots for correct level/semester
  // structure; when the published curriculum carries no credit data yet,
  // keep its structure but substitute the flat fallback credit load. Only if
  // there is no curriculum at all do we synthesize two-semesters-per-level.
  interface Leg {
    credits: number;
    levelIndex: number;
    semesterIndex: number;
    label: string;
  }
  const hasCreditData = input.remainingSlots.some((s) => s.credits > 0);
  let legs: Leg[];
  let fallback: boolean;

  if (input.remainingSlots.length > 0) {
    fallback = !hasCreditData;
    legs = input.remainingSlots.map((s) => ({
      credits: hasCreditData ? s.credits : input.fallbackCreditsPerSemester,
      levelIndex: s.levelIndex,
      semesterIndex: s.semesterIndex,
      label: s.label,
    }));
  } else {
    // No curriculum: synthesize the next N semesters, two per level, starting
    // just after the student's current level (assumes end of current level).
    fallback = true;
    legs = [];
    for (let i = 0; i < input.fallbackSemesterCount; i++) {
      const n = i + 1;
      const levelIndex = input.currentLevelIndex + Math.ceil(n / 2);
      const semesterIndex = ((n - 1) % 2) + 1;
      legs.push({
        credits: input.fallbackCreditsPerSemester,
        levelIndex,
        semesterIndex,
        label: `${shortLevel(levelIndex)} · Semester ${semesterIndex}`,
      });
    }
  }

  const totalFutureCredits = legs.reduce((s, l) => s + l.credits, 0);
  const totalCredits = input.currentCredits + totalFutureCredits;

  // Required steady future GPA to reach the target (credit-weighted).
  const requiredFutureGpa =
    totalFutureCredits > 0 && input.currentCgpa !== null
      ? (target * totalCredits - input.currentPoints) / totalFutureCredits
      : null;
  const targetReachable =
    requiredFutureGpa !== null && requiredFutureGpa <= max + 1e-9;

  // Current (Now) milestone.
  const milestones: FlightMilestone[] = [];
  let cumPoints = input.currentPoints;
  let cumCredits = input.currentCredits;

  const projectedNow = input.currentCgpa;
  // Required cumulative line starts at current CGPA at "Now" (nothing yet to
  // average in) — its slope is governed by requiredFutureGpa.
  milestones.push({
    kind: 'current',
    label: 'Now',
    detail: `Current position · Level ${input.currentLevelIndex * 100}`,
    levelIndex: input.currentLevelIndex,
    semesterIndex: 0,
    cumulativeCredits: cumCredits,
    projectedCgpa: projectedNow ?? 0,
    requiredCgpa: projectedNow,
    isLevelEnd: false,
    isGraduation: false,
  });

  // Walk each future leg, accumulating the projected (assumed GPA) path and
  // the required (must-hold) path.
  legs.forEach((leg, idx) => {
    cumPoints += input.assumedFutureGpa * leg.credits;
    cumCredits += leg.credits;
    const projectedCgpa = cumCredits > 0 ? cumPoints / cumCredits : 0;

    // Required cumulative CGPA at this point = blend of confirmed points plus
    // the required future average applied to all future credits SO FAR.
    const futureCreditsSoFar = cumCredits - input.currentCredits;
    const requiredCgpa =
      requiredFutureGpa !== null && cumCredits > 0
        ? (input.currentPoints + requiredFutureGpa * futureCreditsSoFar) /
          cumCredits
        : null;

    const isLast = idx === legs.length - 1;
    const nextLeg = legs[idx + 1];
    // End-of-level when this leg is semester 2 OR the level changes next.
    const isLevelEnd =
      leg.semesterIndex === 2 || (nextLeg ? nextLeg.levelIndex !== leg.levelIndex : true);

    milestones.push({
      kind: isLast ? 'graduation' : isLevelEnd ? 'level-end' : 'semester',
      label: isLast ? 'Grad' : isLevelEnd ? shortLevel(leg.levelIndex) : `S${leg.semesterIndex}`,
      detail: isLast
        ? `Graduation · end of Level ${leg.levelIndex * 100}`
        : `${leg.label}`,
      levelIndex: leg.levelIndex,
      semesterIndex: leg.semesterIndex,
      cumulativeCredits: cumCredits,
      projectedCgpa,
      requiredCgpa,
      isLevelEnd,
      isGraduation: isLast,
    });
  });

  const graduation = milestones[milestones.length - 1] ?? null;

  return {
    milestones,
    currentCgpa: input.currentCgpa,
    targetCgpa: target,
    currentLevel: input.currentLevelIndex,
    maxPoints: max,
    requiredFutureGpa,
    targetReachable,
    graduation,
    fallback,
  };
}

/** Classification label for a CGPA (convenience for the view/table). */
export function classLabelAt(
  cgpa: number | null,
  classification: ClassificationSystem
): string {
  return (cgpa === null ? null : classifyCgpa(cgpa, classification))?.label ?? '—';
}
