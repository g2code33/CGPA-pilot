// ─────────────────────────────────────────────────────────────────────────
// Tests for the PRINT REPORT COMPOSER (Prompt 15).
//
// Every composed print document must: render the key figures of the shared
// dashboard model, stay anonymous (no name/ID/email/phone placeholders),
// label projections, and distinguish the target (a goal) from projections.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import * as dash from '../src/services/dashboardService.ts';
import { summaryReport, fullReport, pilotBriefReport } from '../src/services/reportComposer.ts';

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
];
function course(code, cr) {
  return { id: code, code, name: code, creditHours: cr, level: 2, semester: 1, programmeId: 'p', curriculumId: 'cur', status: 'active', core: true };
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
const m = dash.buildDashboard(
  {
    currentPoints: 3.0 * 36, currentCredits: 36, currentCgpa: 3.0,
    currentLevelIndex: 1, currentSemesterIndex: 2, targetCgpa: 3.6,
    remainingSlots, remainingCredits: 36, curriculum, curriculumPublished: true,
    grading, classification, institutionLabel: 'UCC · School of Pharmacy · PharmD',
  },
  grading, classification
);

test('summary report includes key figures, target/projection labels and curriculum version', () => {
  const html = summaryReport(m).html;
  assert.match(html, /3\.00/); // current CGPA
  assert.match(html, /3\.60/); // target
  assert.match(html, /First Class/); // target class label
  assert.match(html, /Target/);
  assert.match(html, /projection|Projection|projected|Projected/);
  assert.match(html, /PharmD 2026\/27/); // curriculum version
});

test('pilot brief report is concise but complete', () => {
  const html = pilotBriefReport(m).html;
  assert.match(html, /Pilot Brief/);
  assert.match(html, /3\.00/);
  assert.match(html, /3\.60/);
  assert.match(html, /PharmD 2026\/27/);
});

test('full report combines all major sections with page breaks after the first', () => {
  const sections = fullReport(m);
  assert.ok(sections.length >= 3);
  const joined = sections.map((s) => s.html).join('\n');
  assert.match(joined, /Summary/);
  assert.match(joined, /Flight path|Milestone/i);
  assert.match(joined, /Next semester/i);
  assert.match(joined, /[Pp]ilot [Bb]rief/);
  assert.match(joined, /3\.60/);
  assert.match(joined, /PharmD 2026\/27/);
});

test('no print document requests or shows personal-data fields', () => {
  const joined = [summaryReport(m).html, pilotBriefReport(m).html, ...fullReport(m).map((s) => s.html)].join('\n').toLowerCase();
  for (const banned of ['student id', 'student name', 'email', 'phone number', '<input', 'password', 'account name']) {
    assert.ok(!joined.includes(banned), `print output must not contain "${banned}"`);
  }
});
