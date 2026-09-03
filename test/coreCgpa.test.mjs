// ─────────────────────────────────────────────────────────────────────────
// Automated tests for the CORE CGPA CALCULATION ENGINE.
// Run: npm test  (bundles the TS engine with esbuild, then node --test)
//
// These verify the critical mathematical guarantees:
//  • credit-WEIGHTED CGPA (semester GPAs are never simply averaged)
//  • Quality Points = GPA × Semester Credits; CGPA = ΣQP ÷ Σcredits
//  • full internal precision (no premature rounding)
//  • semester-GPA history mode (no individual grades inferred)
//  • course-level mode, pending courses, current-CGPA mode
//  • curriculum-driven completed/remaining structure
//  • maximum possible final CGPA, required future GPA, feasibility
//  • UCC classification boundaries
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/services/coreCgpaService.ts';
import * as grading from '../src/services/gradingService.ts';
import * as classification from '../src/services/classificationService.ts';
import * as structure from '../src/services/structureService.ts';

// ── Test fixtures ──────────────────────────────────────────────────────────

const uccGrading = {
  id: 'ucc',
  name: 'UCC',
  bands: [
    { grade: 'A', minScore: 80, maxScore: 100, points: 4.0, interpretation: 'Excellent' },
    { grade: 'B+', minScore: 75, maxScore: 79, points: 3.5, interpretation: 'Very Good' },
    { grade: 'B', minScore: 70, maxScore: 74, points: 3.0, interpretation: 'Good' },
    { grade: 'C+', minScore: 65, maxScore: 69, points: 2.5, interpretation: 'Average' },
    { grade: 'C', minScore: 60, maxScore: 64, points: 2.0, interpretation: 'Fair' },
    { grade: 'D+', minScore: 55, maxScore: 59, points: 1.5, interpretation: 'Barely Satisfactory' },
    { grade: 'D', minScore: 50, maxScore: 54, points: 1.0, interpretation: 'Weak Pass' },
    { grade: 'E', minScore: 0, maxScore: 49, points: 0.0, interpretation: 'Fail' },
  ],
};

const uccClassification = {
  id: 'ucc-cls',
  name: 'UCC',
  bands: [
    { id: 'first', label: 'First Class', minCgpa: 3.6, maxCgpa: 4.0, tone: 'gold' },
    { id: '2u', label: 'Second Class (Upper Division)', minCgpa: 3.0, maxCgpa: 3.59, tone: 'green' },
    { id: '2l', label: 'Second Class (Lower Division)', minCgpa: 2.5, maxCgpa: 2.99, tone: 'teal' },
    { id: '3rd', label: 'Third Class Division', minCgpa: 2.0, maxCgpa: 2.49, tone: 'blue' },
    { id: 'pass', label: 'Pass', minCgpa: 1.0, maxCgpa: 1.99, tone: 'gray' },
    { id: 'fail', label: 'Fail', minCgpa: 0, maxCgpa: 0.99, tone: 'red' },
  ],
};

function sem(over = {}) {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    label: over.label ?? 'S',
    levelIndex: over.levelIndex ?? 1,
    semesterIndex: over.semesterIndex ?? 1,
    gpa: over.gpa ?? null,
    creditHoursOverride: over.creditHoursOverride ?? null,
    courses: over.courses ?? [],
  };
}
function course(over = {}) {
  return {
    id: Math.random().toString(36).slice(2),
    code: over.code ?? '',
    name: over.name ?? '',
    creditHours: over.creditHours ?? 3,
    score: over.score ?? null,
    grade: over.grade ?? null,
    pending: over.pending ?? false,
  };
}

// ── 1. Credit-weighted CGPA ────────────────────────────────────────────────

test('semester GPAs are CREDIT-WEIGHTED, never simply averaged', () => {
  // 3.0 over a 3-credit semester and 4.0 over a 21-credit semester.
  const semesters = [
    sem({ gpa: 3.0, creditHoursOverride: 3, levelIndex: 1, semesterIndex: 1 }),
    sem({ gpa: 4.0, creditHoursOverride: 21, levelIndex: 1, semesterIndex: 2 }),
  ];
  const r = core.weightedCgpa(semesters, uccGrading);
  // Naive average = 3.5 — must NOT be used.
  assert.notEqual(+(r.cgpa.toFixed(6)), 3.5);
  // Weighted: (3.0*3 + 4.0*21) / 24 = 93/24 = 3.875
  assert.equal(r.cgpa, (3.0 * 3 + 4.0 * 21) / 24);
  assert.equal(r.cgpa, 3.875);
  assert.equal(r.totalCreditHours, 24);
  assert.equal(r.totalQualityPoints, 93);
});

test('equal credit loads make weighting equal to the GPA average', () => {
  const semesters = [
    sem({ gpa: 3.2, creditHoursOverride: 18, levelIndex: 1, semesterIndex: 1 }),
    sem({ gpa: 3.8, creditHoursOverride: 18, levelIndex: 1, semesterIndex: 2 }),
  ];
  const r = core.weightedCgpa(semesters, uccGrading);
  assert.ok(Math.abs(r.cgpa - 3.5) < 1e-12);
});

test('Quality Points = GPA × Semester Credits', () => {
  const semesters = [
    sem({ gpa: 3.5, creditHoursOverride: 15, levelIndex: 1, semesterIndex: 1 }),
    sem({ gpa: 2.5, creditHoursOverride: 20, levelIndex: 1, semesterIndex: 2 }),
  ];
  const r = core.weightedCgpa(semesters, uccGrading);
  assert.equal(r.terms[0].qualityPoints, 3.5 * 15);
  assert.equal(r.terms[1].qualityPoints, 2.5 * 20);
  // CGPA = (52.5 + 50) / 35 = 102.5/35
  assert.ok(Math.abs(r.cgpa - 102.5 / 35) < 1e-12);
});

// ── 2. Full internal precision ─────────────────────────────────────────────

test('no premature rounding: repeating decimals are kept at full precision', () => {
  // GPA 3.33 over 18 credits → 59.94 points; combined totals produce a
  // non-terminating CGPA that must not be rounded mid-calculation.
  const semesters = [
    sem({ gpa: 3.33, creditHoursOverride: 18, levelIndex: 1, semesterIndex: 1 }),
    sem({ gpa: 3.67, creditHoursOverride: 18, levelIndex: 1, semesterIndex: 2 }),
    sem({ gpa: 2.67, creditHoursOverride: 19, levelIndex: 2, semesterIndex: 1 }),
  ];
  const r = core.weightedCgpa(semesters, uccGrading);
  const qp = 3.33 * 18 + 3.67 * 18 + 2.67 * 19;
  const cr = 18 + 18 + 19;
  assert.ok(Math.abs(r.cgpa - qp / cr) < 1e-12);
  // The engine returns a high-precision value (not a pre-rounded 2-decimal).
  assert.ok((r.cgpa.toString().split('.')[1] ?? '').length >= 3);
});

test('display rounding is separate from engine precision (fmt2 only at the UI)', () => {
  const semesters = [sem({ gpa: 3.333333, creditHoursOverride: 10, levelIndex: 1, semesterIndex: 1 })];
  const r = core.weightedCgpa(semesters, uccGrading);
  // Full precision carries through (no rounding to 3.33 internally)...
  assert.ok(Math.abs(r.cgpa - 3.333333) < 1e-12);
  // ...and rounding is applied only when displayed.
  assert.equal(r.cgpa.toFixed(2), '3.33');
});

// ── 3. GPA-history mode (the Prompt 6 requirement) ─────────────────────────

test('GPA history mode weights by CONFIGURED curriculum credits when no override', () => {
  const semesters = [
    sem({ gpa: 3.0, creditHoursOverride: null, levelIndex: 1, semesterIndex: 1 }),
    sem({ gpa: 4.0, creditHoursOverride: null, levelIndex: 1, semesterIndex: 2 }),
  ];
  // Configured loads: S1 = 16 credits, S2 = 20 credits.
  const cfg = (lvl, s) => (lvl === 1 && s === 1 ? 16 : lvl === 1 && s === 2 ? 20 : 0);
  const r = core.weightedCgpa(semesters, uccGrading, cfg);
  assert.equal(r.totalCreditHours, 36);
  assert.ok(Math.abs(r.cgpa - (3.0 * 16 + 4.0 * 20) / 36) < 1e-12);
  assert.equal(r.terms[0].source, 'gpa');
});

test('a semester GPA never infers individual course grades', () => {
  const s = sem({ gpa: 3.5, creditHoursOverride: 18, courses: [] });
  const t = core.semesterTerm(s, uccGrading, 18);
  assert.equal(t.source, 'gpa');
  assert.equal(s.courses.length, 0); // no courses materialised
  assert.equal(t.gpa, 3.5);
});

test('entered courses with no GPA use course-derived weighting', () => {
  const s = sem({
    gpa: null,
    creditHoursOverride: null,
    courses: [
      course({ grade: 'A', creditHours: 3 }), // 4.0 * 3 = 12
      course({ grade: 'C', creditHours: 3 }), // 2.0 * 3 = 6
    ],
  });
  const t = core.semesterTerm(s, uccGrading, 99);
  assert.equal(t.source, 'courses');
  assert.equal(t.creditHours, 6);
  assert.equal(t.qualityPoints, 18);
  assert.ok(Math.abs(t.gpa - 3.0) < 1e-12);
});

test('course-derived GPA ignores configured credits (actual courses win)', () => {
  const s = sem({
    gpa: null,
    creditHoursOverride: null,
    courses: [course({ grade: 'A', creditHours: 2 })], // 8 points over 2
  });
  const t = core.semesterTerm(s, uccGrading, 30);
  assert.equal(t.creditHours, 2);
  assert.equal(t.gpa, 4.0);
});

test('pending courses are excluded from totals but counted as pending', () => {
  const s = sem({
    gpa: null,
    courses: [
      course({ grade: 'A', creditHours: 3 }),
      course({ grade: 'B', creditHours: 3, pending: true }),
    ],
  });
  const r = core.weightedCgpa([s], uccGrading);
  assert.equal(r.totalCreditHours, 3);
  assert.equal(r.pendingCount, 1);
  assert.equal(r.pendingCreditHours, 3);
  assert.equal(r.cgpa, 4.0);
});

test('empty/unentered semesters produce no CGPA contribution', () => {
  const r = core.weightedCgpa([sem({ gpa: null, creditHoursOverride: 18 })], uccGrading);
  assert.equal(r.cgpa, null);
  assert.equal(r.totalCreditHours, 0);
});

test('an empty semester in the middle does not dilute the weighted CGPA', () => {
  // Two graded semesters with a not-yet-entered one between them.
  const semesters = [
    sem({ gpa: 3.0, creditHoursOverride: 10, levelIndex: 1, semesterIndex: 1 }),
    sem({ gpa: null, creditHoursOverride: null, levelIndex: 1, semesterIndex: 2 }),
    sem({ gpa: 4.0, creditHoursOverride: 10, levelIndex: 2, semesterIndex: 1 }),
  ];
  const r = core.weightedCgpa(semesters, uccGrading);
  assert.equal(r.totalCreditHours, 20); // blank semester contributes 0
  assert.equal(r.cgpa, 3.5);
  assert.equal(r.terms[1].source, 'none');
});

test('course detail takes precedence over a semester GPA when both present', () => {
  const s = sem({
    gpa: 2.0, // should be ignored: actual graded courses say otherwise
    creditHoursOverride: 99,
    courses: [course({ grade: 'A', creditHours: 3 }), course({ grade: 'A', creditHours: 3 })],
  });
  const t = core.semesterTerm(s, uccGrading, 30);
  assert.equal(t.source, 'courses');
  assert.equal(t.creditHours, 6);
  assert.equal(t.gpa, 4.0);
});

test('GPA-history credits precedence: override beats configured curriculum load', () => {
  const s = sem({ gpa: 3.0, creditHoursOverride: 12, levelIndex: 1, semesterIndex: 1 });
  const t = core.semesterTerm(s, uccGrading, 20);
  assert.equal(t.creditHours, 12);
  assert.equal(t.qualityPoints, 36);
});

test('a score on a course derives its grade through the active system', () => {
  const s = sem({
    gpa: null,
    courses: [course({ grade: null, score: 75, creditHours: 4 })], // B+ → 3.5
  });
  const t = core.semesterTerm(s, uccGrading, 99);
  assert.equal(t.source, 'courses');
  assert.equal(t.qualityPoints, 3.5 * 4);
  assert.equal(t.gpa, 3.5);
});

// ── 4. Current-CGPA mode ───────────────────────────────────────────────────

test('current mode converts baseline CGPA to quality points with curriculum credits', () => {
  const baseline = { levelIndex: 2, semesterIndex: 1, cgpa: 3.4, creditHours: 0 };
  // Completed through L200 S1 = 16+20+16 = 52 credits.
  const rec = core.currentModeRecord(baseline, 52);
  assert.equal(rec.creditHours, 52);
  assert.ok(Math.abs(rec.qualityPoints - 3.4 * 52) < 1e-12);
  assert.equal(rec.cgpa, 3.4);
  assert.equal(rec.fromCurriculum, true);
});

test('current mode falls back to manually entered credits when curriculum has none', () => {
  const baseline = { levelIndex: 2, semesterIndex: 1, cgpa: 3.4, creditHours: 64 };
  const rec = core.currentModeRecord(baseline, null);
  assert.equal(rec.creditHours, 64);
  assert.equal(rec.fromCurriculum, false);
});

// ── 5. Curriculum structure ────────────────────────────────────────────────

function curriculumWithCredits() {
  // 6 levels × 2 semesters; even semesters carry 20 credits, odd 16.
  const levels = [];
  for (let l = 1; l <= 6; l++) {
    const semesters = [];
    for (const s of [1, 2]) {
      const credits = s === 1 ? 16 : 20;
      semesters.push({
        index: s,
        label: `Semester ${s}`,
        courses: [
          {
            id: `${l}-${s}`,
            code: `P${l}${s}`,
            name: 'Course',
            creditHours: credits,
            level: l,
            semester: s,
            programmeId: 'p',
            curriculumId: 'c',
            status: 'active',
            core: true,
          },
        ],
      });
    }
    levels.push({ index: l, label: `Level ${l * 100}`, semesters });
  }
  return {
    id: 'c',
    versionName: 'test',
    programmeId: 'p',
    effectiveAcademicYear: '2026/27',
    effectiveDate: '2026-08-31',
    status: 'published',
    levels,
  };
}

test('structureService splits completed vs remaining through a level/semester', () => {
  const c = curriculumWithCredits();
  const progress = structure.progressThrough(c, 2, 1);
  // Completed: L100 S1 (16) + L100 S2 (20) + L200 S1 (16) = 52
  assert.equal(progress.completedCredits, 52);
  assert.equal(progress.completedSlots.length, 3);
  // Remaining: L200 S2 through L600 S2 = 9 slots × mix of 16/20
  assert.equal(progress.remainingSlots.length, 9);
  assert.equal(progress.totalCredits, (16 + 20) * 6); // 216
  assert.equal(progress.remainingCredits, 216 - 52);
  assert.equal(progress.hasCreditData, true);
});

test('structureService reports no credit data for an unpublished/empty curriculum', () => {
  const progress = structure.progressThrough(undefined, 1, 1);
  assert.equal(progress.hasCreditData, false);
  assert.equal(progress.completedCredits, 0);
});

test('previousSlot returns the semester immediately before in programme order', () => {
  const c = curriculumWithCredits();
  // Slots: L100S1(16), L100S2(20), L200S1(16), L200S2(20), ...
  const beforeL200S1 = structure.previousSlot(c, 2, 1);
  assert.equal(beforeL200S1?.levelIndex, 1);
  assert.equal(beforeL200S1?.semesterIndex, 2);
  assert.equal(beforeL200S1?.credits, 20);

  const beforeL100S2 = structure.previousSlot(c, 1, 2);
  assert.equal(beforeL100S2?.levelIndex, 1);
  assert.equal(beforeL100S2?.semesterIndex, 1);
});

test('previousSlot returns null for the very first semester', () => {
  const c = curriculumWithCredits();
  assert.equal(structure.previousSlot(c, 1, 1), null);
  assert.equal(structure.previousSlot(undefined, 1, 1), null);
});

test('mid-semester remaining credits INCLUDE the current semester (tallies to target)', () => {
  // A student who has 'just started' L200 S1 (the current semester, 16 cr).
  // Their CONFIRMED position is the immediately previous semester, L100 S2:
  // confirmed = L100S1(16)+L100S2(20) = 36 credits. What remains must therefore
  // be programme total (216) − 36 = 180, which INCLUDES the current L200 S1
  // (16) they are about to finish — the current semester is never dropped.
  const c = curriculumWithCredits();
  const prev = structure.previousSlot(c, 2, 1); // confirmed position for L200 S1
  assert.equal(prev?.levelIndex, 1);
  assert.equal(prev?.semesterIndex, 2);
  const confirmed = structure.progressThrough(c, prev.levelIndex, prev.semesterIndex);
  assert.equal(confirmed.completedCredits, 36);
  assert.equal(confirmed.remainingCredits, 216 - 36); // 180 — includes current L200 S1
  // The current semester the student must finish is the slot right AFTER the
  // confirmed position (= the baseline L200 S1), and it is part of what remains.
  const currentL200S1 = confirmed.remainingSlots[0];
  assert.equal(currentL200S1?.levelIndex, 2);
  assert.equal(currentL200S1?.semesterIndex, 1);
  assert.equal(currentL200S1?.credits, 16);
});

test('inactive courses do not count toward configured semester credits', () => {
  const c = {
    ...curriculumWithCredits(),
    levels: [
      {
        index: 1,
        label: 'Level 100',
        semesters: [
          {
            index: 1,
            label: 'Semester 1',
            courses: [
              { id: 'a', code: 'A', name: 'a', creditHours: 10, level: 1, semester: 1, programmeId: 'p', curriculumId: 'c', status: 'active', core: true },
              { id: 'b', code: 'B', name: 'b', creditHours: 6, level: 1, semester: 1, programmeId: 'p', curriculumId: 'c', status: 'inactive', core: true },
            ],
          },
          { index: 2, label: 'Semester 2', courses: [] },
        ],
      },
    ],
  };
  const slots = structure.curriculumSemesters(c);
  assert.equal(slots[0].credits, 10); // inactive 6-credit course excluded
});

// ── 6. Maximum possible CGPA & required future performance ─────────────────

test('maximum final CGPA assumes the TOP grade for all remaining credits', () => {
  // 3.0 over 24 completed credits; 24 remaining, top grade 4.0.
  const max = core.maximumFinalCgpa(3.0 * 24, 24, 24, uccGrading);
  assert.ok(Math.abs(max - (72 + 96) / 48) < 1e-12); // 3.5
  assert.ok(Math.abs(max - 3.5) < 1e-12);
});

test('maximum final CGPA respects the configured grade ceiling', () => {
  const fiveScale = {
    id: '5',
    name: '5-point',
    bands: [
      { grade: 'A+', minScore: 80, maxScore: 100, points: 5.0 },
      { grade: 'E', minScore: 0, maxScore: 49, points: 0 },
    ],
  };
  const max = core.maximumFinalCgpa(4.0 * 10, 10, 10, fiveScale);
  assert.equal(max, (40 + 50) / 20); // 4.5
});

test('required future GPA solves the credit-weighted target equation', () => {
  // Current 3.0 over 24; target 3.6 with 24 remaining:
  // req = (3.6*48 - 72)/24 = (172.8-72)/24 = 4.2
  const req = core.requiredFutureGpaPrecise(3.0 * 24, 24, 24, 3.6);
  assert.ok(Math.abs(req - 4.2) < 1e-9);
  assert.equal(core.targetFeasible(req, uccGrading), false); // above 4.0 ceiling
});

test('feasible target reports reachable and satisfies the equation', () => {
  // Current 3.0 over 24; target 3.2 with 24 remaining:
  // req = (3.2*48 - 72)/24 = 81.6/24 = 3.4
  const req = core.requiredFutureGpaPrecise(3.0 * 24, 24, 24, 3.2);
  assert.ok(Math.abs(req - 3.4) < 1e-9);
  assert.equal(core.targetFeasible(req, uccGrading), true);
  // If the student earns exactly req, final CGPA == target.
  const finalCgpa = (3.0 * 24 + req * 24) / 48;
  assert.ok(Math.abs(finalCgpa - 3.2) < 1e-9);
});

test('required future GPA follows the target equation at full precision', () => {
  // Current 3.9 over 24; target 3.6 with 24 remaining → (172.8−93.6)/24 = 3.3.
  const req = core.requiredFutureGpaPrecise(3.9 * 24, 24, 24, 3.6);
  assert.ok(Math.abs(req - 3.3) < 1e-9);
});

test('required GPA goes negative when the target is already mathematically exceeded', () => {
  // 46 completed credits at 4.0 (184 QP); 2 remaining; target 3.6 over 48
  // needs 172.8 QP — already beaten, so req = (172.8−184)/2 = −5.6.
  const req = core.requiredFutureGpaPrecise(4.0 * 46, 46, 2, 3.6);
  assert.ok(req < 0);
  // Target feasibility helper treats a negative requirement as reachable.
  assert.equal(core.targetFeasible(req, uccGrading), true);
});

// ── 7. End-to-end snapshot across both modes ───────────────────────────────

test('computeSnapshot: history mode matches weightedCgpa', () => {
  const state = {
    mode: 'history',
    semesters: [
      sem({ gpa: 3.2, creditHoursOverride: 18, levelIndex: 1, semesterIndex: 1 }),
      sem({ gpa: 3.6, creditHoursOverride: 18, levelIndex: 1, semesterIndex: 2 }),
    ],
    baseline: { levelIndex: 1, semesterIndex: 1, cgpa: null, creditHours: 0 },
    targetCgpa: 3.6,
    plannedNextCreditHours: 18,
  };
  const snap = core.computeSnapshot(state, uccGrading, {});
  assert.equal(snap.mode, 'history');
  assert.ok(Math.abs(snap.cgpa - 3.4) < 1e-12);
  assert.equal(snap.creditHours, 36);
});

test('computeSnapshot: current mode uses curriculum-completed credits', () => {
  const state = {
    mode: 'current',
    semesters: [],
    baseline: { levelIndex: 1, semesterIndex: 2, cgpa: 3.5, creditHours: 999 },
    targetCgpa: 3.6,
    plannedNextCreditHours: 18,
  };
  // Completed through L100 S2 = 36 credits (curriculum), ignoring manual 999.
  const snap = core.computeSnapshot(state, uccGrading, { curriculumCompletedCredits: 36 });
  assert.equal(snap.creditHours, 36);
  assert.equal(snap.cgpa, 3.5);
});

// ── 8. Grading & classification boundaries ─────────────────────────────────

test('grade points derive from the active grading system', () => {
  assert.equal(grading.pointsForGrade('A', uccGrading), 4.0);
  assert.equal(grading.pointsForGrade('B+', uccGrading), 3.5);
  assert.equal(grading.pointsForGrade('E', uccGrading), 0.0);
  assert.equal(grading.maxGradePoints(uccGrading), 4.0);
});

test('score → grade uses UCC boundaries', () => {
  assert.equal(grading.gradeFromScore(80, uccGrading), 'A');
  assert.equal(grading.gradeFromScore(75, uccGrading), 'B+');
  assert.equal(grading.gradeFromScore(70, uccGrading), 'B');
  assert.equal(grading.gradeFromScore(49, uccGrading), 'E');
  assert.equal(grading.gradeFromScore(50, uccGrading), 'D');
});

test('UCC degree classification boundaries are exact', () => {
  const cases = [
    [4.0, 'First Class'],
    [3.6, 'First Class'],
    [3.59, 'Second Class (Upper Division)'],
    [3.0, 'Second Class (Upper Division)'],
    [2.99, 'Second Class (Lower Division)'],
    [2.5, 'Second Class (Lower Division)'],
    [2.49, 'Third Class Division'],
    [2.0, 'Third Class Division'],
    [1.99, 'Pass'],
    [1.0, 'Pass'],
    [0.99, 'Fail'],
  ];
  for (const [cgpa, label] of cases) {
    assert.equal(classification.classifyCgpa(cgpa, uccClassification)?.label, label, `CGPA ${cgpa}`);
  }
});
