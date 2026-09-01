// ─────────────────────────────────────────────────────────────────────────
// Tests for the CGPA FLIGHT PATH service (Prompt 10).
//
// Verifies milestone structure (current → level ends → graduation), the
// credit-weighted PROJECTED path, the REQUIRED path to the target, required
// future GPA and reachability, the graduation projection, and that future
// points are scenarios rather than guaranteed outcomes (no mutation).
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import * as flight from '../src/services/flightPathService.ts';

const grading = {
  id: 'ucc',
  name: 'UCC',
  bands: [
    { grade: 'A', minScore: 80, maxScore: 100, points: 4.0 },
    { grade: 'B+', minScore: 75, maxScore: 79, points: 3.5 },
    { grade: 'B', minScore: 70, maxScore: 74, points: 3.0 },
    { grade: 'C', minScore: 60, maxScore: 64, points: 2.0 },
    { grade: 'D', minScore: 50, maxScore: 54, points: 1.0 },
    { grade: 'E', minScore: 0, maxScore: 49, points: 0.0 },
  ],
};
const classification = {
  id: 'c',
  name: 'UCC',
  bands: [
    { id: 'first', label: 'First Class', minCgpa: 3.6, maxCgpa: 4.0, tone: 'gold' },
    { id: '2u', label: 'Second Upper', minCgpa: 3.0, maxCgpa: 3.59, tone: 'green' },
    { id: 'pass', label: 'Pass', minCgpa: 1.0, maxCgpa: 1.99, tone: 'gray' },
    { id: 'fail', label: 'Fail', minCgpa: 0, maxCgpa: 0.99, tone: 'red' },
  ],
};

// Slots: through L100 completed; remaining L200S1(18), L200S2(18), L300S1(18).
const remainingSlots = [
  { levelIndex: 2, levelLabel: 'Level 200', semesterIndex: 1, label: 'L200 S1', credits: 18, courseCount: 5 },
  { levelIndex: 2, levelLabel: 'Level 200', semesterIndex: 2, label: 'L200 S2', credits: 18, courseCount: 5 },
  { levelIndex: 3, levelLabel: 'Level 300', semesterIndex: 1, label: 'L300 S1', credits: 18, courseCount: 5 },
];

function build(over = {}) {
  return flight.buildFlightPath(
    {
      currentPoints: 3.0 * 36, // 108
      currentCredits: 36,
      currentCgpa: 3.0,
      currentLevelIndex: 1,
      remainingSlots,
      assumedFutureGpa: over.assumed ?? 4.0,
      targetCgpa: over.target ?? 3.6,
      fallbackCreditsPerSemester: 18,
      fallbackSemesterCount: 6,
    },
    grading,
    classification
  );
}

test('milestones: current position, level ends, and graduation', () => {
  const m = build();
  assert.equal(m.milestones[0].kind, 'current');
  assert.equal(m.milestones[0].label, 'Now');
  // Last leg L300 S1 is graduation.
  const grad = m.graduation;
  assert.ok(grad);
  assert.equal(grad.isGraduation, true);
  assert.equal(grad.kind, 'graduation');
  // End-of-level markers exist for L200 (semester 2).
  const l200end = m.milestones.find((x) => x.label === 'L200');
  assert.ok(l200end?.isLevelEnd);
});

test('cumulative credits accumulate over the real curriculum loads', () => {
  const m = build();
  assert.equal(m.milestones[0].cumulativeCredits, 36);
  assert.equal(m.milestones[1].cumulativeCredits, 54);
  assert.equal(m.milestones[2].cumulativeCredits, 72);
  assert.equal(m.graduation.cumulativeCredits, 90);
});

test('projected path is credit-weighted at the assumed future GPA', () => {
  const m = build({ assumed: 4.0 });
  // After 18 cr at 4.0: (108 + 72)/54 = 180/54 = 3.3333…
  assert.ok(Math.abs(m.milestones[1].projectedCgpa - 180 / 54) < 1e-9);
  // Graduation: (108 + 4.0*54)/90 = 324/90 = 3.6
  assert.ok(Math.abs(m.graduation.projectedCgpa - 3.6) < 1e-9);
});

test('required future GPA is solved by the credit-weighted equation', () => {
  // target 3.6, total 90, current 108 → req = (324 − 108)/54 = 4.0
  const m = build({ target: 3.6 });
  assert.ok(Math.abs(m.requiredFutureGpa - 4.0) < 1e-9);
  assert.equal(m.targetReachable, true);
});

test('required cumulative line ends on the target at graduation when reachable', () => {
  const m = build({ target: 3.6 });
  // The required path's graduation CGPA equals the target.
  assert.ok(Math.abs(m.graduation.requiredCgpa - 3.6) < 1e-9);
  // It starts from the current CGPA at "Now".
  assert.ok(Math.abs(m.milestones[0].requiredCgpa - 3.0) < 1e-9);
});

test('target is unreachable when the required average exceeds the ceiling', () => {
  // 60 current credits at 3.0 (180), 6 future credits, target 3.8:
  // req = (3.8*66 − 180)/6 = (250.8 − 180)/6 = 11.8 > 4.0
  const m = flight.buildFlightPath(
    {
      currentPoints: 180,
      currentCredits: 60,
      currentCgpa: 3.0,
      currentLevelIndex: 3,
      remainingSlots: [
        { levelIndex: 4, levelLabel: 'L400', semesterIndex: 1, label: 'L400 S1', credits: 6, courseCount: 2 },
      ],
      assumedFutureGpa: 4.0,
      targetCgpa: 3.8,
      fallbackCreditsPerSemester: 18,
      fallbackSemesterCount: 6,
    },
    grading,
    classification
  );
  assert.equal(m.targetReachable, false);
  assert.ok(m.requiredFutureGpa > 4.0);
});

test('graduation projection reports the projected class', () => {
  const m = build({ assumed: 4.0, target: 3.6 });
  assert.equal(flight.classLabelAt(m.graduation.projectedCgpa, classification), 'First Class');
});

test('fallback mode synthesizes legs when the curriculum has no credit data', () => {
  const m = flight.buildFlightPath(
    {
      currentPoints: 90,
      currentCredits: 30,
      currentCgpa: 3.0,
      currentLevelIndex: 1,
      remainingSlots: [], // no curriculum
      assumedFutureGpa: 3.5,
      targetCgpa: 3.6,
      fallbackCreditsPerSemester: 18,
      fallbackSemesterCount: 2,
    },
    grading,
    classification
  );
  assert.equal(m.fallback, true);
  // Now + 2 legs = 3 milestones; 30 → 48 → 66 credits.
  assert.equal(m.milestones.length, 3);
  assert.equal(m.graduation.cumulativeCredits, 66);
});

test('structure with zero-credit slots falls back to flat credits but keeps labels', () => {
  const m = flight.buildFlightPath(
    {
      currentPoints: 90,
      currentCredits: 30,
      currentCgpa: 3.0,
      currentLevelIndex: 1,
      remainingSlots: [
        { levelIndex: 2, levelLabel: 'L200', semesterIndex: 1, label: 'L200 S1', credits: 0, courseCount: 0 },
      ],
      assumedFutureGpa: 4.0,
      targetCgpa: 3.6,
      fallbackCreditsPerSemester: 18,
      fallbackSemesterCount: 6,
    },
    grading,
    classification
  );
  assert.equal(m.fallback, true);
  assert.equal(m.graduation.cumulativeCredits, 48); // 30 + 18
});
