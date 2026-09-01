// ─────────────────────────────────────────────────────────────────────────
// TARGET & FEASIBILITY ENGINE (Prompt 9)
//
// Given the student's CONFIRMED position and a target CGPA, this works out —
// at full internal precision — the credits completed/remaining, the quality
// points and average GPA still needed, the best possible finish, and a
// four-tier feasibility status.
//
// A target is declared MATHEMATICALLY IMPOSSIBLE only when the required future
// average exceeds the configured grading system's maximum grade point. All
// thresholds are derived from the active grading bands — nothing is hard-coded
// to a 4.0 scale.
// ─────────────────────────────────────────────────────────────────────────

import type {
  ClassificationBand,
  ClassificationSystem,
  GradingSystem,
} from '../config/types';
import { maxGradePoints } from './gradingService';

export type TargetStatus =
  | 'met' // already at/above target
  | 'achievable' // 🟢
  | 'very-demanding' // 🟡
  | 'extremely-demanding' // 🟠
  | 'impossible' // 🔴
  | 'unknown'; // not enough data yet

export interface TargetInput {
  /** Confirmed quality points so far (released results only). */
  currentPoints: number;
  /** Confirmed credits so far. */
  creditsCompleted: number;
  /** Credits still ahead until graduation. */
  creditsRemaining: number;
  targetCgpa: number;
  currentCgpa: number | null;
}

export interface TargetAnalysis {
  status: TargetStatus;
  statusLabel: string;
  statusEmoji: string;
  /** Tone key for the UI palette. */
  tone: 'green' | 'amber' | 'orange' | 'red' | 'gray';

  currentCgpa: number | null;
  targetCgpa: number;
  creditsCompleted: number;
  creditsRemaining: number;
  totalCredits: number;
  currentPoints: number;

  /** Quality points the remaining credits must earn in total. */
  requiredFuturePoints: number | null;
  /** Average GPA the remaining credits must earn. */
  requiredFutureGpa: number | null;
  /** Best possible final CGPA (every remaining credit at the top grade). */
  maxFinalCgpa: number | null;
  /** Configured maximum grade point (feasibility ceiling). */
  maxGradePoints: number;

  /** Classification band the target sits in (config-driven). */
  targetClass: ClassificationBand | null;

  /** Plain-language "Why am I seeing this?" explanation. */
  explanation: string[];
}

const STATUS_META: Record<
  Exclude<TargetStatus, 'unknown'>,
  { label: string; emoji: string; tone: TargetAnalysis['tone'] }
> = {
  met: { label: 'Target already achieved', emoji: '🎯', tone: 'green' },
  achievable: { label: 'Achievable', emoji: '🟢', tone: 'green' },
  'very-demanding': { label: 'Very demanding', emoji: '🟡', tone: 'amber' },
  'extremely-demanding': { label: 'Extremely demanding', emoji: '🟠', tone: 'orange' },
  impossible: { label: 'Mathematically impossible', emoji: '🔴', tone: 'red' },
};

/** Distinct grade-point values in the system, highest first. */
function distinctPointsDesc(grading: GradingSystem): number[] {
  return [...new Set(grading.bands.map((b) => b.points))].sort((a, z) => z - a);
}

/**
 * Feasibility tier boundaries derived from the grading bands:
 *  - green/yellow boundary ≈ the SECOND-highest grade point (e.g. B+ = 3.50):
 *    needing up to that average is comfortably achievable;
 *  - yellow/orange boundary ≈ the midpoint between the second-highest and the
 *    top grade (e.g. (3.50 + 4.00)/2 = 3.75): above that you need nearly
 *    straight top grades.
 * Falls back to fractions of the ceiling for unusual/short scales.
 */
function tierThresholds(grading: GradingSystem): { green: number; orange: number; top: number } {
  const top = maxGradePoints(grading);
  const desc = distinctPointsDesc(grading);
  const second = desc[1] ?? top * 0.875;
  return { green: second, orange: (second + top) / 2, top };
}

export function analyzeTarget(
  input: TargetInput,
  grading: GradingSystem,
  classification: ClassificationSystem
): TargetAnalysis {
  const { currentPoints, creditsCompleted, creditsRemaining, targetCgpa, currentCgpa } =
    input;
  const top = maxGradePoints(grading);
  const totalCredits = creditsCompleted + creditsRemaining;
  const targetClass =
    classification.bands.find(
      (b) => targetCgpa >= b.minCgpa && targetCgpa <= b.maxCgpa
    ) ?? null;

  const base = {
    currentCgpa,
    targetCgpa,
    creditsCompleted,
    creditsRemaining,
    totalCredits,
    currentPoints,
    maxGradePoints: top,
    targetClass,
  };

  const unknown = (explanation: string[]): TargetAnalysis => ({
    ...base,
    status: 'unknown',
    statusLabel: 'Awaiting your data',
    statusEmoji: '⚪',
    tone: 'gray',
    requiredFuturePoints: null,
    requiredFutureGpa: null,
    maxFinalCgpa: null,
    explanation,
  });

  if (currentCgpa === null) {
    return unknown([
      'Enter your current CGPA (Quick or GPA History mode) and the number of credits remaining.',
      'CGPA Pilot then works out exactly what average your future results need to reach your target — all on this device, nothing is saved.',
    ]);
  }

  if (creditsRemaining <= 0) {
    return unknown([
      'No future credits are configured beyond your current point, so there is nothing left to project.',
      'Once the administrator publishes more of the curriculum (or you enter remaining credits), the required future average can be calculated.',
    ]);
  }

  // Required future quality points and the average GPA they imply.
  const requiredTotalPoints = targetCgpa * totalCredits;
  const requiredFuturePoints = requiredTotalPoints - currentPoints;
  const requiredFutureGpa = requiredFuturePoints / creditsRemaining;
  const maxFinalCgpa = (currentPoints + top * creditsRemaining) / totalCredits;

  // ── Determine the tier ────────────────────────────────────────────────
  let status: TargetStatus;
  if (currentCgpa >= targetCgpa - 1e-9) {
    status = 'met';
  } else if (requiredFutureGpa > top + 1e-9) {
    status = 'impossible';
  } else {
    const { green, orange } = tierThresholds(grading);
    if (requiredFutureGpa <= green + 1e-9) status = 'achievable';
    else if (requiredFutureGpa <= orange + 1e-9) status = 'very-demanding';
    else status = 'extremely-demanding';
  }

  const meta = STATUS_META[status as Exclude<TargetStatus, 'unknown'>];

  // ── Plain-language explanation ────────────────────────────────────────
  const fmt = (n: number) => n.toFixed(2);
  const explanation: string[] = [
    `Your confirmed CGPA is ${fmt(currentCgpa)} over ${creditsCompleted} completed credits — that is ${fmt(currentPoints)} quality points so far.`,
    `To finish on ${fmt(targetCgpa)} (${targetClass?.label ?? 'your target'}) across all ${totalCredits} programme credits, you need ${fmt(requiredTotalPoints)} quality points in total.`,
    `That leaves ${fmt(requiredFuturePoints)} quality points to earn over your ${creditsRemaining} remaining credits — an average future GPA of ${fmt(requiredFutureGpa)} on the ${fmt(top)} scale.`,
  ];

  if (status === 'met') {
    explanation.push(
      `You are already at or above ${fmt(targetCgpa)}. Keep your confirmed average at or above ${fmt(targetCgpa)} through the remaining ${creditsRemaining} credits to hold the classification.`
    );
  } else if (status === 'achievable') {
    explanation.push(
      `This is within comfortable reach: an average around ${fmt(requiredFutureGpa)} is at or below a strong upper grade, so you do not need perfect marks. Even the best possible finish is ${fmt(maxFinalCgpa)}.`
    );
  } else if (status === 'very-demanding') {
    explanation.push(
      `Reachable, but demanding: you would need mostly top grades (around ${fmt(requiredFutureGpa)}). The mathematical best case — straight ${fmt(top)} from here — finishes on ${fmt(maxFinalCgpa)}, so there is little room for slips.`
    );
  } else if (status === 'extremely-demanding') {
    explanation.push(
      `This sits right at the mathematical edge: you would need an average of about ${fmt(requiredFutureGpa)}, essentially straight top grades. Straight ${fmt(top)} from here finishes on ${fmt(maxFinalCgpa)} — barely above the target, so any result below the top grade puts it out of reach.`
    );
  } else {
    explanation.push(
      `Even scoring the maximum grade (${fmt(top)}) in every one of the ${creditsRemaining} remaining credits would only bring you to ${fmt(maxFinalCgpa)}, which is below ${fmt(targetCgpa)}. The target is mathematically out of reach with the credits that remain — consider a nearby classification, or it may already be decided by the results released so far.`
    );
  }

  return {
    ...base,
    status,
    statusLabel: meta.label,
    statusEmoji: meta.emoji,
    tone: meta.tone,
    requiredFuturePoints,
    requiredFutureGpa,
    maxFinalCgpa,
    explanation,
  };
}
