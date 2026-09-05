// ─────────────────────────────────────────────────────────────────────────
// Automated tests for the GPA-HISTORY JOURNEY (progress from scratch).
// Run: npm test
//
// Guarantees under test:
//   • the journey tracks EVERY level from Level 100 to the current one,
//     with per-level CGPA, the running (cumulative) CGPA and the band
//   • COMPLETENESS: selecting e.g. Level 300 while Level 200 (or 100) is
//     missing → complete=false, missingRequired names the levels, and NO
//     headline CGPA is produced from partial data ("go back and complete")
//   • the current level's own CGPA is only required when its results are
//     RELEASED (a fresh Level 300 student is complete up to Level 200)
//   • credit-WEIGHTED running CGPA (levels with more credits weigh more)
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
  assert.ok(Math.abs(j.finalCgpa - (2.9 + 3.42 + 3.6) / 3) < 1e-9);
  assert.equal(j.trend, 'up');
  assert.equal(j.enteredCredits, 72);
  assert.equal(j.levels.length, 3);
  assert.deepEqual(j.levels.map((l) => l.status), ['complete', 'complete', 'complete']);
  // Running CGPA at Level 200 = mean of the first two (equal credits).
  assert.ok(Math.abs(j.levels[1].cumulativeCgpa - (2.9 + 3.42) / 2) < 1e-9);
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
  // A cumulative that skips Level 200 is never shown.
  assert.equal(j.levels.find((l) => l.levelIndex === 3).cumulativeCgpa, null);
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
  // Headline = running CGPA through Level 200.
  assert.ok(Math.abs(j.finalCgpa - (2.9 + 3.42) / 2) < 1e-9);
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

test('credit-WEIGHTED running CGPA (a 48-credit level outweighs a 24-credit one)', () => {
  const j = historyJourney({
    semesters: [entry(1, 3.0), entry(2, 3.6)],
    currentLevelIndex: 2,
    standing: 'released',
    levelCreditsFor: creditsOf({ 1: 24, 2: 48 }),
  });
  const expected = (3.0 * 24 + 3.6 * 48) / (24 + 48);
  assert.ok(Math.abs(j.finalCgpa - expected) < 1e-9);
  assert.ok(Math.abs(j.finalCgpa - 3.3) >= 1e-9, 'must not be a simple average');
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

test('classification bands follow the RUNNING (cumulative) cgpa, not the raw level cgpa', () => {
  // Level 200 raw = 3.7, but its running CGPA = (2.9+3.7)/2 = 3.30.
  const j = historyJourney({
    semesters: [entry(1, 2.9), entry(2, 3.7)],
    currentLevelIndex: 2,
    standing: 'released',
    levelCreditsFor: creditsOf({ 1: 24, 2: 24 }),
    classify: (g) => (g >= 3.6 ? 'First Class' : g >= 3.0 ? 'Second Class Upper' : 'Second Class Lower'),
  });
  assert.equal(j.levels[0].classification, 'Second Class Lower'); // running 2.90
  assert.equal(j.levels[1].classification, 'Second Class Upper'); // running 3.30 (not 3.70!)
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
