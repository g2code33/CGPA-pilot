// ─────────────────────────────────────────────────────────────────────────
// Tests for MILESTONES & AFFORDABLE DROP ANALYSIS (Prompt 13).
//
// Per-stage required/projected/target/max CGPA under three scenarios
// (best = configured ceiling, target = steady required average, user = a
// chosen possibly-lower GPA), and the affordable-drop verdict ("if I get X
// next semester, can I still reach T?"). No real-world performance data is
// assumed — best case is the configured maximum grade point.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import * as ms from '../src/services/milestoneService.ts';

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
  ],
};

// Remaining slots after L100 (36 credits): L200S1 18, L200S2 18, L300S1 18.
const remainingSlots = [
  { levelIndex: 2, levelLabel: 'L200', semesterIndex: 1, label: 'L200 S1', credits: 18, courseCount: 5 },
  { levelIndex: 2, levelLabel: 'L200', semesterIndex: 2, label: 'L200 S2', credits: 18, courseCount: 5 },
  { levelIndex: 3, levelLabel: 'L300', semesterIndex: 1, label: 'L300 S1', credits: 18, courseCount: 5 },
];

function analyze(over = {}) {
  return ms.analyzeMilestones(
    {
      currentPoints: over.currentPoints ?? 3.0 * 36, // 108
      currentCredits: over.currentCredits ?? 36,
      currentCgpa: over.currentCgpa ?? 3.0,
      currentLevelIndex: 1,
      remainingSlots,
      targetCgpa: over.target ?? 3.6,
      userGpa: over.userGpa ?? 3.2,
      fallbackCreditsPerSemester: 18,
      fallbackSemesterCount: 6,
    },
    grading,
    classification
  );
}

test('creates a stage per remaining leg with a graduation stage', () => {
  const a = analyze();
  assert.equal(a.stages.length, 3);
  assert.equal(a.stages[2].isGraduation, true);
  assert.ok(a.stages[1].isLevelEnd); // end of L200
  assert.equal(a.stages[0].isLevelEnd, false); // mid L200
});

test('cumulative credits and remaining credits track the curriculum loads', () => {
  const a = analyze();
  assert.equal(a.stages[0].cumulativeCredits, 54);
  assert.equal(a.stages[0].creditsRemainingAfter, 36); // 90 total − 54
  assert.equal(a.stages[2].creditsRemainingAfter, 0);
});

test('best case uses the configured ceiling and reaches the top at graduation', () => {
  const a = analyze();
  assert.equal(a.scenarios.best.futureGpa, 4.0);
  // (108 + 4*54)/90 = 324/90 = 3.6
  assert.ok(Math.abs(a.stages[2].projected.best - 3.6) < 1e-9);
});

test('target case is the steady average required to land exactly on target', () => {
  const a = analyze();
  // required = (3.6*90 − 108)/54 = 4.0
  assert.ok(Math.abs(a.scenarios.target.futureGpa - 4.0) < 1e-9);
  assert.ok(Math.abs(a.stages[2].projected.target - 3.6) < 1e-9);
});

test('target case adapts to a reachable target', () => {
  // target 3.0 with cgpa 3.0 → required future gpa = 3.0
  const a = analyze({ target: 3.0 });
  assert.ok(Math.abs(a.scenarios.target.futureGpa - 3.0) < 1e-9);
  assert.ok(Math.abs(a.stages[2].projected.target - 3.0) < 1e-9);
});

test('user scenario applies the entered lower GPA credit-weighted', () => {
  const a = analyze({ userGpa: 3.2 });
  assert.equal(a.scenarios.user.futureGpa, 3.2);
  // After first 18 cr at 3.2: (108 + 57.6)/54 = 165.6/54 = 3.0667
  assert.ok(Math.abs(a.stages[0].projected.user - 165.6 / 54) < 1e-9);
});

test('required GPA after each stage recovers the still-needed average', () => {
  const a = analyze({ userGpa: 3.2, target: 3.6 });
  // After stage 1 (36 cr left): req = (324 − 165.6)/36 = 4.4 → above ceiling.
  assert.ok(a.stages[0].requiredGpaAfter.user > 4.0);
  assert.equal(a.stages[0].reachable.user, false);
});

test('max possible CGPA is the best-case projection at every stage', () => {
  const a = analyze();
  for (const s of a.stages) {
    assert.ok(Math.abs(s.maxPossibleCgpa - s.projected.best) < 1e-9);
  }
});

test('affordable drop: a strong enough slip still reaches the target', () => {
  // cgpa 3.5 over 36 (126 pts); 54 future; target 3.6.
  // required overall = (324 − 126)/54 = 3.667. First semester 3.2 over 18:
  // after points = 126 + 57.6 = 183.6 over 54; remaining 36 →
  // req = (324 − 183.6)/36 = 3.9 (≤ 4.0, reachable).
  const a = analyze({ currentPoints: 3.5 * 36, currentCgpa: 3.5, userGpa: 3.2 });
  const v = a.dropVerdict;
  assert.ok(v);
  assert.notEqual(v.status, 'impossible');
  assert.ok(Math.abs(v.requiredFutureGpaAfter - 3.9) < 1e-9);
  assert.match(v.answer, /still reach/i) ;
});

test('affordable drop: a slip that makes the target impossible is flagged', () => {
  // cgpa 3.0; user 2.5 first semester → after = (108 + 45)/54 = 2.833;
  // req over 36 left = (324 − 153)/36 = 4.75 > 4.0.
  const a = analyze({ userGpa: 2.5 });
  assert.equal(a.dropVerdict.status, 'impossible');
  assert.ok(a.dropVerdict.requiredFutureGpaAfter > 4.0);
  assert.match(a.dropVerdict.answer, /No/);
});

test('drop verdict projects the updated CGPA after the lower semester', () => {
  const a = analyze({ userGpa: 3.5 });
  // (108 + 63)/54 = 3.1667
  assert.ok(Math.abs(a.dropVerdict.projectedCgpaAfter - 171 / 54) < 1e-9);
});

test('best case never exceeds the configured ceiling', () => {
  const a = analyze();
  for (const s of a.stages) assert.ok(s.projected.best <= 4.0 + 1e-9);
  assert.equal(a.maxPoints, 4.0);
});

test('a 5-point ceiling flows through best case and feasibility', () => {
  const five = {
    id: '5', name: '5',
    bands: [
      { grade: 'A+', points: 5.0, minScore: 80, maxScore: 100 },
      { grade: 'F', points: 0, minScore: 0, maxScore: 49 },
    ],
  };
  const a = ms.analyzeMilestones(
    {
      currentPoints: 4.0 * 36, currentCredits: 36, currentCgpa: 4.0,
      currentLevelIndex: 1, remainingSlots, targetCgpa: 4.5, userGpa: 4.0,
      fallbackCreditsPerSemester: 18, fallbackSemesterCount: 6,
    },
    five,
    classification
  );
  assert.equal(a.maxPoints, 5.0);
  assert.equal(a.scenarios.best.futureGpa, 5.0);
  // best graduation = (144 + 5*54)/90 = 414/90 = 4.6 ≥ 4.5
  assert.ok(a.stages[2].projected.best >= 4.5 - 1e-9);
});
