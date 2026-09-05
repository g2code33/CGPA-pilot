// ─────────────────────────────────────────────────────────────────────────
// historyProgress — the student's CGPA journey from Level 100 to the current
// level. This is what makes GPA-History mode *worth using*:
//
//   • One row per level — the level CGPA entered, that level's credit load,
//     the cumulative (running) CGPA from Level 100, and its classification.
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
  /** The level CGPA the student entered (null = not entered yet). */
  cgpa: number | null;
  /** Configured total credits of this level (both semesters; 0 = unpublished). */
  credits: number;
  /**
   * Running credit-weighted CGPA from Level 100 through this level.
   * Null after a gap — a cumulative that skips a level is a lie.
   */
  cumulativeCgpa: number | null;
  /** Classification band label of the cumulative CGPA (null when unknown). */
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
  /** CGPA of the first completed level — where the journey starts. */
  firstCgpa: number | null;
  /**
   * The overall CGPA — ONLY when the history is complete (and at least one
   * level is entered). A partial history never yields a headline number.
   */
  finalCgpa: number | null;
  trend: 'up' | 'down' | 'flat' | null;
}

export interface HistoryJourneyInput {
  semesters: SemesterEntry[];
  currentLevelIndex: number;
  /** 'released' makes the current level's own CGPA a required entry. */
  standing: 'released' | 'notReleased' | 'justStarted';
  /** Total configured credits of one level (0 when unpublished). */
  levelCreditsFor: (levelIndex: number) => number;
  /** Optional classification lookup for a cumulative CGPA. */
  classify?: (cgpa: number) => string | null;
}

const EPS = 0.005;

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

  const levels: LevelJourney[] = [];
  const missingRequired: number[] = [];
  const enteredGpas: number[] = [];

  let runPoints = 0;
  let runCredits = 0;
  let gapSeen = false; // an earlier required level is missing → no running totals after
  let enteredCredits = 0;
  let firstCgpa: number | null = null;
  let finalCgpa: number | null = null;

  const from = 1;
  const to = Math.max(1, currentLevelIndex);

  for (let lv = from; lv <= to; lv++) {
    const cgpa = levelCgpaFor(semesters, lv);
    const isCurrent = lv === currentLevelIndex;
    const required = isCurrent ? standing === 'released' : true;
    const credits = levelCreditsFor(lv);

    let status: LevelStatus;
    if (isCurrent && standing !== 'released') status = 'current';
    else if (cgpa !== null) status = 'complete';
    else status = required ? 'missing' : 'current';

    let cumulativeCgpa: number | null = null;
    if (cgpa !== null) {
      enteredGpas.push(cgpa);
      enteredCredits += credits;
      if (firstCgpa === null) firstCgpa = cgpa;
      if (!gapSeen && credits > 0) {
        runPoints += cgpa * credits;
        runCredits += credits;
        cumulativeCgpa = runPoints / runCredits;
        finalCgpa = cumulativeCgpa; // latest gap-free running total
      } else if (gapSeen || credits === 0) {
        // Kept out of the headline: this cumulative would skip a level.
      }
    } else if (required) {
      missingRequired.push(lv);
      gapSeen = true;
    }

    levels.push({
      levelIndex: lv,
      label: `Level ${lv * 100}`,
      cgpa,
      credits,
      cumulativeCgpa,
      classification:
        cumulativeCgpa !== null && classify ? classify(cumulativeCgpa) : null,
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
