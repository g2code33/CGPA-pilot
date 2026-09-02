// ─────────────────────────────────────────────────────────────────────────
// Tests for sessionGuard (Prompt 16 — strict privacy, reset & refresh).
//
// hasEnteredAcademicData must detect ANY student-entered academic
// information (baseline CGPA/credits/pending, progressed level, semester
// GPAs, course scores/grades/pending/identifiers) so the refresh warning and
// clear flow protect real data, while a pristine session (and config-only
// choices like target CGPA or planned credits) counts as clean.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { hasEnteredAcademicData } from '../src/services/sessionGuard.ts';

function pristine(over = {}) {
  return {
    inputMode: 'quick',
    mode: 'current',
    semesters: [],
    baseline: {
      levelIndex: 1,
      semesterIndex: 1,
      cgpa: null,
      creditHours: 0,
      pendingCreditHours: 0,
    },
    targetCgpa: 3.6,
    plannedNextCreditHours: 18,
    ...over,
  };
}

test('pristine session is not dirty', () => {
  assert.equal(hasEnteredAcademicData(pristine()), false);
});

test('config-only choices do not count as academic data', () => {
  assert.equal(hasEnteredAcademicData(pristine({ targetCgpa: 3.0 })), false);
  assert.equal(hasEnteredAcademicData(pristine({ plannedNextCreditHours: 21 })), false);
  assert.equal(hasEnteredAcademicData(pristine({ inputMode: 'planning' })), false);
});

test('entered baseline CGPA makes the session dirty', () => {
  assert.equal(hasEnteredAcademicData(pristine({ baseline: { ...pristine().baseline, cgpa: 3.2 } })), true);
});

test('entered completed credits make the session dirty', () => {
  assert.equal(hasEnteredAcademicData(pristine({ baseline: { ...pristine().baseline, creditHours: 18 } })), true);
});

test('pending credit hours make the session dirty', () => {
  assert.equal(hasEnteredAcademicData(pristine({ baseline: { ...pristine().baseline, pendingCreditHours: 18 } })), true);
});

test('progressed level / semester makes the session dirty', () => {
  assert.equal(hasEnteredAcademicData(pristine({ baseline: { ...pristine().baseline, levelIndex: 2 } })), true);
  assert.equal(hasEnteredAcademicData(pristine({ baseline: { ...pristine().baseline, semesterIndex: 2 } })), true);
});

test('history mode with an empty semester entry is still clean', () => {
  const s = pristine({
    mode: 'history',
    semesters: [
      { id: 's1', label: 'L100 S1', levelIndex: 1, semesterIndex: 1, gpa: null, creditHoursOverride: null, courses: [], pending: false },
    ],
  });
  assert.equal(hasEnteredAcademicData(s), false);
});

test('entered semester GPA makes history mode dirty', () => {
  const s = pristine({
    mode: 'history',
    semesters: [
      { id: 's1', label: 'L100 S1', levelIndex: 1, semesterIndex: 1, gpa: 3.4, creditHoursOverride: null, courses: [], pending: false },
    ],
  });
  assert.equal(hasEnteredAcademicData(s), true);
});

test('pending semester, credit override, and course entries are detected', () => {
  const base = pristine({
    mode: 'history',
    semesters: [
      { id: 's1', label: 'L100 S1', levelIndex: 1, semesterIndex: 1, gpa: null, creditHoursOverride: null, courses: [], pending: true },
    ],
  });
  assert.equal(hasEnteredAcademicData(base), true);

  const override = pristine({
    mode: 'history',
    semesters: [
      { id: 's1', label: 'L100 S1', levelIndex: 1, semesterIndex: 1, gpa: null, creditHoursOverride: 15, courses: [], pending: false },
    ],
  });
  assert.equal(hasEnteredAcademicData(override), true);

  const course = pristine({
    mode: 'history',
    semesters: [
      {
        id: 's1', label: 'L100 S1', levelIndex: 1, semesterIndex: 1, gpa: null, creditHoursOverride: null, pending: false,
        courses: [
          { id: 'c1', code: '', name: '', creditHours: 3, score: 72, grade: null, pending: false },
        ],
      },
    ],
  });
  assert.equal(hasEnteredAcademicData(course), true);

  const courseGrade = pristine({
    mode: 'history',
    semesters: [
      {
        id: 's1', label: 'L100 S1', levelIndex: 1, semesterIndex: 1, gpa: null, creditHoursOverride: null, pending: false,
        courses: [
          { id: 'c1', code: 'PHA101', name: '', creditHours: 3, score: null, grade: null, pending: true },
        ],
      },
    ],
  });
  assert.equal(hasEnteredAcademicData(courseGrade), true);
});
