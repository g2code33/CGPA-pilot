// ─────────────────────────────────────────────────────────────────────────
// historyProgress — the student's CGPA journey from Level 100 to the current
// level. This is what makes GPA-History mode *worth using*:
//
//   • One row per level — the CUMULATIVE CGPA the student entered for that
//     level (each box holds the running total up to and including that
//     level), that level's credit load, and its classification band.
//   • COMPLETENESS GUARD — a partial history must not produce a headline
//     number. If the student is in Level 300 but never entered Level 200,
//     `missingRequired` names exactly which levels to go back and complete,
//     `complete` is false, and `finalCgpa` stays null until the record is
//     whole. The app tells the student to go back — it does not guess.
//   • TREND — up / down / flat from the first completed level to the last,
//     so the student (and the AI) can see the direction of the journey.
//
// Pure (no React/DOM) so it is unit-tested like the rest of the engine.
// ─────────────────────────────────────────────────────────────────────────

import type { SemesterEntry } from '../state/studentState';

export type LevelStatus = 'complete' | 'missing' | 'current';

export interface LevelJourney {
  /** 1 = Level 100, 2 = Level 200, … */
  levelIndex: number;
  label: string; // "Level 100"
  /**
   * The CUMULATIVE CGPA the student entered for this level — the running
   * total from Level 100 through this level (null = not entered yet).
   * It is used as typed; the app never re-averages it.
   */
  cgpa: number | null;
  /** Configured total credits of this level (both semesters; 0 = unpublished). */
  credits: number;
  /** Classification band label of the typed cumulative CGPA (null when unknown). */
  classification: string | null;
  status: LevelStatus;
}

export interface HistoryJourney {
  levels: LevelJourney[];
  currentLevelIndex: number;
  /** True when every level that MUST be known is known. */
  complete: boolean;
  /** Level indexes the student must go back and complete (oldest first). */
  missingRequired: number[];
  /** At least one level CGPA has been entered. */
  hasAny: boolean;
  /** Total configured credits of the levels actually entered. */
  enteredCredits: number;
  /** Cumulative CGPA of the first completed level — where the journey starts. */
  firstCgpa: number | null;
  /**
   * The overall CGPA = the MOST RECENT cumulative CGPA the student typed —
   * ONLY when the history is complete (and at least one level is entered).
   * A partial history never yields a headline number.
   */
  finalCgpa: number | null;
  trend: 'up' | 'down' | 'flat' | null;
}

export interface HistoryJourneyInput {
  /** The CONFIRMED-only entries (see effectiveHistorySemesters). */
  semesters: SemesterEntry[];
  currentLevelIndex: number;
  /** 'released' makes the current level's own CGPA a required entry. */
  standing: 'released' | 'notReleased' | 'justStarted';
  /**
   * How the current level's entry is interpreted (see
   * currentLevelEntryKind). Only a 'whole-level' entry makes the current
   * level "complete"; a 'first-semester' entry is shown (and weighted by
   * the first-semester credits supplied via levelCreditsFor) but the level
   * stays in progress.
   */
  currentEntryKind?: CurrentLevelEntryKind;
  /** Total configured credits of one level (0 when unpublished). */
  levelCreditsFor: (levelIndex: number) => number;
  /** Optional classification lookup for a typed cumulative CGPA. */
  classify?: (cgpa: number) => string | null;
}

const EPS = 0.005;

// ── Current-level entry interpretation (GPA-History standing × semester) ──
// The CGPA box for the student's CHOSEN level can only represent released
// results. Which results those are depends on the standing + chosen
// semester:
//
//   released  + Second        → whole level (BOTH semesters are released)
//   released  + First         → FIRST semester only (the only one released)
//   notReleased + Second      → FIRST semester only (the immediate past one)
//   justStarted + Second      → FIRST semester only (the immediate past one)
//   notReleased + First       → NOTHING (no results for this level yet —
//   justStarted + First       →   the immediate past semester belongs to the
//                                 PREVIOUS level, whose whole-level entry
//                                 already covers it)
//
// The entry that IS shown is weighted by the credits it actually covers
// (whole level vs first semester), and the "none" case's entry is excluded
// from the record, the journey and the AI context alike.

export type CurrentLevelEntryKind = 'whole-level' | 'first-semester' | 'none';

export function currentLevelEntryKind(
  standing: 'released' | 'notReleased' | 'justStarted',
  chosenSemester: number
): CurrentLevelEntryKind {
  if (standing === 'released') return chosenSemester === 2 ? 'whole-level' : 'first-semester';
  return chosenSemester === 2 ? 'first-semester' : 'none';
}

/**
 * The history entries that actually represent CONFIRMED (released) results.
 * When the chosen level/semester has no released results yet (kind 'none'),
 * that level's entry — if one exists from an earlier state — is excluded, so
 * the engine, the journey, the confirmed position and the AI context all
 * agree on the same list.
 */
export function effectiveHistorySemesters<T extends { levelIndex: number }>(
  semesters: T[],
  baselineLevel: number,
  standing: 'released' | 'notReleased' | 'justStarted',
  chosenSemester: number
): T[] {
  return currentLevelEntryKind(standing, chosenSemester) === 'none'
    ? semesters.filter((s) => s.levelIndex !== baselineLevel)
    : semesters;
}

/**
 * The most recent CONFIRMED position from the entered history entries: the
 * HIGHEST level with an entry — independent of the ORDER the boxes were
 * typed, so going back to complete an earlier level never moves the
 * confirmed position backwards.
 */
export function latestHistoryPosition(
  semesters: SemesterEntry[]
): { levelIndex: number; semesterIndex: number } | null {
  let best: SemesterEntry | null = null;
  for (const s of semesters) {
    // Only a VALID entry (a real, non-pending CGPA) marks a position.
    if (levelCgpaFor([s], s.levelIndex) === null) continue;
    if (!best || s.levelIndex > best.levelIndex) best = s;
  }
  return best
    ? { levelIndex: best.levelIndex, semesterIndex: best.semesterIndex }
    : null;
}

/**
 * Map the latest CONFIRMED history entry to a (level, semester) confirmed
 * position. A whole-level entry confirms its level through that level's
 * LAST configured semester (the planning tools then see the exact remaining
 * credits); a first-semester interpretation confirms through semester 1.
 */
export function latestHistoryPositionIndex(
  semesters: SemesterEntry[],
  currentLevelIndex: number,
  entryKind: CurrentLevelEntryKind,
  lastSemesterIndexFor: (levelIndex: number) => number
): { levelIndex: number; semesterIndex: number } | null {
  const last = latestHistoryPosition(semesters);
  if (!last) return null;
  const whole = last.levelIndex !== currentLevelIndex || entryKind === 'whole-level';
  return {
    levelIndex: last.levelIndex,
    semesterIndex: whole ? lastSemesterIndexFor(last.levelIndex) : 1,
  };
}

/** The level CGPA the student has recorded for a level (null = none). */
export function levelCgpaFor(
  semesters: SemesterEntry[],
  levelIndex: number
): number | null {
  const entry = semesters.find((s) => s.levelIndex === levelIndex && !s.pending);
  if (entry && entry.gpa !== null && !Number.isNaN(entry.gpa)) return entry.gpa;
  return null;
}

/**
 * Build the Level-100→now journey for a history-mode record.
 *
 * Completeness rules (the "go back and complete it" requirement):
 *   • Every level BELOW the current level must have a CGPA.
 *   • The current level's own CGPA is required only when the student's
 *     standing there is 'released' (all results out) — otherwise the
 *     journey is complete up to the last finished level.
 */
export function historyJourney(input: HistoryJourneyInput): HistoryJourney {
  const { semesters, currentLevelIndex, standing, levelCreditsFor, classify } = input;
  // How the current level's entry is interpreted (defaults keep the old
  // semantics for callers that do not pass it).
  const kind = input.currentEntryKind ?? (standing === 'released' ? 'whole-level' : 'none');

  const levels: LevelJourney[] = [];
  const missingRequired: number[] = [];
  const enteredGpas: number[] = [];

  let enteredCredits = 0;
  let firstCgpa: number | null = null;
  let finalCgpa: number | null = null;

  const from = 1;
  const to = Math.max(1, currentLevelIndex);

  for (let lv = from; lv <= to; lv++) {
    const isCurrent = lv === currentLevelIndex;
    // Under the 'none' interpretation the chosen level has NO released
    // results, so any stored entry there does not count (it is ignored even
    // if one was left over from an earlier standing).
    const cgpa = isCurrent && kind === 'none' ? null : levelCgpaFor(semesters, lv);
    // The current level is only REQUIRED (and only ever 'complete') when its
    // entry covers the WHOLE level; a first-semester entry leaves it in
    // progress.
    const required = isCurrent ? kind === 'whole-level' : true;
    const credits = levelCreditsFor(lv);

    let status: LevelStatus;
    if (isCurrent && kind !== 'whole-level') status = 'current';
    else if (cgpa !== null) status = 'complete';
    else status = required ? 'missing' : 'current';

    if (cgpa !== null) {
      enteredGpas.push(cgpa);
      enteredCredits += credits;
      if (firstCgpa === null) firstCgpa = cgpa;
      // Each typed value IS the cumulative CGPA up to that level, so the
      // headline is simply the MOST RECENT value entered — never a
      // re-weighted average of the boxes.
      finalCgpa = cgpa;
    } else if (required) {
      missingRequired.push(lv);
    }

    levels.push({
      levelIndex: lv,
      label: `Level ${lv * 100}`,
      cgpa,
      credits,
      classification: cgpa !== null && classify ? classify(cgpa) : null,
      status,
    });
  }

  let trend: 'up' | 'down' | 'flat' | null = null;
  if (enteredGpas.length >= 2) {
    const delta = enteredGpas[enteredGpas.length - 1] - enteredGpas[0];
    trend = delta > EPS ? 'up' : delta < -EPS ? 'down' : 'flat';
  }

  return {
    levels,
    currentLevelIndex,
    complete: missingRequired.length === 0,
    missingRequired,
    hasAny: enteredGpas.length > 0,
    enteredCredits,
    firstCgpa,
    finalCgpa: missingRequired.length === 0 ? finalCgpa : null,
    trend,
  };
}
