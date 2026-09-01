// ─────────────────────────────────────────────────────────────────────────
// Admin Calculation Test Lab (Prompt 17) — automated run of the built-in
// fabricated suite. Every case compares the real calculation engine's
// actual output to a hand-computed expected value at FULL precision; any
// mathematical regression fails here. All data is synthetic test data.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { runLabCase, runLabSuite, buildTestCurriculum } from '../src/admin/testLab.ts';
import { BUILTIN_TEST_CASES } from '../src/admin/testLabCases.ts';

test('the built-in test lab suite covers every required category', () => {
  const categories = new Set(BUILTIN_TEST_CASES.map((c) => c.category));
  for (const required of [
    'Credit weighting',
    'Semester GPA',
    'Maximum GPA',
    'Minimum GPA',
    'Target feasibility',
    'Pending results',
    'Classification boundaries',
    'Rounding',
    'Curriculum changes',
    'Programme structure',
    'What-If',
    'Milestones',
    'Next-semester planning',
  ]) {
    assert.ok(categories.has(required), `suite must include category: ${required}`);
  }
});

test('the built-in suite uses only fabricated, clearly-marked test data', () => {
  for (const c of BUILTIN_TEST_CASES) {
    assert.ok(c.id, 'case has an id');
    // No personal data fields exist anywhere on a lab case.
    assert.equal(c.name.toLowerCase().includes('student'), false);
    assert.ok(!('email' in c) && !('phone' in c) && !('name-real' in c));
    // Curricula used by cases are synthetic TEST curricula.
    if (c.curriculum) {
      assert.ok(c.curriculum.id.startsWith('test-curriculum-'), 'curriculum must be fabricated');
      assert.ok(c.curriculum.versionName.includes('TEST'), 'curriculum must be marked TEST');
    }
  }
});

test('EVERY built-in case PASSES (actual engine output == expected)', () => {
  const results = runLabSuite(BUILTIN_TEST_CASES);
  const failures = results.filter((r) => !r.pass);
  assert.equal(
    failures.length,
    0,
    failures.map((f) => `${f.id}: expected ${f.expected}, got ${f.actual}`).join('\n')
  );
  assert.ok(results.length >= 40, `suite should be comprehensive, got ${results.length} cases`);
});

test('the lab genuinely fails when an engine result is wrong', () => {
  // A deliberately-wrong expectation must produce FAIL (guards against
  // a runner that always reports PASS).
  const bad = runLabCase({
    id: 'sentinel',
    name: 'SENTINEL wrong expectation',
    category: 'Credit weighting',
    metric: 'cgpaHistory',
    semesters: [{ gpa: 3.0, credits: 18 }],
    expected: 9.99,
  });
  assert.equal(bad.pass, false);
  assert.equal(bad.actual, '3.0000');
  assert.equal(bad.expected, '9.9900');
});

test('custom curricula produce different remaining-credit structures', () => {
  const c4 = buildTestCurriculum({ levels: 4, creditsPerSemester: 18 });
  const c6 = buildTestCurriculum({ levels: 6, creditsPerSemester: 18 });
  const r4 = runLabCase({
    id: 'c4', name: 'c4', category: 'Curriculum changes', metric: 'requiredFutureGpa',
    currentCgpa: 3.0, completedCredits: 36, currentLevel: 1, currentSemester: 2,
    targetCgpa: 3.6, curriculum: c4, expected: 3.8,
  });
  const r6 = runLabCase({
    id: 'c6', name: 'c6', category: 'Curriculum changes', metric: 'requiredFutureGpa',
    currentCgpa: 3.0, completedCredits: 36, currentLevel: 1, currentSemester: 2,
    targetCgpa: 3.6, curriculum: c6, expected: 3.72,
  });
  assert.ok(r4.pass);
  assert.ok(r6.pass);
});
