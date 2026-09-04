// ─────────────────────────────────────────────────────────────────────────
// DASHBOARD / PILOT BRIEF assembly (Prompt 14)
//
// One pure function gathers the cockpit figures from the existing engines:
// current position, destination, flight status (target feasibility), required
// performance, the next mission, the projected destination and a compact
// flight-path series. Nothing here is persisted; everything is config-driven.
// ─────────────────────────────────────────────────────────────────────────

import type {
  ClassificationSystem,
  CurriculumVersion,
  GradingSystem,
} from '../config/types';
import { classifyCgpa } from './classificationService';
import { maxGradePoints } from './gradingService';
import { analyzeTarget, type TargetAnalysis } from './targetService';
import {
  nextSemesterAfter,
  planNextSemester,
  type NextSemesterPlan,
} from './nextSemesterService';
import { buildFlightPath, type FlightPathModel } from './flightPathService';
import type { SemesterSlot } from './structureService';

export interface DashboardModel {
  currentCgpa: number | null;
  currentClassLabel: string | null;
  currentLevel: number;
  creditsCompleted: number;

  targetCgpa: number;
  targetClassLabel: string;

  /** Target feasibility status (drives FLIGHT STATUS). */
  status: TargetAnalysis['status'];
  statusLabel: string;
  statusEmoji: string;
  requiredFutureGpa: number | null;
  maxPossibleFinalCgpa: number | null;

  next: NextSemesterPlan | null;
  projectedFinalCgpa: number | null;
  projectedClassLabel: string | null;

  /** Compact trajectory series for the dashboard graph. */
  flightPath: FlightPathModel;

  curriculumVersion: string | null;
  institutionLabel: string;

  /** Semantic semester role (how the planner names the act-on semester). */
  semesterRole: 'finish-current' | 'upon-release' | 'next-semester';
  standing: 'released' | 'notReleased' | 'justStarted';

  /** Plain-language brief lines. */
  brief: string[];
  hasData: boolean;
}

export interface DashboardInput {
  currentPoints: number;
  currentCredits: number;
  currentCgpa: number | null;
  currentLevelIndex: number;
  currentSemesterIndex: number;
  targetCgpa: number;
  remainingSlots: SemesterSlot[];
  remainingCredits: number;
  curriculum?: CurriculumVersion;
  curriculumPublished: boolean;
  /** Assumed future GPA for the projected destination (defaults to required). */
  assumedFutureGpa?: number | null;
  grading: GradingSystem;
  classification: ClassificationSystem;
  institutionLabel: string;
  /** Semantic semester role (how the planner screen names the act-on semester). */
  semesterRole?: 'finish-current' | 'upon-release' | 'next-semester';
  standing?: 'released' | 'notReleased' | 'justStarted';
}

/** Human noun for the semester a plan targets, driven by the semantic role. */
export function actOnNoun(role?: DashboardInput['semesterRole']): string {
  if (role === 'finish-current') return 'this semester';
  if (role === 'upon-release') return 'the semester you just wrote';
  return 'next semester';
}

export function buildDashboard(i: DashboardInput): DashboardModel {
  const max = maxGradePoints(i.grading);

  const targetAnalysis: TargetAnalysis = analyzeTarget(
    {
      currentPoints: i.currentPoints,
      creditsCompleted: i.currentCredits,
      creditsRemaining: i.remainingCredits,
      targetCgpa: i.targetCgpa,
      currentCgpa: i.currentCgpa,
    },
    i.grading,
    i.classification
  );

  // Current / destination.
  const currentClass = i.currentCgpa === null ? null : classifyCgpa(i.currentCgpa, i.classification);
  const targetClass = classifyCgpa(i.targetCgpa, i.classification);

  // Next mission (only when there is a confirmed position).
  let nextPlan: NextSemesterPlan | null = null;
  if (i.currentCgpa !== null) {
    const nextInfo = nextSemesterAfter(
      i.curriculum,
      i.currentLevelIndex,
      i.currentSemesterIndex
    );
    nextPlan = planNextSemester(
      {
        currentPoints: i.currentPoints,
        currentCredits: i.currentCredits,
        currentCgpa: i.currentCgpa,
        remainingCredits: i.remainingCredits,
        targetCgpa: i.targetCgpa,
        next: nextInfo,
        fallbackCredits: 18,
        curriculumPublished: i.curriculumPublished && nextInfo.courses.length > 0,
      },
      i.grading,
      i.classification
    );
  }

  // Flight path / projected destination. Steady future GPA defaults to the
  // required average (clamped to the ceiling) so the projection lands on the
  // target when reachable.
  const assumed =
    i.assumedFutureGpa ??
    (targetAnalysis.requiredFutureGpa !== null
      ? Math.min(max, Math.max(0, targetAnalysis.requiredFutureGpa))
      : max);
  const flightPath = buildFlightPath(
    {
      currentPoints: i.currentPoints,
      currentCredits: i.currentCredits,
      currentCgpa: i.currentCgpa,
      currentLevelIndex: i.currentLevelIndex,
      remainingSlots: i.remainingSlots,
      assumedFutureGpa: assumed,
      targetCgpa: i.targetCgpa,
      fallbackCreditsPerSemester: 18,
      fallbackSemesterCount: 6,
    },
    i.grading,
    i.classification
  );

  const projectedFinal = flightPath.graduation?.projectedCgpa ?? null;
  const projectedClass =
    projectedFinal === null ? null : classifyCgpa(projectedFinal, i.classification);

  // ── Pilot brief ──────────────────────────────────────────────────────
  const brief: string[] = [];
  if (i.currentCgpa === null) {
    brief.push('No graded record yet — open Calculate to enter your current CGPA or GPA history.');
  } else {
    brief.push(
      `Current CGPA ${i.currentCgpa.toFixed(2)}${currentClass ? ` (${currentClass.label})` : ''} at Level ${i.currentLevelIndex * 100}, over ${i.currentCredits} graded credits.`
    );
    brief.push(`Target: ${i.targetCgpa.toFixed(2)}${targetClass ? ` (${targetClass.label})` : ''}.`);
    brief.push(`Flight status: ${targetAnalysis.statusLabel}.`);
    if (targetAnalysis.requiredFutureGpa !== null) {
      brief.push(
        targetAnalysis.status === 'impossible'
          ? `The required future average would be ${targetAnalysis.requiredFutureGpa.toFixed(2)}, above the ${max.toFixed(2)} ceiling — not reachable on the remaining ${i.remainingCredits} credits.`
          : `Required future average GPA: ${targetAnalysis.requiredFutureGpa.toFixed(2)} over ${i.remainingCredits} remaining credits.`
      );
    }
    if (nextPlan && nextPlan.requiredNextGpa !== null) {
      const word =
        i.semesterRole === 'upon-release'
          ? 'On release'
          : i.semesterRole === 'finish-current'
            ? 'Current mission'
            : 'Next mission';
      brief.push(
        `${word}: ${nextPlan.next.label} — aim for about ${nextPlan.requiredNextGpa.toFixed(2)} (${nextPlan.targetClassLabel}).`
      );
    }
    brief.push(
      `Maximum possible final CGPA is ${targetAnalysis.maxFinalCgpa === null ? '—' : targetAnalysis.maxFinalCgpa.toFixed(2)}; on the planned path you project around ${projectedFinal === null ? '—' : projectedFinal.toFixed(2)} (${projectedClass?.label ?? '—'}).`
    );
    brief.push(
      'Important assumptions: future semesters use the configured curriculum credit loads and a steady assumed average; projections are scenarios, not guaranteed outcomes, and pending results are excluded until released.'
    );
    if (i.curriculum) {
      brief.push(`Curriculum version: ${i.curriculum.versionName}${i.curriculumPublished ? '' : ' (not yet published)'}.`);
    } else {
      brief.push('Curriculum version: none published yet — placeholder credit loads are used.');
    }
  }

  return {
    currentCgpa: i.currentCgpa,
    currentClassLabel: currentClass?.label ?? null,
    currentLevel: i.currentLevelIndex,
    creditsCompleted: i.currentCredits,
    targetCgpa: i.targetCgpa,
    targetClassLabel: targetClass?.label ?? 'your target',
    status: targetAnalysis.status,
    statusLabel: targetAnalysis.statusLabel,
    statusEmoji: targetAnalysis.statusEmoji,
    requiredFutureGpa: targetAnalysis.requiredFutureGpa,
    maxPossibleFinalCgpa: targetAnalysis.maxFinalCgpa,
    next: nextPlan,
    projectedFinalCgpa: projectedFinal,
    projectedClassLabel: projectedClass?.label ?? null,
    flightPath,
    curriculumVersion: i.curriculum ? i.curriculum.versionName : null,
    institutionLabel: i.institutionLabel,
    semesterRole: i.semesterRole ?? 'next-semester',
    standing: i.standing ?? 'released',
    brief,
    hasData: i.currentCgpa !== null,
  };
}

/** Report/print heading for the semester-plan section, driven by role. */
export function planSectionNoun(role?: DashboardModel['semesterRole']): string {
  if (role === 'finish-current') return 'This semester plan';
  if (role === 'upon-release') return 'Upon release';
  return 'Next semester plan';
}
