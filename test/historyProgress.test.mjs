// ─────────────────────────────────────────────────────────────────────────
// Automated tests for the GPA-HISTORY JOURNEY (progress from scratch).
// Run: npm test
//
// Guarantees under test:
//   • the journey tracks EVERY level from Level 100 to the current one,
//     where each typed value IS the CUMULATIVE CGPA up to that level (the
//     band is that typed value — there is no separate "running" column)
//   • COMPLETENESS: selecting e.g. Level 300 while Level 200 (or 100) is
//     missing → complete=false, missingRequired names the levels, and NO
//     headline CGPA is produced from partial data ("go back and complete")
//   • the current level's own CGPA is only required when its results are
//     RELEASED (a fresh Level 300 student is complete up to Level 200)
//   • final CGPA = the MOST RECENT cumulative CGPA typed (never re-averaged)
//   • trend: rising / falling / steady
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { historyJourney, levelCgpaFor } from '../src/services/historyProgress.ts';

/** Minimal semester entry (level CGPA row). */
const entry = (levelIndex, gpa, extra = {}) => ({
  id: `lv${levelIndex}`,
  label: `Level ${levelIndex * 100}`,
  levelIndex,
  semesterIndex: 1,
  gpa,
  pending: false,
  courses: [],
  ...extra,
});

/** Level → total credits (both semesters). */
const creditsOf = (map) => (lv) => map[lv] ?? 0;

test('complete journey: Level 100→300 all entered (released) → full numbers, rising trend', () => {
  const j = historyJourney({
    semesters: [entry(1, 2.9), entry(2, 3.42), entry(3, 3.6)],
    currentLevelIndex: 3,
    standing: 'released',
    levelCreditsFor: creditsOf({ 1: 24, 2: 24, 3: 24 }),
  });
  assert.equal(j.complete, true);
  assert.deepEqual(j.missingRequired, []);
  assert.equal(j.hasAny, true);
  assert.equal(j.firstCgpa, 2.9);
  // Headline = the most recent cumulative CGPA typed (3.60), not an average.
  assert.equal(j.finalCgpa, 3.6);
  assert.equal(j.trend, 'up');
  assert.equal(j.enteredCredits, 72);
  assert.equal(j.levels.length, 3);
  assert.deepEqual(j.levels.map((l) => l.status), ['complete', 'complete', 'complete']);
  // Each row keeps the cumulative CGPA as typed (no running column).
  assert.equal(j.levels[1].cgpa, 3.42);
  assert.equal(j.levels[2].cgpa, 3.6);
});

test('the reported bug: in Level 300 with ONLY Level 100 entered → must NOT compute', () => {
  const j = historyJourney({
    semesters: [entry(1, 2.9)],
    currentLevelIndex: 3,
    standing: 'released',
    levelCreditsFor: creditsOf({ 1: 24, 2: 24, 3: 24 }),
  });
  assert.equal(j.complete, false);
  assert.deepEqual(j.missingRequired, [2, 3]);
  assert.equal(j.hasAny, true);
  // No headline CGPA from partial data.
  assert.equal(j.finalCgpa, null);
  assert.equal(j.levels.find((l) => l.levelIndex === 2).status, 'missing');
  assert.equal(j.levels.find((l) => l.levelIndex === 3).status, 'missing');
});

test('middle gap (200 missing) blocks the headline even when later levels are entered', () => {
  const j = historyJourney({
    semesters: [entry(1, 3.0), entry(3, 3.4)],
    currentLevelIndex: 4,
    standing: 'released',
    levelCreditsFor: creditsOf({ 1: 24, 2: 24, 3: 24, 4: 24 }),
  });
  assert.equal(j.complete, false);
  assert.deepEqual(j.missingRequired, [2, 4]);
  assert.equal(j.finalCgpa, null);
  // The typed value for Level 300 is preserved, but no headline is shown.
  assert.equal(j.levels.find((l) => l.levelIndex === 3).cgpa, 3.4);
});

test('current level NOT released → not required; journey complete up to the last finished level', () => {
  const j = historyJourney({
    semesters: [entry(1, 2.9), entry(2, 3.42)],
    currentLevelIndex: 3,
    standing: 'notReleased',
    levelCreditsFor: creditsOf({ 1: 24, 2: 24, 3: 24 }),
  });
  assert.equal(j.complete, true);
  assert.deepEqual(j.missingRequired, []);
  assert.equal(j.levels.find((l) => l.levelIndex === 3).status, 'current');
  // Headline = the most recent cumulative CGPA typed (Level 200 = 3.42).
  assert.equal(j.finalCgpa, 3.42);
});

test('just started (Level 100, nothing entered) → complete, but no CGPA yet', () => {
  const j = historyJourney({
    semesters: [],
    currentLevelIndex: 1,
    standing: 'justStarted',
    levelCreditsFor: creditsOf({ 1: 24 }),
  });
  assert.equal(j.complete, true);
  assert.equal(j.hasAny, false);
  assert.equal(j.finalCgpa, null);
  assert.equal(j.trend, null);
  assert.equal(j.levels[0].status, 'current');
});

test('final CGPA = the most recent cumulative CGPA typed (never a re-weighted average)', () => {
  const j = historyJourney({
    semesters: [entry(1, 3.0), entry(2, 3.6)],
    currentLevelIndex: 2,
    standing: 'released',
    levelCreditsFor: creditsOf({ 1: 24, 2: 48 }),
  });
  // The Level 200 box holds the cumulative CGPA (3.60) — use it as typed,
  // NOT a credit-weighted average (which would come out near 3.40).
  assert.equal(j.finalCgpa, 3.6);
  assert.equal(j.levels[1].cgpa, 3.6);
});

test('trend: falling and steady are detected', () => {
  const down = historyJourney({
    semesters: [entry(1, 3.6), entry(2, 2.8)],
    currentLevelIndex: 2,
    standing: 'released',
    levelCreditsFor: creditsOf({ 1: 24, 2: 24 }),
  });
  assert.equal(down.trend, 'down');
  const flat = historyJourney({
    semesters: [entry(1, 3.0), entry(2, 3.001)],
    currentLevelIndex: 2,
    standing: 'released',
    levelCreditsFor: creditsOf({ 1: 24, 2: 24 }),
  });
  assert.equal(flat.trend, 'flat');
});

test('classification bands follow the TYPED cumulative CGPA (no re-averaging)', () => {
  // Level 200 typed = 3.70 → First Class (the band is the typed value).
  const j = historyJourney({
    semesters: [entry(1, 2.9), entry(2, 3.7)],
    currentLevelIndex: 2,
    standing: 'released',
    levelCreditsFor: creditsOf({ 1: 24, 2: 24 }),
    classify: (g) => (g >= 3.6 ? 'First Class' : g >= 3.0 ? 'Second Class Upper' : 'Second Class Lower'),
  });
  assert.equal(j.levels[0].classification, 'Second Class Lower'); // typed 2.90
  assert.equal(j.levels[1].classification, 'First Class'); // typed 3.70
});

test('pending (not-released) entries do not count as an entered level CGPA', () => {
  const j = historyJourney({
    semesters: [entry(1, null, { pending: true }), entry(2, 3.2)],
    currentLevelIndex: 2,
    standing: 'released',
    levelCreditsFor: creditsOf({ 1: 24, 2: 24 }),
  });
  assert.equal(j.levels[0].cgpa, null);
  assert.deepEqual(j.missingRequired, [1]);
});

test('levelCgpaFor ignores pending rows and invalid values', () => {
  assert.equal(levelCgpaFor([entry(1, 2.9)], 1), 2.9);
  assert.equal(levelCgpaFor([entry(1, 2.9, { pending: true })], 1), null);
  assert.equal(levelCgpaFor([entry(1, null)], 1), null);
  assert.equal(levelCgpaFor([], 1), null);
});
