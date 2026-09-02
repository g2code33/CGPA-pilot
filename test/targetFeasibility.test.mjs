// ─────────────────────────────────────────────────────────────────────────
// Tests for the TARGET & FEASIBILITY ENGINE (Prompt 9).
//
//  • Current/target CGPA, credits completed/remaining, required future QP and
//    average GPA, and maximum possible final CGPA — full precision.
//  • Four-tier status: achievable / very demanding / extremely demanding /
//    impossible, plus "met" and "unknown".
//  • IMPOSSIBLE is declared ONLY when the required future average exceeds the
//    configured maximum grade point (derived from the grading bands).
//  • Targets/classes come from the configured classification system.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import * as target from '../src/services/targetService.ts';

const uccGrading = {
  id: 'ucc',
  name: 'UCC',
  bands: [
    { grade: 'A', minScore: 80, maxScore: 100, points: 4.0, interpretation: 'Excellent' },
    { grade: 'B+', minScore: 75, maxScore: 79, points: 3.5, interpretation: 'Very Good' },
    { grade: 'B', minScore: 70, maxScore: 74, points: 3.0, interpretation: 'Good' },
    { grade: 'C+', minScore: 65, maxScore: 69, points: 2.5 },
    { grade: 'C', minScore: 60, maxScore: 64, points: 2.0 },
    { grade: 'D', minScore: 50, maxScore: 54, points: 1.0 },
    { grade: 'E', minScore: 0, maxScore: 49, points: 0.0 },
  ],
};

const uccClassification = {
  id: 'ucc-cls',
  name: 'UCC',
  bands: [
    { id: 'first', label: 'First Class', minCgpa: 3.6, maxCgpa: 4.0, tone: 'gold' },
    { id: '2u', label: 'Second Class Upper', minCgpa: 3.0, maxCgpa: 3.59, tone: 'green' },
    { id: '2l', label: 'Second Class Lower', minCgpa: 2.5, maxCgpa: 2.99, tone: 'teal' },
    { id: '3rd', label: 'Third Class', minCgpa: 2.0, maxCgpa: 2.49, tone: 'blue' },
    { id: 'pass', label: 'Pass', minCgpa: 1.0, maxCgpa: 1.99, tone: 'gray' },
    { id: 'fail', label: 'Fail', minCgpa: 0, maxCgpa: 0.99, tone: 'red' },
  ],
};

function analyze(over) {
  return target.analyzeTarget(
    {
      currentPoints: over.currentPoints ?? 0,
      creditsCompleted: over.creditsCompleted ?? 0,
      creditsRemaining: over.creditsRemaining ?? 0,
      targetCgpa: over.targetCgpa ?? 3.6,
      currentCgpa: over.currentCgpa ?? null,
    },
    over.grading ?? uccGrading,
    over.classification ?? uccClassification
  );
}

// ── Basic figures ──────────────────────────────────────────────────────────

test('reports current/target CGPA and credits completed/remaining', () => {
  const a = analyze({
    currentPoints: 3.4 * 36,
    creditsCompleted: 36,
    creditsRemaining: 24,
    targetCgpa: 3.6,
    currentCgpa: 3.4,
  });
  assert.equal(a.currentCgpa, 3.4);
  assert.equal(a.targetCgpa, 3.6);
  assert.equal(a.creditsCompleted, 36);
  assert.equal(a.creditsRemaining, 24);
  assert.equal(a.totalCredits, 60);
});

test('required future quality points = target×total − current points', () => {
  const a = analyze({
    currentPoints: 3.4 * 36, // 122.4
    creditsCompleted: 36,
    creditsRemaining: 24,
    targetCgpa: 3.6,
    currentCgpa: 3.4,
  });
  // 3.6*60 = 216 total points needed; 216 − 122.4 = 93.6 over 24 credits.
  assert.ok(Math.abs(a.requiredFuturePoints - (3.6 * 60 - 122.4)) < 1e-9);
  assert.ok(Math.abs(a.requiredFuturePoints - 93.6) < 1e-9);
  assert.ok(Math.abs(a.requiredFutureGpa - 93.6 / 24) < 1e-9);
});

test('maximum possible final CGPA assumes the top grade on remaining credits', () => {
  const a = analyze({
    currentPoints: 3.0 * 24,
    creditsCompleted: 24,
    creditsRemaining: 24,
    targetCgpa: 3.6,
    currentCgpa: 3.0,
  });
  // (72 + 4*24)/48 = 168/48 = 3.5
  assert.ok(Math.abs(a.maxFinalCgpa - 3.5) < 1e-9);
  assert.equal(a.maxGradePoints, 4.0);
});

test('target classification is resolved from the configured rules', () => {
  const a = analyze({
    currentPoints: 120, creditsCompleted: 36, creditsRemaining: 24,
    targetCgpa: 3.6, currentCgpa: 3.3,
  });
  assert.equal(a.targetClass?.label, 'First Class');
});

// ── Status tiers ───────────────────────────────────────────────────────────

test('status: MET when current CGPA already reaches the target', () => {
  const a = analyze({
    currentPoints: 3.8 * 40, creditsCompleted: 40, creditsRemaining: 20,
    targetCgpa: 3.6, currentCgpa: 3.8,
  });
  assert.equal(a.status, 'met');
  assert.match(a.statusLabel, /achieved/i);
});

test('status: ACHIEVABLE when the required average is within a strong grade', () => {
  // cgpa 2.8, target 3.0, d=20, r=40 → req = 3.0 + 0.2*0.5 = 3.1 (≤ 3.50 B+)
  const a = analyze({
    currentPoints: 2.8 * 20, creditsCompleted: 20, creditsRemaining: 40,
    targetCgpa: 3.0, currentCgpa: 2.8,
  });
  assert.equal(a.status, 'achievable');
  assert.ok(Math.abs(a.requiredFutureGpa - 3.1) < 1e-9);
});

test('status: VERY DEMANDING between a strong grade and near-top', () => {
  // cgpa 3.4, target 3.6, d=30, r=60 → req = (3.6*90 − 102)/60 = 3.70
  const a = analyze({
    currentPoints: 3.4 * 30, creditsCompleted: 30, creditsRemaining: 60,
    targetCgpa: 3.6, currentCgpa: 3.4,
  });
  assert.equal(a.status, 'very-demanding');
  assert.ok(Math.abs(a.requiredFutureGpa - 3.7) < 1e-9);
});

test('status: EXTREMELY DEMANDING just under the ceiling', () => {
  // cgpa 3.4, target 3.6, d=30, r=30 → req = (3.6*60 − 102)/30 = 3.80
  const a = analyze({
    currentPoints: 3.4 * 30, creditsCompleted: 30, creditsRemaining: 30,
    targetCgpa: 3.6, currentCgpa: 3.4,
  });
  assert.equal(a.status, 'extremely-demanding');
  assert.ok(Math.abs(a.requiredFutureGpa - 3.8) < 1e-9);
  assert.ok(a.requiredFutureGpa <= 4.0); // still mathematically reachable
});

test('status: IMPOSSIBLE only when req exceeds the configured ceiling', () => {
  // cgpa 2.0 over 30, 6 remaining, target 3.6 → req = 11.6 > 4.0
  const a = analyze({
    currentPoints: 2.0 * 30, creditsCompleted: 30, creditsRemaining: 6,
    targetCgpa: 3.6, currentCgpa: 2.0,
  });
  assert.equal(a.status, 'impossible');
  assert.ok(a.requiredFutureGpa > a.maxGradePoints);
  // The proof: even the best possible finish is below target.
  assert.ok(a.maxFinalCgpa < 3.6);
});

test('a required average exactly at the ceiling is NOT impossible', () => {
  // Boundary: req = 4.0 exactly must be extremely-demanding (reachable),
  // never impossible.
  // cgpa c, target 3.6, d/r chosen so req = 4.0:
  // req = 3.6 + (3.6−c)*d/r = 4.0  → (3.6−c)*d/r = 0.4
  // c=3.2, d/r = 1: req = 3.6+0.4 = 4.0
  const a = analyze({
    currentPoints: 3.2 * 30, creditsCompleted: 30, creditsRemaining: 30,
    targetCgpa: 3.6, currentCgpa: 3.2,
  });
  assert.ok(Math.abs(a.requiredFutureGpa - 4.0) < 1e-9);
  assert.notEqual(a.status, 'impossible');
  assert.equal(a.status, 'extremely-demanding');
});

// ── Unknown states ─────────────────────────────────────────────────────────

test('UNKNOWN when no current CGPA yet', () => {
  const a = analyze({
    currentPoints: 0, creditsCompleted: 0, creditsRemaining: 60,
    targetCgpa: 3.6, currentCgpa: null,
  });
  assert.equal(a.status, 'unknown');
  assert.equal(a.requiredFutureGpa, null);
});

test('UNKNOWN when there are no remaining credits to project', () => {
  const a = analyze({
    currentPoints: 3.5 * 60, creditsCompleted: 60, creditsRemaining: 0,
    targetCgpa: 3.6, currentCgpa: 3.5,
  });
  assert.equal(a.status, 'unknown');
});

// ── Config-driven ceiling (not hard-coded 4.0) ─────────────────────────────

test('feasibility uses a non-4.0 ceiling from the grading bands', () => {
  const five = {
    id: '5',
    name: '5-point',
    bands: [
      { grade: 'A+', minScore: 80, maxScore: 100, points: 5.0 },
      { grade: 'A', minScore: 70, maxScore: 79, points: 4.5 },
      { grade: 'F', minScore: 0, maxScore: 49, points: 0 },
    ],
  };
  // On a 5-point scale, a required average of 4.7 is very demanding but
  // reachable; 4.6*… let's build a req ≈ 4.7 (< 5.0 ceiling).
  // req = target + (target−c)*d/r. target 4.5, c 4.0, d=28, r=28:
  // req = 4.5 + 0.5*1 = 5.0 → extremely demanding boundary.
  const a = target.analyzeTarget(
    {
      currentPoints: 4.0 * 28,
      creditsCompleted: 28,
      creditsRemaining: 28,
      targetCgpa: 4.5,
      currentCgpa: 4.0,
    },
    five,
    uccClassification
  );
  assert.equal(a.maxGradePoints, 5.0);
  assert.ok(Math.abs(a.requiredFutureGpa - 5.0) < 1e-9);
  assert.notEqual(a.status, 'impossible');

  // A req above 5.0 is impossible on THIS scale.
  const b = target.analyzeTarget(
    {
      currentPoints: 3.0 * 30,
      creditsCompleted: 30,
      creditsRemaining: 6,
      targetCgpa: 4.8,
      currentCgpa: 3.0,
    },
    five,
    uccClassification
  );
  assert.ok(b.requiredFutureGpa > 5.0);
  assert.equal(b.status, 'impossible');
});

test('every analysis carries a plain-language explanation', () => {
  const a = analyze({
    currentPoints: 3.4 * 30, creditsCompleted: 30, creditsRemaining: 30,
    targetCgpa: 3.6, currentCgpa: 3.4,
  });
  assert.ok(Array.isArray(a.explanation));
  assert.ok(a.explanation.length >= 3);
  assert.ok(a.explanation.join(' ').includes('3.80'));
});
