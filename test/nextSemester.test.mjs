// ─────────────────────────────────────────────────────────────────────────
// Tests for the NEXT SEMESTER PILOT (Prompt 12).
//
// Verifies next-semester detection from the curriculum, the required
// next-semester GPA, mission status, mathematically-derived target-grade
// combinations (efficient clears with the fewest/highest-credit upgrades),
// target-grade math vs course credits, alternatives, and per-course
// what-if recomputation.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import * as ns from '../src/services/nextSemesterService.ts';

const grading = {
  id: 'ucc',
  name: 'UCC',
  bands: [
    { grade: 'A', minScore: 80, maxScore: 100, points: 4.0 },
    { grade: 'B+', minScore: 75, maxScore: 79, points: 3.5 },
    { grade: 'B', minScore: 70, maxScore: 74, points: 3.0 },
    { grade: 'C+', minScore: 65, maxScore: 69, points: 2.5 },
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

function course(code, credits, level, semester, status = 'active') {
  return {
    id: code,
    code,
    name: `${code} course`,
    creditHours: credits,
    level,
    semester,
    programmeId: 'p',
    curriculumId: 'c',
    status,
    core: true,
  };
}

function curriculum() {
  const level = (n) => ({
    index: n,
    label: `Level ${n * 100}`,
    semesters: [1, 2].map((s) => ({
      index: s,
      label: `Semester ${s}`,
      courses:
        n === 2 && s === 1
          ? [course('PHA211', 4, n, s), course('PHA212', 3, n, s), course('PHA213', 2, n, s)]
          : [],
    })),
  });
  return {
    id: 'cur',
    versionName: 'test',
    programmeId: 'p',
    effectiveAcademicYear: '2026/27',
    effectiveDate: '2026-08-31',
    status: 'published',
    levels: [level(1), level(2)],
  };
}

test('nextSemesterAfter advances semester then level from the curriculum', () => {
  const c = curriculum();
  const s2 = ns.nextSemesterAfter(c, 1, 1);
  assert.equal(s2.levelIndex, 1);
  assert.equal(s2.semesterIndex, 2);

  const l2s1 = ns.nextSemesterAfter(c, 1, 2);
  assert.equal(l2s1.levelIndex, 2);
  assert.equal(l2s1.semesterIndex, 1);
  assert.equal(l2s1.credits, 9); // 4 + 3 + 2 active courses
  assert.deepEqual(l2s1.courses.map((x) => x.code), ['PHA211', 'PHA212', 'PHA213']);
});

test('inactive courses are excluded from next-semester courses', () => {
  const c = curriculum();
  c.levels[1].semesters[0].courses.push(course('PHA214', 3, 2, 1, 'inactive'));
  const next = ns.nextSemesterAfter(c, 1, 2);
  assert.equal(next.credits, 9); // inactive 3 cr excluded
});

function plan(over = {}) {
  const cur = curriculum();
  const next = ns.nextSemesterAfter(cur, 1, 2); // L200 S1, 9 credits
  return ns.planNextSemester(
    {
      currentPoints: over.currentPoints ?? 3.0 * 36, // 108
      currentCredits: over.currentCredits ?? 36,
      currentCgpa: over.currentCgpa ?? 3.0,
      remainingCredits: over.remainingCredits ?? 63, // 9 next + 54 after
      targetCgpa: over.targetCgpa ?? 3.6,
      next,
      fallbackCredits: 18,
      curriculumPublished: true,
    },
    grading,
    classification
  );
}

test('required next GPA is the uniform target average, capped at the ceiling', () => {
  const p = plan();
  // req = (3.6*99 − 108)/63 = (356.4 − 108)/63 = 248.4/63 = 3.9429
  assert.ok(Math.abs(p.requiredNextGpa - 248.4 / 63) < 1e-9);
  assert.ok(p.requiredNextGpa <= 4.0);
  assert.equal(p.status, 'on-track');
  assert.equal(p.targetClassLabel, 'First Class');
});

test('status is impossible when the required average exceeds the ceiling', () => {
  // cgpa 2.0 over 60, 6 remaining, target 3.6
  const p = plan({
    currentPoints: 2.0 * 60,
    currentCredits: 60,
    currentCgpa: 2.0,
    remainingCredits: 9,
    next: { levelIndex: 2, semesterIndex: 1, label: 'L200 — Semester 1', courses: [], credits: 0 },
    curriculumPublished: false,
  });
  assert.equal(p.status, 'impossible');
  assert.equal(p.combos.length, 0);
});

test('status is already-above when the target is already secured on remaining credits', () => {
  // With essentially no meaningful credits left, the required future average
  // drops to ≤ 0: a perfect record already locks the target.
  // 4.0 over 96 cr; 2 remaining; target 3.6 → (3.6×98 − 384)/2 = −16.8.
  const p = plan({
    currentPoints: 4.0 * 96,
    currentCredits: 96,
    currentCgpa: 4.0,
    remainingCredits: 2,
  });
  assert.equal(p.status, 'already-above');
});

test('target-grade combos are derived and each clears the required points', () => {
  const p = plan();
  const requiredPoints = p.requiredNextPoints;
  for (const combo of p.combos) {
    const points = combo.assignments.reduce((s, a) => s + a.points * a.creditHours, 0);
    assert.ok(points >= requiredPoints - 1e-9, `${combo.id} clears required points`);
  }
});

test('the focused (efficient) combo upgrades high-credit courses first', () => {
  const p = plan();
  // Required next GPA ≈ 3.9429 over 9 cr ≈ 35.49 points.
  // Courses: 4cr PHA211, 3cr PHA212, 2cr PHA213.
  // Minimal: start all at E(0). Total 0. Upgrade 4cr: E→A adds 4*4=16 → 16.
  // Upgrade 3cr: E→A adds 3*4=12 → 28. Upgrade 2cr: E→A adds 8 → 36 ≥ 35.49.
  // So focused plan is A in all three (4.0) — all must be A to clear 35.49.
  const eff = p.combos.find((c) => c.id === 'efficient');
  assert.ok(eff);
  assert.deepEqual(eff.assignments.map((a) => a.grade), ['A', 'A', 'A']);
});

test('a moderate target yields a focused combo lighter than the top combo', () => {
  // Target 2nd Upper (3.0); cgpa 3.0 → required next ≈ 3.0 over 9 cr.
  // Required points = 27. Minimal from E: upgrade 4cr to A = 16, 3cr to A = 12
  // → 28 ≥ 27. So PHA211=A, PHA212=A, PHA213=E. Focused lighter than all-A.
  const p = plan({ targetCgpa: 3.0 });
  const eff = p.combos.find((c) => c.id === 'efficient');
  const grades = eff.assignments.map((a) => a.grade);
  assert.equal(grades[0], 'A'); // 4-credit course at top
  assert.equal(grades[1], 'A'); // 3-credit at top
  assert.equal(grades[2], 'E'); // 2-credit left at floor — still clears
  const top = p.combos.find((c) => c.id === 'top');
  assert.ok(top.assignments.every((a) => a.grade === 'A'));
  assert.ok(eff.totalPoints <= top.totalPoints);
});

test('balanced combo aims every course at the band meeting the required average', () => {
  const p = plan({ targetCgpa: 3.0 }); // required ≈ 3.0
  const bal = p.combos.find((c) => c.id === 'balanced');
  // 3.0 maps to B.
  assert.ok(bal.assignments.every((a) => a.grade === 'B'));
});

test('what-if: locking a grade recalculates the remaining target grades', () => {
  const p = plan({ targetCgpa: 3.0 }); // required ≈ 3.0, ~27 points
  const result = ns.whatIfGrades(
    p.next.courses,
    { PHA211: 'B+' }, // 4 cr at 3.5 = 14 points locked
    grading,
    p.requiredNextPoints
  );
  // Locked contributes 14; remaining courses must cover 27 − 14 = 13 points.
  assert.equal(result.lockedCredits, 4);
  assert.ok(Math.abs(result.lockedPoints - 14) < 1e-9);
  const byCode = Object.fromEntries(result.assignments.map((a) => [a.code, a.grade]));
  assert.equal(byCode.PHA211, 'B+'); // locked
  // The derived remaining grades must bring total to clear the target.
  assert.ok(result.totalPoints >= p.requiredNextPoints - 1e-9);
});

test('what-if reports not clearing when even top remaining grades fall short', () => {
  const p = plan(); // required ≈ 35.49
  // Lock a failing grade in the 4-credit course: 4*0 = 0; remaining 5 cr max
  // = 5*4 = 20 < 35.49 → cannot clear.
  const result = ns.whatIfGrades(
    p.next.courses,
    { PHA211: 'E' },
    grading,
    p.requiredNextPoints
  );
  assert.equal(result.clears, false);
});

test('combinations never use points outside the configured grading system', () => {
  const p = plan();
  const validGrades = grading.bands.map((b) => b.grade);
  for (const combo of p.combos) {
    for (const a of combo.assignments) {
      assert.ok(validGrades.includes(a.grade), `grade ${a.grade} is configured`);
    }
  }
});

test('reshuffle: every reshuffled plan is valid (same courses, clears required points)', () => {
  const p = plan();
  const codes = p.next.courses.map((c) => c.code).sort();
  for (let i = 0; i < 25; i++) {
    const combo = ns.reshufflePlan(p.next.courses, grading, p.requiredNextPoints);
    assert.ok(combo, 'produces a combo');
    // Same course set, same credits per course.
    assert.deepEqual(combo.assignments.map((a) => a.code).sort(), codes);
    for (const a of combo.assignments) {
      const src = p.next.courses.find((c) => c.code === a.code);
      assert.equal(a.creditHours, src.creditHours);
      assert.ok(grading.bands.some((b) => b.grade === a.grade), 'grade from configured scale');
    }
    // Still meets the required points — a reshuffle never breaks the plan.
    assert.ok(combo.totalPoints >= p.requiredNextPoints - 1e-9, 'clears required points');
    assert.equal(combo.clears, true);
  }
});

test('reshuffle: repeated reshuffles produce variety (not always identical)', () => {
  // A lower target leaves headroom, so different valid mixes exist.
  const p = plan({ targetCgpa: 3.0 });
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const combo = ns.reshufflePlan(p.next.courses, grading, p.requiredNextPoints);
    seen.add(combo.assignments.map((a) => a.grade).join('|'));
  }
  assert.ok(seen.size > 1, `expected variety across reshuffles, got ${seen.size} distinct mixes`);
});

test('reshuffle: returns null for an empty course list', () => {
  assert.equal(ns.reshufflePlan([], grading, 10), null);
});
