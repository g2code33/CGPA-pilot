// ─────────────────────────────────────────────────────────────────────────
// classificationService — degree classification against a configured
// ClassificationSystem. Pure functions.
// ─────────────────────────────────────────────────────────────────────────

import type {
  ClassificationBand,
  ClassificationSystem,
} from '../config/types';

export function classifyCgpa(
  cgpa: number | null,
  system: ClassificationSystem
): ClassificationBand | null {
  if (cgpa === null || Number.isNaN(cgpa)) return null;
  // Boundary-correct: order bands by minimum (descending) and assign the
  // first band whose minimum the CGPA reaches. This is robust to floating
  // point (3.0 is the 2:1 boundary, not a gap) and to bands whose ranges
  // abut without sharing endpoints.
  const byMax = [...system.bands].sort((a, b) => b.maxCgpa - a.maxCgpa);
  const ordered = [...system.bands].sort((a, b) => b.minCgpa - a.minCgpa);
  const match = ordered.find((b) => cgpa + 1e-9 >= b.minCgpa);
  // Never classify above the highest awarded band or below zero.
  const highest = byMax[0];
  if (match && highest && cgpa > highest.maxCgpa + 1e-9) {
    return highest;
  }
  return match ?? ordered[ordered.length - 1] ?? null;
}

/** Grade-point ceiling for the active grading system (feasibility max). */
export { maxGradePoints } from './gradingService';

export function classBandForMinimum(
  cgpa: number,
  system: ClassificationSystem
): ClassificationBand | undefined {
  return system.bands.find((b) => b.minCgpa === cgpa);
}

/** Targetable bands (those reachable for graduation). */
export function targetableBands(system: ClassificationSystem): ClassificationBand[] {
  return system.bands.filter((b) => (system.graduationMinCgpa ?? 0) <= b.minCgpa);
}

export function meetsGraduation(
  cgpa: number | null,
  system: ClassificationSystem
): boolean {
  if (cgpa === null) return false;
  return system.graduationMinCgpa === undefined || cgpa >= system.graduationMinCgpa;
}

export function gapToTarget(
  cgpa: number | null,
  target: number
): number | null {
  if (cgpa === null) return null;
  return target - cgpa;
}
