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
  return (
    system.bands.find((b) => cgpa >= b.minCgpa && cgpa <= b.maxCgpa) ??
    system.bands[system.bands.length - 1]
  );
}

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
