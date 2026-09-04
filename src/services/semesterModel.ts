// ─────────────────────────────────────────────────────────────────────────
// SEMESTER MODEL — single source of truth for how the selected ("baseline")
// academic semester is interpreted given the student's standing.
//
// The bug this exists to prevent: "Just Started" and "Not Released" were both
// treated as "the next semester to study", which (a) mislabelled a current /
// already-written semester as "next", and (b) risked dropping or double
// counting its credits.
//
// Three roles, derived once here and consumed everywhere:
//  • 'finish-current'  (Just Started) — the baseline semester IS the user's
//      CURRENT semester: they began it and will write its exams at the end.
//      Its credits are AHEAD (to be finished), not confirmed, not pending.
//  • 'upon-release'    (Not Released) — the baseline semester is COMPLETED
//      but its results are PENDING release. Its credits count toward the
//      programme total (not omitted) yet are excluded from the confirmed CGPA
//      (not double-counted) and are shown as a pending projection.
//  • 'next-semester'   (Released, or GPA-History) — the baseline is fully
//      confirmed and the semester to plan is the genuine NEXT one.
//
// The confirmed position is the last semester with CONFIRMED (released)
// results:
//  • released        → the baseline semester itself.
//  • justStarted     → the previous semester (baseline is still ahead).
//  • notReleased     → the previous semester (baseline results pending).
//  • history         → the last entered semester.
// ─────────────────────────────────────────────────────────────────────────

import type { CurriculumVersion } from '../config/types';
import type { CalcMode } from '../state/studentState';
import {
  previousSlot,
  progressThrough,
  semesterCredits as configuredSemesterCredits,
} from './structureService';

export type Standing = 'released' | 'notReleased' | 'justStarted';
export type SemesterRole = 'finish-current' | 'upon-release' | 'next-semester';

/** Role of the selected (baseline) semester given standing + engine mode. */
export function semesterRoleFor(standing: Standing, mode: CalcMode): SemesterRole {
  if (mode === 'history') return 'next-semester';
  switch (standing) {
    case 'justStarted':
      return 'finish-current';
    case 'notReleased':
      return 'upon-release';
    default:
      return 'next-semester';
  }
}

export interface SemesterModelInput {
  mode: CalcMode;
  standing: Standing;
  /** The selected baseline level/semester (state.baseline). */
  levelIndex: number;
  semesterIndex: number;
  curriculum?: CurriculumVersion;
  /** Last entered semester (history mode). */
  historyLast?: { levelIndex: number; semesterIndex: number } | null;
}

export interface SemesterModel {
  role: SemesterRole;
  /** Last semester with CONFIRMED (released) results. */
  confirmedPosition: { levelIndex: number; semesterIndex: number } | null;
  /** Confirmed (released) completed credits — the CGPA credit base. */
  confirmedCredits: number;
  /** Confirmed credits feed value for the CGPA engine (baseline accounted). */
  accountedCompletedCredits: number;
  /**
   * Credits of a completed-but-pending baseline semester (Not Released only),
   * which the engine subtracts from `accountedCompletedCredits` to net the
   * confirmed credits and reports as pending for the upon-release projection.
   */
  pendingCreditHours: number;
  /** Semester structure still ahead of the CONFIRMED position. */
  remainingSlots: ReturnType<typeof progressThrough>['remainingSlots'];
  /** Credits still ahead of the confirmed position (may be 0 when unpublished). */
  remainingCredits: number;
  hasCreditData: boolean;
}

/**
 * Resolve the semester model from the raw standing + selected semester. Pure
 * (no React / store), so it can be unit-tested for the three important states.
 */
export function resolveSemesterModel(
  input: SemesterModelInput
): SemesterModel {
  const role = semesterRoleFor(input.standing, input.mode);

  let confirmedLevel = input.levelIndex;
  let confirmedSem = input.semesterIndex;

  if (input.mode === 'current' && (input.standing === 'justStarted' || input.standing === 'notReleased')) {
    const prev = previousSlot(input.curriculum, input.levelIndex, input.semesterIndex);
    if (prev) {
      confirmedLevel = prev.levelIndex;
      confirmedSem = prev.semesterIndex;
    }
  } else if (input.mode === 'history' && input.historyLast) {
    confirmedLevel = input.historyLast.levelIndex;
    confirmedSem = input.historyLast.semesterIndex;
  }

  const progress = progressThrough(input.curriculum, confirmedLevel, confirmedSem);
  const confirmedCredits =
    input.curriculum && progress.hasCreditData ? progress.completedCredits : 0;

  // Not Released: the whole selected semester is completed-but-pending, so its
  // configured credits are pending (never confirmed, never omitted).
  const pendingCreditHours =
    input.mode === 'current' &&
    input.standing === 'notReleased' &&
    progress.hasCreditData
      ? configuredSemesterCredits(input.curriculum, input.levelIndex, input.semesterIndex)
      : 0;

  // Feed the engine the accounted base = confirmed + pending, then let it
  // subtract pending — so confirmed credits stay exactly right and pending are
  // reported (not double counted, not dropped).
  const accountedCompletedCredits =
    confirmedCredits > 0 && pendingCreditHours > 0
      ? confirmedCredits + pendingCreditHours
      : confirmedCredits;

  return {
    role,
    confirmedPosition: { levelIndex: confirmedLevel, semesterIndex: confirmedSem },
    confirmedCredits,
    accountedCompletedCredits,
    pendingCreditHours,
    remainingSlots: progress.remainingSlots,
    remainingCredits: progress.remainingCredits,
    hasCreditData: progress.hasCreditData,
  };
}

/** Standing-aware wording/eyebrows, shared by every surface that names the
 *  semester being acted on, so no screen can drift from the model. */
export interface RoleMeta {
  /** Small uppercase eyebrow on the mission card / dashboard tile. */
  mission: string;
  /** Noun shown above the semester label. */
  noun: string;
  /** Heading prefix used on the plan/result card. */
  planPrefix: string;
  /** Opening phrase of the status sentence. */
  statusLead: string;
  /** Label for the projected-CGPA-after readout. */
  projectedLabel: string;
  /** Short descriptor used where space is tight (dashboard tile). */
  short: string;
}

export const ROLE_META: Record<SemesterRole, RoleMeta> = {
  'finish-current': {
    mission: 'Your current mission',
    noun: 'This semester',
    planPrefix: '🎯 This semester —',
    statusLead: 'Aim for about',
    projectedLabel: 'Projected CGPA after this semester',
    short: 'Finish this semester',
  },
  'upon-release': {
    mission: 'Upon release',
    noun: 'Results pending',
    planPrefix: '📋 Upon release —',
    statusLead: 'Results are pending —',
    projectedLabel: 'Projected CGPA once released',
    short: 'Semester you just wrote',
  },
  'next-semester': {
    mission: 'Your next mission',
    noun: 'Next semester',
    planPrefix: '🎯 Next semester —',
    statusLead: 'Aim for about',
    projectedLabel: 'Projected CGPA after',
    short: 'Next semester',
  },
};

/** 'Finish Level X — Semester Y' style headline for a Just-Started current semester. */
export function finishHeadline(role: SemesterRole, label: string, ordinal: string): string {
  if (role === 'finish-current') {
    return `Finish ${label} — ${ordinal}`;
  }
  if (role === 'upon-release') return `Results for ${label} — ${ordinal}`;
  return label;
}
