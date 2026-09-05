// ─────────────────────────────────────────────────────────────────────────
// aiContext — the context block the AI receives from the student's tools:
//   • empty tools → hasAnyData=false (so the UI can guide to fill tools)
//   • quick mode with a CGPA → confirmed CGPA + level in context
//   • history mode → each semester's GPA + credits + pending courses
//   • target / planned credits included when set
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAiContext, hasAnyStudentData } from '../src/services/aiContext.ts';
import { formatAiContext } from '../worker/src/ai.ts';

function quickState(over = {}) {
  return {
    inputMode: 'quick',
    mode: 'current',
    semesters: [],
    baseline: {
      levelIndex: 2,
      semesterIndex: 1,
      cgpa: null,
      creditHours: 0,
      pendingCreditHours: 0,
      standing: 'released',
      ...over.baseline,
    },
    targetCgpa: null,
    plannedNextCreditHours: 0,
    ...over,
  };
}

test('completely empty tools → hasAnyData false, context says so', () => {
  const s = quickState();
  assert.equal(hasAnyStudentData(s), false);
  const ctx = buildAiContext(s, { creditHours: 0, points: 0, cgpa: null, pendingCreditHours: 0 }, null, {
    university: 'TU',
    school: 'School of Test',
  });
  assert.equal(ctx.hasAnyData, false);
  const block = formatAiContext(ctx);
  assert.match(block, /empty/i);
});

test('quick mode with CGPA → confirmed CGPA, level, target in context', () => {
  const s = quickState({
    baseline: { levelIndex: 2, semesterIndex: 1, cgpa: 3.42, creditHours: 80, pendingCreditHours: 0 },
    targetCgpa: 3.6,
    plannedNextCreditHours: 30,
  });
  assert.equal(hasAnyStudentData(s), true);
  const ctx = buildAiContext(s, { creditHours: 80, points: 273.6, cgpa: 3.42, pendingCreditHours: 0 }, 'Second Class Upper', {
    university: 'TU',
    school: 'School of Test',
    programme: 'Test Programme',
  });
  const block = formatAiContext(ctx);
  assert.match(block, /CONFIRMED CGPA: 3\.42/);
  assert.match(block, /over 80 graded credits/);
  assert.match(block, /Second Class Upper/);
  assert.match(block, /LEVEL 2 \(Level 200\)/);
  assert.match(block, /TARGET CGPA: 3\.60/);
  assert.match(block, /PLANNED NEXT-SEMESTER CREDITS: 30/);
  assert.match(block, /TU › School of Test › Test Programme/);
});

test('history mode → semesters with GPAs, credits and pending courses', () => {
  const s = {
    inputMode: 'history',
    mode: 'history',
    semesters: [
      {
        id: 's1',
        label: 'Level 100 · Sem 1',
        levelIndex: 1,
        semesterIndex: 1,
        gpa: 3.6,
        creditHoursOverride: 30,
        courses: [
          { id: 'c1', code: 'TST11', name: 'Course 1', creditHours: 3, score: 90, grade: 'A', pending: false },
          { id: 'c2', code: 'TST12', name: 'Course 2', creditHours: 3, score: null, grade: null, pending: true },
        ],
        pending: false,
      },
      {
        id: 's2',
        label: 'Level 100 · Sem 2',
        levelIndex: 1,
        semesterIndex: 2,
        gpa: null,
        creditHoursOverride: 32,
        courses: [],
        pending: true,
      },
    ],
    baseline: { levelIndex: 1, semesterIndex: 2, cgpa: null, creditHours: 0, pendingCreditHours: 32 },
    targetCgpa: 3.5,
    plannedNextCreditHours: 0,
  };
  const ctx = buildAiContext(s, { creditHours: 30, points: 108, cgpa: 3.6, pendingCreditHours: 32 }, null, { university: 'TU' });
  assert.equal(hasAnyStudentData(s), true);
  assert.equal(ctx.semesters.length, 2);
  const block = formatAiContext(ctx);
  assert.match(block, /GPA 3\.60/);
  assert.match(block, /30 credits/);
  assert.match(block, /results not released yet/);
  // Rich context: per-semester course TABLE (Markdown) the model can quote —
  // graded AND pending courses (not just the unreleased ones).
  assert.match(block, /\| Course \| Credits \| Grade \| Status \|/);
  assert.match(block, /\| TST11 \| 3 \| A \| graded \|/);
  assert.match(block, /\| TST12 \| 3 \| — \| pending \|/);
  assert.match(block, /Markdown tables are rendered for the student/);
  assert.match(block, /PENDING CREDITS \(awaiting release\): 32/);
});

test('history mode counts entered COURSES as data (even without a GPA yet)', () => {
  const s = quickState({
    mode: 'history',
    semesters: [
      {
        id: 's1',
        label: 'L',
        levelIndex: 1,
        semesterIndex: 1,
        gpa: null,
        creditHoursOverride: null,
        courses: [{ id: 'c1', code: 'TST11', name: 'C', creditHours: 3, score: 85, grade: 'A', pending: false }],
        pending: false,
      },
    ],
  });
  assert.equal(hasAnyStudentData(s), true);
});
