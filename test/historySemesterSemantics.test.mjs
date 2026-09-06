// ─────────────────────────────────────────────────────────────────────────
// Automated tests for the GPA-HISTORY STATUS × SEMESTER SEMANTICS (v1.0.17).
// Run: npm test
//
// Guarantees under test (the approved interpretation table):
//
//   standing     chosen semester   interpretation of the level CGPA box
//   ──────────   ───────────────── ────────────────────────────────────────
//   released     Second            WHOLE level (both semesters released)
//   released     First             FIRST semester only (the released one)
//   notReleased  Second            FIRST semester only (immediate past)
//   justStarted  Second            FIRST semester only (immediate past)
//   notReleased  First             NOTHING — box hidden, entry excluded
//   justStarted  First             NOTHING — box hidden, entry excluded
//
//   • the box is hidden when no results exist, shown (relabelled) otherwise
//   • a first-semester entry is weighted by FIRST-SEMESTER credits only
//   • a "nothing" entry is excluded from record, journey AND AI context
//   • the confirmed position = the highest level with a valid entry,
//     independent of the order boxes were typed
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currentLevelEntryKind,
  effectiveHistorySemesters,
  latestHistoryPosition,
  latestHistoryPositionIndex,
  historyJourney,
} from '../src/services/historyProgress.ts';
import { buildAiContext, hasAnyStudentData } from '../src/services/aiContext.ts';

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

const creditsOf = (map) => (lv) => map[lv] ?? 0;

// ── 1. The interpretation table itself ───────────────────────────────────

test('currentLevelEntryKind: the approved standing × semester table', () => {
  assert.equal(currentLevelEntryKind('released', 2), 'whole-level');
  assert.equal(currentLevelEntryKind('released', 1), 'first-semester');
  assert.equal(currentLevelEntryKind('notReleased', 2), 'first-semester');
  assert.equal(currentLevelEntryKind('notReleased', 1), 'none');
  assert.equal(currentLevelEntryKind('justStarted', 2), 'first-semester');
  assert.equal(currentLevelEntryKind('justStarted', 1), 'none');
});

// ── 2. Effective (confirmed-only) entries ─────────────────────────────────

test('effectiveHistorySemesters: "nothing" standing drops the chosen level’s entry', () => {
  const all = [entry(1, 2.9), entry(2, 3.2), entry(3, 3.0)];
  // notReleased + First → nothing released for Level 300 → exclude it.
  assert.deepEqual(
    effectiveHistorySemesters(all, 3, 'notReleased', 1).map((s) => s.levelIndex),
    [1, 2]
  );
  // justStarted + First → same.
  assert.deepEqual(
    effectiveHistorySemesters(all, 3, 'justStarted', 1).map((s) => s.levelIndex),
    [1, 2]
  );
});

test('effectiveHistorySemesters: released/first-semester standings keep every entry', () => {
  const all = [entry(1, 2.9), entry(2, 3.2), entry(3, 3.0)];
  assert.equal(effectiveHistorySemesters(all, 3, 'released', 2).length, 3);
  assert.equal(effectiveHistorySemesters(all, 3, 'released', 1).length, 3);
  assert.equal(effectiveHistorySemesters(all, 3, 'notReleased', 2).length, 3);
  assert.equal(effectiveHistorySemesters(all, 3, 'justStarted', 2).length, 3);
});

test('effectiveHistorySemesters: nothing to drop when the level has no entry yet', () => {
  const all = [entry(1, 2.9), entry(2, 3.2)];
  assert.equal(effectiveHistorySemesters(all, 3, 'notReleased', 1).length, 2);
});

// ── 3. Confirmed position (order-independent, valid entries only) ─────────

test('latestHistoryPosition: highest level with a VALID entry, order-independent', () => {
  // Typed in a weird order (Level 300 before Level 100): position is 300.
  assert.deepEqual(latestHistoryPosition([entry(3, 3.0), entry(1, 2.9)]), {
    levelIndex: 3,
    semesterIndex: 1,
  });
  // An empty (no CGPA) box at a higher level does NOT mark a position.
  assert.deepEqual(latestHistoryPosition([entry(1, 2.9), entry(3, null)]), {
    levelIndex: 1,
    semesterIndex: 1,
  });
  // Pending (unreleased) entries do not count either.
  assert.deepEqual(
    latestHistoryPosition([entry(1, 2.9), entry(3, 3.0, { pending: true })]),
    { levelIndex: 1, semesterIndex: 1 }
  );
});

test('latestHistoryPosition: no valid entry → null', () => {
  assert.equal(latestHistoryPosition([]), null);
  assert.equal(latestHistoryPosition([entry(1, null), entry(2, null)]), null);
});

test('latestHistoryPositionIndex: whole-level confirms through the level’s last semester', () => {
  const sems = [entry(1, 2.9), entry(2, 3.2), entry(3, 3.0)];
  const lastSem = (lv) => (lv === 3 ? 2 : 2);
  // Chosen level (300) with a whole-level entry → confirmed through Sem 2.
  assert.deepEqual(latestHistoryPositionIndex(sems, 3, 'whole-level', lastSem), {
    levelIndex: 3,
    semesterIndex: 2,
  });
  // Chosen level with a first-semester entry → confirmed through Sem 1 only.
  assert.deepEqual(latestHistoryPositionIndex(sems, 3, 'first-semester', lastSem), {
    levelIndex: 3,
    semesterIndex: 1,
  });
  // Highest entry is a NON-chosen level → always whole-level (through its last sem).
  assert.deepEqual(
    latestHistoryPositionIndex([entry(1, 2.9), entry(2, 3.2)], 3, 'none', lastSem),
    { levelIndex: 2, semesterIndex: 2 }
  );
  assert.equal(latestHistoryPositionIndex([], 3, 'none', lastSem), null);
});

// ── 4. The journey under each interpretation ─────────────────────────────

test('journey (released+Second = whole level): current level completes the journey', () => {
  const j = historyJourney({
    semesters: [entry(1, 2.8), entry(2, 3.2), entry(3, 3.0)],
    currentLevelIndex: 3,
    standing: 'released',
    currentEntryKind: 'whole-level',
    levelCreditsFor: creditsOf({ 1: 20, 2: 20, 3: 40 }),
  });
  assert.equal(j.complete, true);
  assert.deepEqual(j.missingRequired, []);
  assert.equal(j.levels[2].status, 'complete');
  // Headline = the most recent cumulative CGPA typed (Level 300 = 3.00).
  assert.equal(j.finalCgpa, 3.0);
});

test('journey (released+First = first semester): entry counts with FIRST-SEMESTER credits only', () => {
  // The engine passes first-semester credits (15) for the chosen level.
  const j = historyJourney({
    semesters: [entry(1, 2.8), entry(2, 3.2), entry(3, 3.0)],
    currentLevelIndex: 3,
    standing: 'released',
    currentEntryKind: 'first-semester',
    levelCreditsFor: creditsOf({ 1: 20, 2: 20, 3: 15 }),
  });
  assert.equal(j.complete, true, 'first-semester standing is complete up to now');
  assert.deepEqual(j.missingRequired, []);
  assert.equal(j.levels[2].status, 'current', 'the level is still in progress');
  // Headline = the most recent cumulative CGPA typed (Level 300 = 3.00).
  assert.equal(j.finalCgpa, 3.0);
});

test('journey (first-semester, nothing entered yet for the level): complete up to the last finished level', () => {
  const j = historyJourney({
    semesters: [entry(1, 2.8), entry(2, 3.2)],
    currentLevelIndex: 3,
    standing: 'notReleased',
    currentEntryKind: 'first-semester',
    levelCreditsFor: creditsOf({ 1: 20, 2: 20, 3: 15 }),
  });
  assert.equal(j.complete, true);
  assert.deepEqual(j.missingRequired, []);
  assert.equal(j.levels[2].status, 'current');
  assert.equal(j.hasAny, true);
  assert.equal(j.finalCgpa, 3.2); // most recent cumulative CGPA typed
});

test('journey (notReleased+First = nothing): a left-over entry for the level is ignored', () => {
  // The Level 300 box was filled under an earlier standing; it must not count.
  const j = historyJourney({
    semesters: [entry(1, 2.8), entry(2, 3.2), entry(3, 3.0)],
    currentLevelIndex: 3,
    standing: 'notReleased',
    currentEntryKind: 'none',
    levelCreditsFor: creditsOf({ 1: 20, 2: 20, 3: 40 }),
  });
  const lv3 = j.levels.find((l) => l.levelIndex === 3);
  assert.equal(lv3.cgpa, null);
  assert.equal(lv3.status, 'current');
  assert.equal(j.complete, true);
  assert.deepEqual(j.missingRequired, []);
  // Headline = the most recent cumulative CGPA typed (Level 200 = 3.20).
  assert.equal(j.finalCgpa, 3.2);
});

test('journey (justStarted+First = nothing, Level 100, nothing entered): no numbers invented', () => {
  const j = historyJourney({
    semesters: [],
    currentLevelIndex: 1,
    standing: 'justStarted',
    currentEntryKind: 'none',
    levelCreditsFor: creditsOf({ 1: 40 }),
  });
  assert.equal(j.complete, true);
  assert.equal(j.hasAny, false);
  assert.equal(j.finalCgpa, null);
  assert.equal(j.trend, null);
  assert.equal(j.levels[0].status, 'current');
});

test('journey: omitting currentEntryKind keeps the legacy semantics (back-compat)', () => {
  // Legacy: released → current level REQUIRED…
  const rel = historyJourney({
    semesters: [entry(1, 2.9), entry(2, 3.2)],
    currentLevelIndex: 3,
    standing: 'released',
    levelCreditsFor: creditsOf({ 1: 20, 2: 20, 3: 40 }),
  });
  assert.deepEqual(rel.missingRequired, [3]);
  // Legacy: not released → current level NOT required.
  const nr = historyJourney({
    semesters: [entry(1, 2.9), entry(2, 3.2)],
    currentLevelIndex: 3,
    standing: 'notReleased',
    levelCreditsFor: creditsOf({ 1: 20, 2: 20, 3: 40 }),
  });
  assert.equal(nr.complete, true);
  assert.equal(nr.levels[2].status, 'current');
});

// ── 5. The AI context follows the same rules ─────────────────────────────

const historyState = (over = {}) => ({
  inputMode: 'history',
  mode: 'history',
  semesters: [],
  baseline: {
    levelIndex: 3,
    semesterIndex: 2,
    cgpa: null,
    creditHours: 0,
    pendingCreditHours: 0,
    standing: 'released',
    ...over.baseline,
  },
  targetCgpa: null,
  plannedNextCreditHours: 0,
  ...over,
});

test('aiContext: hasAnyStudentData ignores the entry when the standing is "nothing"', () => {
  const s = historyState({
    baseline: { levelIndex: 3, semesterIndex: 1, standing: 'notReleased' },
    semesters: [entry(3, 3.0)],
  });
  assert.equal(hasAnyStudentData(s), false, 'only the excluded level has data → no data');
  // A lower level's entry still counts.
  assert.equal(
    hasAnyStudentData(historyState({
      baseline: { levelIndex: 3, semesterIndex: 1, standing: 'notReleased' },
      semesters: [entry(2, 3.2), entry(3, 3.0)],
    })),
    true
  );
});

test('aiContext: "nothing" standing — the level’s entry never reaches the model', () => {
  const s = historyState({
    baseline: { levelIndex: 3, semesterIndex: 1, standing: 'justStarted' },
    semesters: [entry(1, 2.8), entry(3, 3.0)],
  });
  const ctx = buildAiContext(s, { creditHours: 0, points: 0, cgpa: null, pendingCreditHours: 0 }, null, { university: 'TU' });
  assert.deepEqual(ctx.semesters.map((x) => x.label), ['Level 100']);
});

test('aiContext: first-semester standing — entry kept but labelled as first-semester', () => {
  const s = historyState({
    baseline: { levelIndex: 3, semesterIndex: 1, standing: 'released' },
    semesters: [entry(1, 2.8), entry(3, 3.0)],
  });
  const ctx = buildAiContext(s, { creditHours: 0, points: 0, cgpa: null, pendingCreditHours: 0 }, null, { university: 'TU' });
  const labels = ctx.semesters.map((x) => x.label);
  assert.deepEqual(labels, ['Level 100', 'Level 300 · First semester CGPA']);
});

test('aiContext: whole-level standing keeps the plain level label', () => {
  const s = historyState({
    baseline: { levelIndex: 3, semesterIndex: 2, standing: 'released' },
    semesters: [entry(1, 2.8), entry(3, 3.0)],
  });
  const ctx = buildAiContext(s, { creditHours: 0, points: 0, cgpa: null, pendingCreditHours: 0 }, null, { university: 'TU' });
  assert.deepEqual(ctx.semesters.map((x) => x.label), ['Level 100', 'Level 300']);
});
