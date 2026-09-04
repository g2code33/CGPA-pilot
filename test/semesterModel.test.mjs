// ─────────────────────────────────────────────────────────────────────────
// Tests for the SEMESTER MODEL (semesterModel.ts) — the single source of
// truth that separates the three scenarios and guarantees no off-by-one, no
// double counting and no omitted semester credits.
//
//   TEST 1 — JUST STARTED  (current semester to finish)
//   TEST 2 — NOT RELEASED  (completed semester, results pending -> upon release)
//   TEST 3 — ACTUAL NEXT SEMESTER (released -> genuine next semester)
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import * as sm from '../src/services/semesterModel.ts';
import * as core from '../src/services/coreCgpaService.ts';

// Curriculum credits per (level, semester): 20/20/20/20/17/17/18/18 for the
// four levels used below.
const CREDITS = {
  '1,1': 20, '1,2': 20,
  '2,1': 20, '2,2': 20,
  '3,1': 17, '3,2': 17,
  '4,1': 18, '4,2': 18,
};

function curriculum() {
  const levels = [1, 2, 3, 4].map((l) => ({
    index: l,
    label: `Level ${l * 100}`,
    semesters: [1, 2].map((s) => ({
      index: s,
      label: `Semester ${s}`,
      courses: [
        {
          id: `${l}-${s}`,
          code: `C${l}${s}`,
          name: 'Course',
          creditHours: CREDITS[`${l},${s}`],
          level: l,
          semester: s,
          programmeId: 'p',
          curriculumId: 'c',
          status: 'active',
          core: true,
        },
      ],
    })),
  }));
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

function sumThrough(level, sem) {
  let total = 0;
  for (const l of [1, 2, 3, 4]) {
    for (const s of [1, 2]) {
      total += CREDITS[`${l},${s}`];
      if (l === level && s === sem) return total;
    }
  }
  return total;
}
const TOTAL = sumThrough(4, 2); // 150

test('semesterRoleFor maps standing to the same role in Quick and GPA-History', () => {
  for (const mode of ['current', 'history']) {
    assert.equal(sm.semesterRoleFor('justStarted', mode), 'finish-current');
    assert.equal(sm.semesterRoleFor('notReleased', mode), 'upon-release');
    assert.equal(sm.semesterRoleFor('released', mode), 'next-semester');
  }
});

// ── TEST 1 — JUST STARTED ────────────────────────────────────────────────
test('JUST STARTED: selected semester is the CURRENT semester to finish', () => {
  // User is in Level 300 · Semester 2 (17 cr). Confirmed = previous (L300 S1).
  const m = sm.resolveSemesterModel({
    mode: 'current',
    standing: 'justStarted',
    levelIndex: 3,
    semesterIndex: 2,
    curriculum: curriculum(),
  });
  assert.equal(m.role, 'finish-current');
  assert.equal(m.confirmedPosition.levelIndex, 3);
  assert.equal(m.confirmedPosition.semesterIndex, 1);
  // Confirmed CGPA base = credits through L300 S1.
  assert.equal(m.confirmedCredits, sumThrough(3, 1)); // 97
  // The current semester (L300 S2, 17) is AHEAD (to finish), NOT pending.
  assert.equal(m.pendingCreditHours, 0);
  // Remaining must include the current semester's 17 credits.
  assert.equal(m.remainingCredits, TOTAL - sumThrough(3, 1)); // 53 = 17+18+18
  assert.equal(m.remainingSlots[0].levelIndex, 3);
  assert.equal(m.remainingSlots[0].semesterIndex, 2);
  assert.equal(m.remainingSlots[0].credits, 17);
  // Total is accounted exactly once: confirmed + remaining == programme total.
  assert.equal(m.confirmedCredits + m.remainingCredits, TOTAL);
});

// ── TEST 2 — NOT RELEASED ────────────────────────────────────────────────
test('NOT RELEASED: selected semester is completed but PENDING (upon release)', () => {
  const m = sm.resolveSemesterModel({
    mode: 'current',
    standing: 'notReleased',
    levelIndex: 3,
    semesterIndex: 2,
    curriculum: curriculum(),
  });
  assert.equal(m.role, 'upon-release');
  // Confirmed position is the previous semester (L300 S1).
  assert.equal(m.confirmedPosition.levelIndex, 3);
  assert.equal(m.confirmedPosition.semesterIndex, 1);
  // The whole written semester (L300 S2, 17 cr) is carried as PENDING.
  assert.equal(m.pendingCreditHours, 17);
  // Engine feed base accounts the pending semester so confirmed credits stay
  // correct after the pending subtraction (never double counted / omitted).
  assert.equal(m.confirmedCredits, sumThrough(3, 1)); // 97 confirmed
  assert.equal(m.accountedCompletedCredits, sumThrough(3, 1) + 17); // 114
  // Nothing is omitted: confirmed credits are still exactly the confirmed base,
  // and the pending credits are reported separately (subset of remaining).
  assert.equal(m.remainingCredits, TOTAL - sumThrough(3, 1));
});

// ── TEST 3 — ACTUAL NEXT SEMESTER ────────────────────────────────────────
test('RELEASED: the genuine NEXT semester is planned after the current one', () => {
  // Student has completed Level 300 · Semester 2 and is moving to Level 400 · S1.
  const m = sm.resolveSemesterModel({
    mode: 'current',
    standing: 'released',
    levelIndex: 3,
    semesterIndex: 2,
    curriculum: curriculum(),
  });
  assert.equal(m.role, 'next-semester');
  assert.equal(m.confirmedPosition.levelIndex, 3);
  assert.equal(m.confirmedPosition.semesterIndex, 2);
  assert.equal(m.confirmedCredits, sumThrough(3, 2)); // 114
  assert.equal(m.pendingCreditHours, 0);
  // Remaining starts at the actual next semester (L400 S1).
  assert.equal(m.remainingSlots[0].levelIndex, 4);
  assert.equal(m.remainingSlots[0].semesterIndex, 1);
  assert.equal(m.remainingCredits, TOTAL - sumThrough(3, 2)); // 36
});

// ── Boundary: very first semester (no previous confirmed slot) ───────────
test('justStarted/notReleased on the very first semester stays put (no negative)', () => {
  const m = sm.resolveSemesterModel({
    mode: 'current',
    standing: 'justStarted',
    levelIndex: 1,
    semesterIndex: 1,
    curriculum: curriculum(),
  });
  // No previous slot exists, so the confirmed position cannot go before (1,1).
  assert.equal(m.confirmedPosition.levelIndex, 1);
  assert.equal(m.confirmedPosition.semesterIndex, 1);
});

// ── Integration: standing -> confirmed snapshot (accounted - pending) ───
// Replicates the wiring in useDerived to prove no credits are dropped or
// double-counted when the confirmed CGPA is computed from the model.
function gradedGrading() {
  return {
    id: 'ucc',
    name: 'UCC',
    bands: [
      { grade: 'A', points: 4.0 },
      { grade: 'B', points: 3.0 },
      { grade: 'E', points: 0.0 },
    ],
  };
}

// Drive currentModeRecord the way derived does: feed accountedCompletedCredits
// as the curriculum-completed base and pendingCreditHours on the baseline.
function confirmedSnapshot(model, cgpa) {
  return core.currentModeRecord(
    {
      levelIndex: 1,
      semesterIndex: 1,
      cgpa,
      creditHours: 0,
      pendingCreditHours: model.pendingCreditHours,
      justEntered: false,
    },
    model.accountedCompletedCredits,
    () => 0
  );
}

test('JUST STARTED integration: current semester is AHEAD (not pending), CGPA is over confirmed credits', () => {
  const c = curriculum();
  const m = sm.resolveSemesterModel({ mode: 'current', standing: 'justStarted', levelIndex: 3, semesterIndex: 2, curriculum: c });
  const rec = confirmedSnapshot(m, 3.0);
  assert.equal(rec.creditHours, m.confirmedCredits); // 97
  assert.equal(rec.creditHours, sumThrough(3, 1));
  assert.ok(Math.abs(rec.qualityPoints - 3.0 * 97) < 1e-9);
  // The current 17-credit semester is not pending (exams ahead, to be finished).
  assert.equal(m.pendingCreditHours, 0);
  // Nothing double counted: confirmed credits + remaining == total.
  assert.equal(rec.creditHours + m.remainingCredits, TOTAL);
});

test('NOT RELEASED integration: written semester is PENDING, confirmed CGPA nets correctly (no double count, no omission)', () => {
  const c = curriculum();
  const m = sm.resolveSemesterModel({ mode: 'current', standing: 'notReleased', levelIndex: 3, semesterIndex: 2, curriculum: c });
  assert.equal(m.pendingCreditHours, 17);
  // accounted = confirmed(97) + pending(17) = 114; engine subtracts pending -> confirmed.
  assert.equal(m.accountedCompletedCredits, 114);
  const rec = confirmedSnapshot(m, 3.0);
  assert.equal(rec.creditHours, 97); // pending excluded from confirmed CGPA
  assert.ok(Math.abs(rec.qualityPoints - 3.0 * 97) < 1e-9);
  // The 17 written credits are reported separately (not omitted, not counted twice).
  assert.equal(m.pendingCreditHours + rec.creditHours, 114);
  assert.equal(rec.creditHours + m.remainingCredits, TOTAL);
});

test('RELEASED integration: confirmed through the selected semester, no pending', () => {
  const c = curriculum();
  const m = sm.resolveSemesterModel({ mode: 'current', standing: 'released', levelIndex: 3, semesterIndex: 2, curriculum: c });
  assert.equal(m.pendingCreditHours, 0);
  const rec = confirmedSnapshot(m, 3.0);
  assert.equal(rec.creditHours, sumThrough(3, 2)); // 114
  assert.equal(rec.creditHours + m.remainingCredits, TOTAL);
});

// ── GPA-History is standing-AWARE (improvement 6) ────────────────────────
// History stores one CGPA per completed level; the standing picker labels the
// current level and must drive the ROLE exactly like Quick mode. The confirmed
// position stays the LAST entered level (already the most recent released
// result) and no number moves — the standing only re-words the next action.
function historyModel(standing, historyLast) {
  return sm.resolveSemesterModel({
    mode: 'history',
    standing,
    levelIndex: 4, // baseline = the level the student is "in now"
    semesterIndex: 1,
    curriculum: curriculum(),
    historyLast,
  });
}

test('GPA-HISTORY released: role is next-semester, confirmed = last entered level', () => {
  const m = historyModel('released', { levelIndex: 3, semesterIndex: 2 });
  assert.equal(m.role, 'next-semester');
  assert.equal(m.confirmedPosition.levelIndex, 3);
  assert.equal(m.confirmedPosition.semesterIndex, 2);
  assert.equal(m.confirmedCredits, sumThrough(3, 2)); // 114
  assert.equal(m.pendingCreditHours, 0);
  assert.equal(m.confirmedCredits + m.remainingCredits, TOTAL);
});

test('GPA-HISTORY not released: role becomes upon-release, confirmed position unchanged', () => {
  const m = historyModel('notReleased', { levelIndex: 3, semesterIndex: 2 });
  assert.equal(m.role, 'upon-release');
  // The standing only selects the role; it never moves the confirmed base or
  // the credit math, so confirmed credits / remaining credits are identical to
  // the released case (the written current level is simply not typed yet).
  assert.equal(m.confirmedPosition.levelIndex, 3);
  assert.equal(m.confirmedPosition.semesterIndex, 2);
  assert.equal(m.confirmedCredits, sumThrough(3, 2));
  assert.equal(m.confirmedCredits + m.remainingCredits, TOTAL);
});

test('GPA-HISTORY just started: role becomes finish-current, confirmed position unchanged', () => {
  const m = historyModel('justStarted', { levelIndex: 3, semesterIndex: 1 });
  assert.equal(m.role, 'finish-current');
  assert.equal(m.confirmedPosition.levelIndex, 3);
  assert.equal(m.confirmedPosition.semesterIndex, 1);
  assert.equal(m.confirmedCredits, sumThrough(3, 1)); // 97
  assert.equal(m.confirmedCredits + m.remainingCredits, TOTAL);
});
