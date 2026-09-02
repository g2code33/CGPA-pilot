// ─────────────────────────────────────────────────────────────────────────
// Tests for the DASHBOARD / PILOT BRIEF assembly (Prompt 14).
//
// The cockpit model must surface current position, destination, flight status,
// required performance, the next mission, the projected destination and a
// compact flight path — all config-driven, with a concise brief including the
// curriculum version and assumptions.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import * as dash from '../src/services/dashboardService.ts';

const grading = {
  id: 'ucc',
  name: 'UCC',
  bands: [
    { grade: 'A', points: 4.0, minScore: 80, maxScore: 100 },
    { grade: 'B+', points: 3.5, minScore: 75, maxScore: 79 },
    { grade: 'B', points: 3.0, minScore: 70, maxScore: 74 },
    { grade: 'C', points: 2.0, minScore: 60, maxScore: 64 },
    { grade: 'D', points: 1.0, minScore: 50, maxScore: 54 },
    { grade: 'E', points: 0.0, minScore: 0, maxScore: 49 },
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

const remainingSlots = [
  { levelIndex: 2, levelLabel: 'L200', semesterIndex: 1, label: 'L200 S1', credits: 18, courseCount: 5 },
  { levelIndex: 2, levelLabel: 'L200', semesterIndex: 2, label: 'L200 S2', credits: 18, courseCount: 5 },
  { levelIndex: 3, levelLabel: 'L300', semesterIndex: 1, label: 'L300 S1', credits: 18, courseCount: 5 },
];

function course(code, cr) {
  return { id: code, code, name: code, creditHours: cr, level: 2, semester: 1, programmeId: 'p', curriculumId: 'c', status: 'active', core: true };
}
const curriculum = {
  id: 'cur', versionName: 'PharmD 2026/27', programmeId: 'p',
  effectiveAcademicYear: '2026/27', effectiveDate: '2026-08-31', status: 'published',
  levels: [
    { index: 1, label: 'Level 100', semesters: [
      { index: 1, label: 'Sem 1', courses: [] },
      { index: 2, label: 'Sem 2', courses: [] },
    ] },
    { index: 2, label: 'Level 200', semesters: [
      { index: 1, label: 'Sem 1', courses: [course('PHA211', 4), course('PHA212', 3)] },
      { index: 2, label: 'Sem 2', courses: [] },
    ] },
  ],
};

function build(over = {}) {
  return dash.buildDashboard(
    {
      currentPoints: Object.prototype.hasOwnProperty.call(over, 'currentPoints') ? over.currentPoints : 3.0 * 36,
      currentCredits: Object.prototype.hasOwnProperty.call(over, 'currentCredits') ? over.currentCredits : 36,
      currentCgpa: Object.prototype.hasOwnProperty.call(over, 'currentCgpa') ? over.currentCgpa : 3.0,
      currentLevelIndex: over.level ?? 1,
      currentSemesterIndex: over.sem ?? 2,
      targetCgpa: over.target ?? 3.6,
      remainingSlots,
      remainingCredits: over.remaining ?? 54,
      curriculum: Object.prototype.hasOwnProperty.call(over, 'curriculum')
        ? over.curriculum
        : curriculum,
      curriculumPublished: over.published ?? true,
      grading,
      classification,
      institutionLabel: 'UCC · School of Pharmacy · PharmD',
    },
    grading,
    classification
  );
}

test('current position, destination and level are reported', () => {
  const m = build();
  assert.ok(Math.abs(m.currentCgpa - 3.0) < 1e-9);
  assert.equal(m.currentClassLabel, 'Second Upper');
  assert.equal(m.currentLevel, 1);
  assert.ok(Math.abs(m.targetCgpa - 3.6) < 1e-9);
  assert.equal(m.targetClassLabel, 'First Class');
});

test('flight status reflects target feasibility', () => {
  // cgpa 3.0, 54 remaining, target 3.6 → req = (3.6*90 − 108)/54 = 4.0 → extremely demanding
  const m = build();
  assert.equal(m.status, 'extremely-demanding');
  assert.ok(Math.abs(m.requiredFutureGpa - 4.0) < 1e-9);
});

test('status is impossible when the required average exceeds the ceiling', () => {
  const m = build({ currentPoints: 2.0 * 60, currentCredits: 60, currentCgpa: 2.0, remaining: 6 });
  assert.equal(m.status, 'impossible');
  assert.ok(m.requiredFutureGpa > 4.0);
});

test('next mission identifies the immediate next semester and required GPA', () => {
  const m = build();
  assert.ok(m.next);
  assert.equal(m.next.next.levelIndex, 2);
  assert.equal(m.next.next.semesterIndex, 1);
  assert.equal(m.next.next.credits, 7); // 4 + 3 configured courses
});

test('projected destination uses the planned steady average', () => {
  // Steady required average is 4.0 over 54 credits → final (108 + 216)/90 = 3.6.
  const m = build();
  assert.ok(Math.abs(m.projectedFinalCgpa - 3.6) < 1e-9);
  assert.equal(m.projectedClassLabel, 'First Class');
});

test('compact flight path includes a current point and a graduation point', () => {
  const m = build();
  const fp = m.flightPath.milestones;
  assert.equal(fp[0].kind, 'current');
  assert.ok(fp[fp.length - 1].isGraduation);
});

test('pilot brief covers the required elements', () => {
  const m = build();
  const text = m.brief.join(' ');
  assert.match(text, /Current CGPA 3\.00/);
  assert.match(text, /Target: 3\.60/);
  assert.match(text, /Flight status/);
  assert.match(text, /Required future average GPA/);
  assert.match(text, /Next mission/);
  assert.match(text, /Maximum possible final CGPA/);
  assert.match(text, /assumptions/i);
  assert.match(text, /PharmD 2026\/27/); // curriculum version
});

test('brief names the curriculum status when none is published', () => {
  const m = build({ curriculum: undefined, published: false });
  const text = m.brief.join(' ');
  assert.match(text, /none published yet/i);
});

test('hasData is false without a current CGPA and brief prompts for entry', () => {
  const m = build({ currentCgpa: null, currentPoints: 0, currentCredits: 0 });
  assert.equal(m.hasData, false);
  assert.match(m.brief[0], /enter/i);
});
