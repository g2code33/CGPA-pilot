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

// ── GPA-History JOURNEY in the AI context ─────────────────────────────────

test('history mode: the Level 100→now journey is passed to the model (complete)', () => {
  const s = quickState({
    inputMode: 'history',
    mode: 'history',
    semesters: [
      { id: 's1', label: 'L100', levelIndex: 1, semesterIndex: 1, gpa: 2.9, creditHoursOverride: 24, courses: [], pending: false },
      { id: 's2', label: 'L200', levelIndex: 2, semesterIndex: 1, gpa: 3.42, creditHoursOverride: 24, courses: [], pending: false },
      { id: 's3', label: 'L300', levelIndex: 3, semesterIndex: 1, gpa: 3.6, creditHoursOverride: 24, courses: [], pending: false },
    ],
  });
  const journey = {
    levels: [
      { levelIndex: 1, label: 'Level 100', cgpa: 2.9, credits: 24, cumulativeCgpa: 2.9, classification: null, status: 'complete' },
      { levelIndex: 2, label: 'Level 200', cgpa: 3.42, credits: 24, cumulativeCgpa: 3.16, classification: null, status: 'complete' },
      { levelIndex: 3, label: 'Level 300', cgpa: 3.6, credits: 24, cumulativeCgpa: 3.3067, classification: null, status: 'complete' },
    ],
    currentLevelIndex: 3,
    complete: true,
    missingRequired: [],
    hasAny: true,
    enteredCredits: 72,
    firstCgpa: 2.9,
    finalCgpa: 3.3067,
    trend: 'up',
  };
  const ctx = buildAiContext(s, { creditHours: 72, points: 238, cgpa: 3.3067, pendingCreditHours: 0 }, null, { university: 'TU' }, journey);
  assert.equal(ctx.journey.length, 3);
  assert.equal(ctx.journey[0].level, 1);
  assert.equal(ctx.journey[2].status, 'complete');
  const block = formatAiContext(ctx);
  assert.match(block, /LEVEL JOURNEY/);
  assert.match(block, /Level 100: cumulative CGPA 2\.90/);
  assert.match(block, /✓ The CGPA history is complete/);
});

test('history mode: INCOMPLETE journey → the model is told not to confirm a CGPA', () => {
  const s = quickState({
    inputMode: 'history',
    mode: 'history',
    semesters: [
      { id: 's1', label: 'L100', levelIndex: 1, semesterIndex: 1, gpa: 2.9, creditHoursOverride: 24, courses: [], pending: false },
    ],
    baseline: { levelIndex: 3, semesterIndex: 1, cgpa: null, creditHours: 0, pendingCreditHours: 0, standing: 'released' },
  });
  const journey = {
    levels: [
      { levelIndex: 1, label: 'Level 100', cgpa: 2.9, credits: 24, cumulativeCgpa: 2.9, classification: null, status: 'complete' },
      { levelIndex: 2, label: 'Level 200', cgpa: null, credits: 24, cumulativeCgpa: null, classification: null, status: 'missing' },
      { levelIndex: 3, label: 'Level 300', cgpa: null, credits: 24, cumulativeCgpa: null, classification: null, status: 'missing' },
    ],
    currentLevelIndex: 3,
    complete: false,
    missingRequired: [2, 3],
    hasAny: true,
    enteredCredits: 24,
    firstCgpa: 2.9,
    finalCgpa: null,
    trend: null,
  };
  const ctx = buildAiContext(s, { creditHours: 24, points: 69.6, cgpa: 2.9, pendingCreditHours: 0 }, null, { university: 'TU' }, journey);
  const block = formatAiContext(ctx);
  assert.match(block, /LEVEL JOURNEY/);
  assert.match(block, /Level 200: cumulative CGPA — · NOT ENTERED YET/);
  assert.match(block, /⚠ The CGPA history is INCOMPLETE — Level 200, Level 300 are not entered/);
  assert.match(block, /Do NOT compute, confirm or quote a final CGPA/);
});

test('current mode never carries a journey block', () => {
  const s = quickState({ baseline: { levelIndex: 2, semesterIndex: 1, cgpa: 3.4, creditHours: 48, pendingCreditHours: 0 } });
  const ctx = buildAiContext(s, { creditHours: 48, points: 163.2, cgpa: 3.4, pendingCreditHours: 0 }, 'Second Class Upper', { university: 'TU' });
  assert.equal(ctx.journey, undefined);
  assert.doesNotMatch(formatAiContext(ctx), /LEVEL JOURNEY/);
});
