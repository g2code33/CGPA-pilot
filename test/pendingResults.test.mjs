// ─────────────────────────────────────────────────────────────────────────
// Tests for the PENDING RESULTS system (Prompt 7).
//
// Guarantees:
//  • A pending course/semester is NEVER a known grade: excluded from the
//    confirmed CGPA while its known (curriculum) credits feed projections.
//  • Three statuses: complete / pending / not-entered.
//  • Confirmed position, possible range, best case, worst case, effect of
//    pending credits, and target feasibility under possible outcomes.
//  • Pending data is temporary in-memory state only (no persistence path).
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/services/coreCgpaService.ts';
import * as pending from '../src/services/pendingService.ts';

const uccGrading = {
  id: 'ucc',
  name: 'UCC',
  bands: [
    { grade: 'A', minScore: 80, maxScore: 100, points: 4.0, interpretation: 'Excellent' },
    { grade: 'B+', minScore: 75, maxScore: 79, points: 3.5, interpretation: 'Very Good' },
    { grade: 'B', minScore: 70, maxScore: 74, points: 3.0, interpretation: 'Good' },
    { grade: 'C+', minScore: 65, maxScore: 69, points: 2.5, interpretation: 'Average' },
    { grade: 'C', minScore: 60, maxScore: 64, points: 2.0, interpretation: 'Fair' },
    { grade: 'D+', minScore: 55, maxScore: 59, points: 1.5, interpretation: 'Barely' },
    { grade: 'D', minScore: 50, maxScore: 54, points: 1.0, interpretation: 'Weak Pass' },
    { grade: 'E', minScore: 0, maxScore: 49, points: 0.0, interpretation: 'Fail' },
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

let counter = 0;
function sem(over = {}) {
  counter += 1;
  return {
    id: over.id ?? `s${counter}`,
    label: over.label ?? `Semester ${counter}`,
    levelIndex: over.levelIndex ?? 1,
    semesterIndex: over.semesterIndex ?? 1,
    gpa: over.gpa ?? null,
    creditHoursOverride: over.creditHoursOverride ?? null,
    pending: over.pending ?? false,
    courses: over.courses ?? [],
  };
}
function course(over = {}) {
  counter += 1;
  return {
    id: `c${counter}`,
    code: over.code ?? '',
    name: over.name ?? '',
    creditHours: over.creditHours ?? 3,
    score: over.score ?? null,
    grade: over.grade ?? null,
    pending: over.pending ?? false,
  };
}

// ── 1. The three statuses ──────────────────────────────────────────────────

test('semester statuses: complete / pending / not-entered', () => {
  assert.equal(
    core.semesterStatus(sem({ gpa: 3.5, creditHoursOverride: 18 })),
    'complete'
  );
  assert.equal(
    core.semesterStatus(sem({ pending: true, gpa: 3.5 })),
    'pending'
  );
  assert.equal(core.semesterStatus(sem({ gpa: null })), 'not-entered');
});

test('course statuses: complete / pending / not-entered', () => {
  assert.equal(core.courseStatus(course({ grade: 'A' })), 'complete');
  assert.equal(core.courseStatus(course({ pending: true, grade: 'A' })), 'pending');
  assert.equal(core.courseStatus(course({})), 'not-entered');
});

// ── 2. A pending result is NEVER a known grade ─────────────────────────────

test('a pending semester is fully excluded from the confirmed CGPA', () => {
  const semesters = [
    sem({ gpa: 3.0, creditHoursOverride: 18, levelIndex: 1, semesterIndex: 1 }),
    sem({ gpa: 4.0, creditHoursOverride: 18, pending: true, levelIndex: 1, semesterIndex: 2 }),
  ];
  const r = core.weightedCgpa(semesters, uccGrading);
  // Only the first (confirmed) semester counts.
  assert.equal(r.totalCreditHours, 18);
  assert.equal(r.cgpa, 3.0);
  // The pending 18 credits are reported (for projections), not graded.
  assert.equal(r.pendingCreditHours, 18);
  assert.equal(r.terms[1].source, 'pending');
  assert.equal(r.terms[1].gpa, null);
  assert.equal(r.terms[1].qualityPoints, 0);
});

test('a pending semester with a typed-in GPA still does NOT use it', () => {
  // Even if a stale GPA value exists, pending wins and it is excluded.
  const s = sem({ gpa: 4.0, creditHoursOverride: 15, pending: true });
  const t = core.semesterTerm(s, uccGrading, 15);
  assert.equal(t.source, 'pending');
  assert.equal(t.creditHours, 0);
  assert.equal(t.qualityPoints, 0);
  assert.equal(t.pendingCreditHours, 15);
});

test('a pending course never contributes points but its credits are reported', () => {
  const s = sem({
    gpa: null,
    courses: [
      course({ grade: 'A', creditHours: 3 }), // confirmed 12 pts / 3 cr
      course({ grade: 'A', creditHours: 3, pending: true }), // pending
    ],
  });
  const r = core.weightedCgpa([s], uccGrading);
  assert.equal(r.totalCreditHours, 3);
  assert.equal(r.cgpa, 4.0);
  assert.equal(r.pendingCreditHours, 3);
  assert.equal(r.pendingCount, 1);
});

test('"3-credit course — Result Pending" stays Result Pending, never a grade', () => {
  const c = course({ creditHours: 3, grade: 'A', pending: true });
  // The status helper is the single source of truth for the UI label.
  assert.equal(core.courseStatus(c), 'pending');
  // Even with a leftover grade value, a pending course yields no points and
  // no effective grade for the engine.
  const term = core.semesterTerm(sem({ courses: [c] }), uccGrading, 3);
  assert.equal(term.qualityPoints, 0);
  assert.equal(term.pendingCreditHours, 3);
});

// ── 3. Pending credits come from the configured curriculum ─────────────────

test('pending semester credits fall back to the curriculum load', () => {
  const s = sem({ gpa: null, creditHoursOverride: null, pending: true });
  const t = core.semesterTerm(s, uccGrading, 20); // curriculum says 20
  assert.equal(t.pendingCreditHours, 20);
});

// ── 4. Current-mode baseline with pending credits ──────────────────────────

test('current mode: pending credits are removed from the confirmed base', () => {
  // Completed 52 curriculum credits, 6 of them pending; CGPA 3.4 is over
  // released results only.
  const baseline = {
    levelIndex: 2, semesterIndex: 1, cgpa: 3.4, creditHours: 0,
    pendingCreditHours: 6,
  };
  const rec = core.currentModeRecord(baseline, 52);
  assert.equal(rec.creditHours, 46); // 52 − 6 confirmed
  assert.ok(Math.abs(rec.qualityPoints - 3.4 * 46) < 1e-9);
});

test('current mode snapshot exposes pending credits for projections', () => {
  const state = {
    mode: 'current',
    semesters: [],
    baseline: { levelIndex: 1, semesterIndex: 2, cgpa: 3.5, creditHours: 0, pendingCreditHours: 6 },
    targetCgpa: 3.6,
    plannedNextCreditHours: 18,
  };
  const snap = core.computeSnapshot(state, uccGrading, { curriculumCompletedCredits: 36 });
  assert.equal(snap.creditHours, 30); // 36 − 6
  assert.equal(snap.pendingCreditHours, 6);
  assert.ok(Math.abs(snap.cgpa - 3.5) < 1e-12);
});

// ── 5. Pending projection: confirmed, range, best, worst ───────────────────

test('best case assumes the top grade on every pending credit', () => {
  // Confirmed 3.0 over 18 cr; 18 pending. Best = (54 + 4*18)/36 = 126/36.
  const p = pending.pendingProjection(
    {
      confirmedPoints: 3.0 * 18,
      confirmedCreditHours: 18,
      pendingCreditHours: 18,
      pendingCount: 1,
      target: null,
    },
    uccGrading,
    uccClassification
  );
  assert.ok(Math.abs(p.confirmedCgpa - 3.0) < 1e-12);
  assert.ok(Math.abs(p.bestCaseCgpa - 126 / 36) < 1e-12);
  assert.ok(Math.abs(p.bestCaseCgpa - 3.5) < 1e-12);
});

test('worst case assumes the floor grade (0.0) on every pending credit', () => {
  const p = pending.pendingProjection(
    {
      confirmedPoints: 3.0 * 18,
      confirmedCreditHours: 18,
      pendingCreditHours: 18,
      pendingCount: 1,
      target: null,
    },
    uccGrading,
    uccClassification
  );
  // Worst = (54 + 0)/36 = 1.5
  assert.ok(Math.abs(p.worstCaseCgpa - 54 / 36) < 1e-12);
  assert.ok(Math.abs(p.worstCaseCgpa - 1.5) < 1e-12);
});

test('min-pass scenario uses the weakest passing grade point', () => {
  const p = pending.pendingProjection(
    {
      confirmedPoints: 3.0 * 18,
      confirmedCreditHours: 18,
      pendingCreditHours: 18,
      pendingCount: 1,
      target: null,
    },
    uccGrading,
    uccClassification
  );
  // Weakest pass on UCC = D = 1.0 → (54 + 1*18)/36 = 72/36 = 2.0
  assert.equal(p.minPositivePoints, 1.0);
  assert.ok(Math.abs(p.minPassCgpa - 2.0) < 1e-12);
});

test('the possible range always brackets the confirmed CGPA', () => {
  const p = pending.pendingProjection(
    {
      confirmedPoints: 3.2 * 30,
      confirmedCreditHours: 30,
      pendingCreditHours: 6,
      pendingCount: 2,
      target: null,
    },
    uccGrading,
    uccClassification
  );
  assert.ok(p.worstCaseCgpa <= p.confirmedCgpa + 1e-12);
  assert.ok(p.confirmedCgpa <= p.bestCaseCgpa + 1e-12);
  assert.ok(p.swing > 0);
  assert.ok(Math.abs(p.swing - (p.bestCaseCgpa - p.worstCaseCgpa)) < 1e-12);
});

test('classifications are attached to best/worst cases', () => {
  // Confirmed 3.8 over 18; 18 pending → worst 1.9 (Pass), best 3.9 (First).
  const p = pending.pendingProjection(
    {
      confirmedPoints: 3.8 * 18,
      confirmedCreditHours: 18,
      pendingCreditHours: 18,
      pendingCount: 1,
      target: null,
    },
    uccGrading,
    uccClassification
  );
  assert.equal(p.bestCaseClass?.label, 'First Class');
  assert.equal(p.worstCaseClass?.label, 'Pass');
});

// ── 6. Target feasibility under possible outcomes ──────────────────────────

test('target GUARANTEED when even the worst case still reaches it', () => {
  // Confirmed 3.9 over 34 cr; 2 pending. Worst = (132.6 + 0)/36 = 3.683 ≥ 3.6.
  const p = pending.pendingProjection(
    {
      confirmedPoints: 3.9 * 34,
      confirmedCreditHours: 34,
      pendingCreditHours: 2,
      pendingCount: 1,
      target: 3.6,
    },
    uccGrading,
    uccClassification
  );
  assert.equal(p.targetStatus, 'guaranteed');
  assert.ok(p.requiredPendingGpa !== null && p.requiredPendingGpa <= 0);
});

test('target POSSIBLE when it sits inside the possible range', () => {
  // Confirmed 3.0 over 18; 18 pending; target 3.6.
  // req = (3.6*36 − 54)/18 = (129.6 − 54)/18 = 4.2 → above ceiling? 4.2 > 4.0
  // That is unreachable. Pick a reachable target instead:
  const p = pending.pendingProjection(
    {
      confirmedPoints: 3.0 * 18,
      confirmedCreditHours: 18,
      pendingCreditHours: 18,
      pendingCount: 1,
      target: 3.3,
    },
    uccGrading,
    uccClassification
  );
  // req = (3.3*36 − 54)/18 = (118.8 − 54)/18 = 3.6 → within (0, 4].
  assert.equal(p.targetStatus, 'possible');
  assert.ok(Math.abs(p.requiredPendingGpa - 3.6) < 1e-9);
});

test('target UNREACHABLE when even the best case falls short', () => {
  // Confirmed 2.0 over 30; 6 pending; target 3.6. Best = (60 + 24)/36 = 2.33.
  const p = pending.pendingProjection(
    {
      confirmedPoints: 2.0 * 30,
      confirmedCreditHours: 30,
      pendingCreditHours: 6,
      pendingCount: 2,
      target: 3.6,
    },
    uccGrading,
    uccClassification
  );
  assert.equal(p.targetStatus, 'unreachable');
  assert.ok(p.requiredPendingGpa !== null && p.requiredPendingGpa > 4.0);
});

test('no pending credits or no target yields null feasibility', () => {
  const a = pending.pendingProjection(
    { confirmedPoints: 60, confirmedCreditHours: 20, pendingCreditHours: 0, pendingCount: 0, target: 3.6 },
    uccGrading, uccClassification
  );
  assert.equal(a.targetStatus, null);
  const b = pending.pendingProjection(
    { confirmedPoints: 60, confirmedCreditHours: 20, pendingCreditHours: 6, pendingCount: 1, target: null },
    uccGrading, uccClassification
  );
  assert.equal(b.targetStatus, null);
});
