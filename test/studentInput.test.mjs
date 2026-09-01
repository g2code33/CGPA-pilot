// ─────────────────────────────────────────────────────────────────────────
// Tests for the STUDENT INPUT EXPERIENCE (Prompt 8).
//
//  • GPA/CGPA entries are validated against the CONFIGURED grading system
//    (ceiling derived from its bands, never hard-coded).
//  • Empty entry is allowed ("not entered"); out-of-range entries are
//    rejected with a message.
//  • Input-mode → engine-mode mapping (quick/planning → current; history).
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import * as grading from '../src/services/gradingService.ts';

const ucc = {
  id: 'ucc',
  name: 'UCC',
  bands: [
    { grade: 'A', minScore: 80, maxScore: 100, points: 4.0 },
    { grade: 'B+', minScore: 75, maxScore: 79, points: 3.5 },
    { grade: 'D', minScore: 50, maxScore: 54, points: 1.0 },
    { grade: 'E', minScore: 0, maxScore: 49, points: 0.0 },
  ],
};

const fiveScale = {
  id: '5',
  name: '5-point',
  bands: [
    { grade: 'A+', minScore: 80, maxScore: 100, points: 5.0 },
    { grade: 'F', minScore: 0, maxScore: 49, points: 0.0 },
  ],
};

test('ceiling and floor are derived from the configured bands', () => {
  assert.equal(grading.maxGradePoints(ucc), 4.0);
  assert.equal(grading.minGradePoints(ucc), 0.0);
  assert.equal(grading.maxGradePoints(fiveScale), 5.0);
});

test('empty GPA (not entered) is valid', () => {
  assert.equal(grading.validateGpa(null, ucc), null);
});

test('GPA within the configured scale is valid', () => {
  assert.equal(grading.validateGpa(0, ucc), null);
  assert.equal(grading.validateGpa(3.42, ucc), null);
  assert.equal(grading.validateGpa(4.0, ucc), null);
});

test('GPA above the configured ceiling is rejected with the scale value', () => {
  const err = grading.validateGpa(4.01, ucc);
  assert.ok(err);
  assert.match(err, /4\.00/);
});

test('negative GPA is rejected', () => {
  assert.ok(grading.validateGpa(-0.5, ucc));
});

test('NaN GPA is reported as a number error', () => {
  assert.match(grading.validateGpa(Number.NaN, ucc), /number/i);
});

test('validation follows a different configured ceiling (5-point scale)', () => {
  // 4.5 is valid on a 5-point scale but would be invalid on a 4-point scale.
  assert.equal(grading.validateGpa(4.5, fiveScale), null);
  assert.ok(grading.validateGpa(4.5, ucc));
  assert.ok(grading.validateGpa(5.01, fiveScale));
});

test('clampGpa constrains derived values to the configured scale', () => {
  assert.equal(grading.clampGpa(6.2, ucc), 4.0);
  assert.equal(grading.clampGpa(-1, ucc), 0.0);
  assert.equal(grading.clampGpa(3.2, ucc), 3.2);
});
