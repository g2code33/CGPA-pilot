import { useMemo } from 'react';
import { useAcademic } from '../state/store';
import { useInstitution } from './institutionSelection';
import { resolveContext, institutionLabel } from '../config/context';
import { getActiveCurriculum } from '../services/curriculumService';
import { classifyCgpa } from '../services/classificationService';
import { maxGradePoints } from '../services/gradingService';
import {
  computeSnapshot,
  semesterTerm,
  type SemesterTerm,
} from '../services/coreCgpaService';
import { pendingProjection, type PendingProjection } from '../services/pendingService';
import { buildDashboard, type DashboardModel } from '../services/dashboardService';
import {
  resolveSemesterModel,
  ROLE_META,
  type SemesterRole,
  type Standing,
} from '../services/semesterModel';
import {
  curriculumSemesters,
  progressThrough,
  semesterCredits as configuredSemesterCredits,
  totalProgrammeCredits,
  type SemesterSlot,
} from '../services/structureService';
import {
  historyJourney as computeHistoryJourney,
  currentLevelEntryKind,
  effectiveHistorySemesters,
  latestHistoryPositionIndex,
  type CurrentLevelEntryKind,
} from '../services/historyProgress';
import type { HistoryJourney } from '../services/historyProgress';

/**
 * Single derived-data hook for the UI. Components never calculate directly
 * from configuration or grade values — they read the results of the core
 * engine exposed here. In particular, every planning surface reads the SAME
 * resolved semester model (confirmed position / role / pending credits) so the
 * interpretation of the selected semester never drifts between screens.
 */
export function useDerived() {
  const { state, dispatch } = useAcademic();
  const { context } = useInstitution();

  return useMemo(() => {
    const { university, school, programme, gradingSystem, classificationSystem } =
      resolveContext(context);
    const grading = gradingSystem!;
    const classification = classificationSystem!;
    const curriculum = getActiveCurriculum(context);

    const slots: SemesterSlot[] = curriculumSemesters(curriculum);
    /**
     * GPA-History mode: each entered row is a WHOLE-LEVEL CGPA ("Level X CGPA"),
     * so it is weighted by the level's TOTAL credits (both semesters) — not
     * just semester 1's load. Current mode keeps per-semester credits.
     */
    const levelCreditsFor = (levelIndex: number) =>
      slots
        .filter((s) => s.levelIndex === levelIndex)
        .reduce((sum, s) => sum + s.credits, 0);
    const firstSemesterCreditsFor = (levelIndex: number) =>
      slots
        .filter((s) => s.levelIndex === levelIndex && s.semesterIndex === 1)
        .reduce((sum, s) => sum + s.credits, 0);
    /** The level's LAST configured semester (whole-level entries confirm through it). */
    const lastSemesterOf = (levelIndex: number) => {
      const sems = slots.filter((s) => s.levelIndex === levelIndex).map((s) => s.semesterIndex);
      return sems.length ? Math.max(...sems) : 2;
    };

    // ── Single source of truth: how to interpret the selected semester ───
    // Standing is user-chosen in BOTH Quick and GPA-History mode (the standing
    // picker reflects "which level/semester are you in now, and how does it
    // stand?"). It drives the semantic role identically in both modes.
    const standing: Standing = state.baseline.standing ?? 'released';

    // GPA-History: how the CHOSEN level's CGPA entry is interpreted — which
    // released results it may represent (whole level / first semester only /
    // nothing). Drives the input box, that entry's credit weight, the
    // confirmed position and what the AI context receives.
    const historyEntryKind: CurrentLevelEntryKind | null =
      state.mode === 'history'
        ? currentLevelEntryKind(standing, state.baseline.semesterIndex)
        : null;

    // The CONFIRMED-only history entries: when the chosen semester has no
    // released results yet ('none'), the chosen level's entry — if one exists
    // from an earlier standing — does not count anywhere.
    const effectiveSemesters =
      historyEntryKind === 'none'
        ? effectiveHistorySemesters(
            state.semesters,
            state.baseline.levelIndex,
            standing,
            state.baseline.semesterIndex
          )
        : state.semesters;

    // A first-semester interpretation weights the chosen level's entry by the
    // FIRST semester's credits only; everything else keeps whole-level weight.
    const historyCreditsFor = (levelIndex: number) =>
      levelIndex === state.baseline.levelIndex && historyEntryKind === 'first-semester'
        ? firstSemesterCreditsFor(levelIndex)
        : levelCreditsFor(levelIndex);

    const configuredCreditsFor = (levelIndex: number, semesterIndex: number) =>
      state.mode === 'history'
        ? historyCreditsFor(levelIndex)
        : configuredSemesterCredits(curriculum, levelIndex, semesterIndex);

    // The confirmed position in history mode = the most recent CONFIRMED
    // entry (highest level — independent of the order the boxes were typed).
    // A whole-level entry confirms the level through its LAST configured
    // semester; a first-semester entry confirms through semester 1.
    const historyLast =
      state.mode === 'history'
        ? latestHistoryPositionIndex(
            effectiveSemesters,
            state.baseline.levelIndex,
            historyEntryKind!,
            lastSemesterOf
          )
        : null;

    const model = resolveSemesterModel({
      mode: state.mode,
      standing,
      levelIndex: state.baseline.levelIndex,
      semesterIndex: state.baseline.semesterIndex,
      curriculum,
      historyLast,
    });
    const semesterRole: SemesterRole = model.role;
    const confirmedPosition = model.confirmedPosition!;
    const roleMeta = ROLE_META[semesterRole];

    // Structure progress relative to the confirmed position (backwards
    // compatible `d.progress` plus the semantic fields above).
    const progress = progressThrough(curriculum, confirmedPosition.levelIndex, confirmedPosition.semesterIndex);
    const curriculumCompletedCredits =
      model.hasCreditData && curriculum
        ? model.accountedCompletedCredits
        : null;

    // Pending load reported to the CGPA engine. For Not Released this is the
    // whole completed-but-unreleased semester; for Released AND Just started it
    // is any advanced "not released" course credits the user tagged (a student
    // who just started can already have some immediate results out and some
    // still pending).
    const advancedPending =
      state.mode === 'current' &&
      (semesterRole === 'next-semester' || semesterRole === 'finish-current') &&
      (standing === 'released' || standing === 'justStarted')
        ? state.baseline.pendingCreditHours || 0
        : 0;
    const pendingLoad =
      semesterRole === 'upon-release' ? model.pendingCreditHours : advancedPending;
    // For the advanced per-course "some results not released" case the
    // student's typed CGPA is CUMULATIVE — it already counts these credits in
    // the denominator at 0 points. Only this case keeps them in the base;
    // "Not Released" (whole semester) uses a confirmed-only base.
    const pendingIncludedInBase = advancedPending > 0;

    // ── GPA-History journey: Level 100 → current level ───────────────────
    // The whole point of History mode is that the student's progress FROM
    // SCRATCH is known: every level below the current one must be entered.
    // Each entered value is the CUMULATIVE CGPA up to that level (not a
    // per-level GPA), so there is no "running CGPA" to compute — the band is
    // the typed value and the confirmed CGPA is the most recent typed value.
    // A partial history is flagged (missingRequired) and never produces a
    // headline CGPA anywhere.
    const historyJourney: HistoryJourney | null =
      state.mode === 'history'
        ? computeHistoryJourney({
            semesters: effectiveSemesters,
            currentLevelIndex: state.baseline.levelIndex,
            standing,
            currentEntryKind: historyEntryKind ?? undefined,
            levelCreditsFor: historyCreditsFor,
            classify: (g) => classifyCgpa(g, classification)?.label ?? null,
          })
        : null;

    // The confirmed credit base already accounts for the current/pending
    // position, so tell the engine not to subtract the "current semester" again
    // (older logic approximated this by subtracting). Pending load is injected
    // so the engine nets confirmed credits and reports pending separately.
    const snapshotState =
      state.mode === 'current'
        ? {
            ...state,
            baseline: {
              ...state.baseline,
              justEntered: false,
              pendingCreditHours: pendingLoad,
              pendingIncludedInBase,
            },
          }
        : state.mode === 'history'
          ? { ...state, semesters: effectiveSemesters }
          : state;

    let snapshot = computeSnapshot(snapshotState, grading, {
      configuredCreditsFor,
      curriculumCompletedCredits,
    });

    // History mode: each typed level value IS the cumulative CGPA, so the
    // confirmed CGPA is the MOST RECENT typed value (never a re-weighted
    // average), and the quality points are that CGPA over the completed
    // credits. An incomplete history never yields a confirmed CGPA.
    if (state.mode === 'history' && historyJourney) {
      const finalCgpa = historyJourney.complete ? historyJourney.finalCgpa : null;
      snapshot = {
        ...snapshot,
        cgpa: finalCgpa,
        qualityPoints:
          finalCgpa !== null ? finalCgpa * snapshot.creditHours : 0,
      };
    }

    // Backwards-compatible record shape for the views.
    const record = {
      points: snapshot.qualityPoints,
      creditHours: snapshot.creditHours,
      cgpa: snapshot.cgpa,
      pendingCount: snapshot.pendingCount,
      pendingCreditHours: snapshot.pendingCreditHours,
      pendingIncludedInBase: snapshot.pendingIncludedInBase,
    };

    const semesters = state.semesters.map((semester) => {
      const configured = configuredCreditsFor(
        semester.levelIndex,
        semester.semesterIndex
      );
      const term: SemesterTerm = semesterTerm(semester, grading, configured);
      return {
        semester,
        configuredCredits: configured,
        effectiveCredits: term.creditHours,
        term,
      };
    });

    const classBand = classifyCgpa(snapshot.cgpa, classification);

    // Pending-results projection: the confirmed position plus best/worst-case
    // outcomes once released (this is the "upon release" consequence for a
    // Not Released student).
    const pending: PendingProjection = pendingProjection(
      {
        confirmedPoints: snapshot.qualityPoints,
        confirmedCreditHours: snapshot.creditHours,
        pendingCreditHours: snapshot.pendingCreditHours,
        pendingCount: snapshot.pendingCount,
        pendingIncludedInBase: snapshot.pendingIncludedInBase,
        target: state.targetCgpa,
      },
      grading,
      classification
    );

    const remainingSlots = progress.remainingSlots;
    const remainingCredits =
      curriculum && progress.hasCreditData
        ? progress.remainingCredits
        : Math.max(0, totalProgrammeCredits(curriculum) - snapshot.creditHours);

    const dashboard: DashboardModel = buildDashboard({
      currentPoints: snapshot.qualityPoints,
      currentCredits: snapshot.creditHours,
      // An incomplete CGPA history must not present a "current" CGPA — the
      // dashboard reports "awaiting data" and the journey strip says exactly
      // which levels to go back and complete.
      currentCgpa:
        state.mode === 'history' && historyJourney && !historyJourney.complete
          ? null
          : snapshot.cgpa,
      currentLevelIndex: confirmedPosition.levelIndex,
      currentSemesterIndex: confirmedPosition.semesterIndex,
      targetCgpa: state.targetCgpa ?? 3.6,
      remainingSlots,
      remainingCredits,
      curriculum,
      curriculumPublished: !!curriculum && curriculum.status === 'published',
      grading,
      classification,
      institutionLabel: `${university.shortName} · ${school?.name ?? ''} · ${programme?.shortName ?? ''}`.trim()
        || institutionLabel(context),
      // Let the dashboard/print text reflect the same role as the UI.
      semesterRole,
      standing,
      pendingCredits: snapshot.pendingCreditHours,
      pendingCreditsInBase: snapshot.pendingIncludedInBase,
    });

    return {
      state,
      dispatch,
      // configuration
      university,
      school,
      programme,
      grading,
      classification,
      curriculum,
      curriculumPublished: !!curriculum && curriculum.status === 'published',
      slots,
      totalProgrammeCredits: totalProgrammeCredits(curriculum),
      progress,
      // ── Semantic semester model (single source of truth) ──────────────
      standing,
      semesterRole,
      confirmedPosition,
      roleMeta,
      historyLast,
      // GPA-History: how the chosen level's entry is interpreted (null in
      // Current mode) — drives the input box label/visibility.
      historyEntryKind,
      institutionLabel: `${university.shortName} · ${school?.name ?? ''} · ${programme?.shortName ?? ''}`.trim()
        || institutionLabel(context),
      maxPoints: maxGradePoints(grading),
      // derived record
      snapshot,
      record,
      semesters,
      classBand,
      pending,
      dashboard,
      // GPA-History: the student's journey from Level 100 to now (null in
      // Current mode) — journey view, completeness guard, trend.
      historyJourney,
    };
  }, [state, context]);
}
