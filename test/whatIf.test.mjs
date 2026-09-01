// ─────────────────────────────────────────────────────────────────────────
// Tests for the WHAT-IF SIMULATOR (Prompt 11).
//
// Future-GPA scenarios project a hypothetical next period credit-weighted,
// WITHOUT mutating the confirmed record: projected semester GPA, projected
// CGPA, difference from current, difference from target, final trajectory if
// the average is held, and target feasibility after the period. Presets are
// config-driven; no individual course grade is inferred.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import * as scenario from '../src/services/scenarioService.ts';

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

const base = {
  currentPoints: 3.0 * 36, // 108
  currentCredits: 36,
  currentCgpa: 3.0,
  futureCredits: 18,
  remainingCredits: 54,
  targetCgpa: 3.6,
};

function mk(over = {}) {
  return scenario.futureScenario({ ...base, ...over }, grading, classification);
}

test('projected semester GPA is the assumed GPA (aggregate only, no grades inferred)', () => {
  const s = mk({ futureGpa: 3.5 });
  assert.equal(s.projectedSemesterGpa, 3.5);
});

test('projected CGPA blends the hypothetical period credit-weighted', () => {
  // (108 + 3.5*18)/(36+18) = (108+63)/54 = 171/54 = 3.1667
  const s = mk({ futureGpa: 3.5 });
  assert.ok(Math.abs(s.projectedCgpa - 171 / 54) < 1e-9);
});

test('difference from current CGPA', () => {
  const s = mk({ futureGpa: 4.0 }); // (108+72)/54 = 3.333
  assert.ok(Math.abs(s.projectedCgpa - 3.3333333333) < 1e-6);
  assert.ok(Math.abs(s.differenceFromCurrent - (3.3333333333 - 3.0)) < 1e-6);
});

test('difference from target', () => {
  const s = mk({ futureGpa: 4.0 }); // 3.333 − 3.6 = −0.2667
  assert.ok(Math.abs(s.differenceFromTarget - (3.3333333333 - 3.6)) < 1e-6);
  assert.ok(s.differenceFromTarget < 0);
});

test('final trajectory extrapolates the same average over all remaining credits', () => {
  // remaining 54 total: (108 + 3.5*54)/(36+54) = (108+189)/90 = 3.3
  const s = mk({ futureGpa: 3.5 });
  assert.ok(Math.abs(s.trajectoryFinalCgpa - 297 / 90) < 1e-9);
  assert.ok(Math.abs(s.trajectoryFinalCgpa - 3.3) < 1e-9);
});

test('excellent 4.0 scenario reaches the target over the full trajectory', () => {
  // (108 + 4*54)/90 = 324/90 = 3.6 exactly.
  const s = mk({ futureGpa: 4.0 });
  assert.ok(Math.abs(s.trajectoryFinalCgpa - 3.6) < 1e-9);
});

test('meets-target verdict when the projected CGPA already reaches the target', () => {
  // Confirmed 3.8; a solid 3.6 next period keeps the projected CGPA above 3.6.
  const s = mk({ currentPoints: 3.8 * 36, currentCgpa: 3.8, futureGpa: 3.6 });
  assert.ok(s.projectedCgpa >= 3.6);
  assert.equal(s.targetStatus, 'meets-target');
});

test('feasibility after the period reflects the remaining requirement', () => {
  // futureGpa 4.0 over 18 → cgpa 3.333, remaining after 36; target 3.6.
  // req after = (3.6*90 − 180)/36 = (324−180)/36 = 4.0 → extremely demanding.
  const s = mk({ futureGpa: 4.0 });
  assert.ok(Math.abs(s.requiredFutureGpaAfter - 4.0) < 1e-9);
  assert.equal(s.targetStatus, 'extremely-demanding');
});

test('an impossible position stays impossible after a weak scenario', () => {
  // Heavy position: cgpa 2.0 over 60, only 6 future credits.
  const s = mk({
    currentPoints: 2.0 * 60,
    currentCredits: 60,
    currentCgpa: 2.0,
    futureCredits: 3,
    remainingCredits: 6,
    futureGpa: 2.0,
    targetCgpa: 3.6,
  });
  assert.equal(s.targetStatus, 'impossible');
});

test('presets are config-driven: conservative=current, excellent=ceiling', () => {
  const presets = scenario.scenarioPresets(grading, 3.2, 3.9);
  assert.equal(presets[0].id, 'conservative');
  assert.equal(presets[0].gpa, 3.2); // holds current
  assert.equal(presets[1].id, 'target');
  assert.equal(presets[1].gpa, 3.9); // required, capped at ceiling 4.0
  assert.equal(presets[2].id, 'excellent');
  assert.equal(presets[2].gpa, 4.0); // top grade from the bands
});

test('target preset is capped at the ceiling when required GPA exceeds it', () => {
  const presets = scenario.scenarioPresets(grading, 2.0, 4.8);
  assert.equal(presets[1].gpa, 4.0); // capped to top grade
});

test('presets follow a non-4.0 ceiling from the configured bands', () => {
  const five = {
    id: '5',
    name: '5-point',
    bands: [
      { grade: 'A+', minScore: 80, maxScore: 100, points: 5.0 },
      { grade: 'F', minScore: 0, maxScore: 49, points: 0 },
    ],
  };
  const presets = scenario.scenarioPresets(five, 4.2, 4.6);
  assert.equal(presets[2].gpa, 5.0);
  assert.equal(presets[1].gpa, 4.6);
});

test('scenarios never mutate the confirmed record', () => {
  const pointsBefore = base.currentPoints;
  mk({ futureGpa: 4.0 });
  mk({ futureGpa: 2.0 });
  // The same base object is reused unchanged (pure function).
  assert.equal(base.currentPoints, pointsBefore);
  assert.equal(base.currentCgpa, 3.0);
});
