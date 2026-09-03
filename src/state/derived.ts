import { useMemo } from 'react';
import { useAcademic } from './store';
import { useInstitution } from './institutionSelection';
import { resolveContext, INSTITUTION_LABEL } from '../config/context';
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
  curriculumSemesters,
  progressThrough,
  previousSlot,
  semesterCredits as configuredSemesterCredits,
  totalProgrammeCredits,
  type CurriculumProgress,
  type SemesterSlot,
} from '../services/structureService';

/**
 * Single derived-data hook for the UI. Components never calculate directly
 * from configuration or grade values — they read the results of the core
 * engine exposed here.
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
    const configuredCreditsFor = (levelIndex: number, semesterIndex: number) =>
      configuredSemesterCredits(curriculum, levelIndex, semesterIndex);

    // ── Confirmed academic position ────────────────────────────────────
    // This is the last semester whose results are CONFIRMED, i.e. the credits
    // the student's CGPA is really over. It drives both the completed credit
    // base and everything "still ahead".
    //
    //  • 'released'        → the baseline semester itself is confirmed.
    //  • 'justStarted'     → the student just began the baseline semester and
    //    will write its exams at the end. That semester is NOT confirmed, so
    //    the confirmed position is the immediately PREVIOUS semester; the
    //    baseline (current) semester becomes the next one to finish.
    //  • 'notReleased'     → the baseline semester's exams were written but its
    //    results are pending — likewise not confirmed, so the confirmed
    //    position is the previous semester and the baseline semester is the
    //    one whose results are awaited on release.
    let confirmedLevel = state.baseline.levelIndex;
    let confirmedSem = state.baseline.semesterIndex;
    if (state.mode === 'current' && state.baseline.justEntered) {
      const prev = previousSlot(curriculum, confirmedLevel, confirmedSem);
      if (prev) {
        confirmedLevel = prev.levelIndex;
        confirmedSem = prev.semesterIndex;
      }
    } else if (state.mode === 'history' && state.semesters.length > 0) {
      const last = state.semesters[state.semesters.length - 1];
      confirmedLevel = last.levelIndex;
      confirmedSem = last.semesterIndex;
    }

    // Which "where am I now" state the student chose ('released' | 'notReleased'
    // | 'justStarted'), defaulting to released when not yet chosen.
    const standing = state.baseline.standing ?? 'released';

    const progress: CurriculumProgress = progressThrough(
      curriculum,
      confirmedLevel,
      confirmedSem
    );
    const curriculumCompletedCredits =
      curriculum && progress.hasCreditData ? progress.completedCredits : null;

    // The completed-credit base above already reflects the confirmed position,
    // so tell the CGPA engine not to subtract the current semester again (that
    // subtraction is how the old baseline-based code approximated this). This
    // keeps snapshot credits EXACTLY equal to the confirmed completed credits.
    const snapshotState =
      state.mode === 'current' && state.baseline.justEntered
        ? { ...state, baseline: { ...state.baseline, justEntered: false } }
        : state;

    const snapshot = computeSnapshot(snapshotState, grading, {
      configuredCreditsFor,
      curriculumCompletedCredits,
    });

    // Backwards-compatible record shape for the views.
    const record = {
      points: snapshot.qualityPoints,
      creditHours: snapshot.creditHours,
      cgpa: snapshot.cgpa,
      pendingCount: snapshot.pendingCount,
      pendingCreditHours: snapshot.pendingCreditHours,
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
    // outcomes once released. In history mode pending credit hours come from
    // the engine (pending semesters + pending courses); current mode has no
    // per-course entry, so its pending load is reported by the view.
    const pending: PendingProjection = pendingProjection(
      {
        confirmedPoints: snapshot.qualityPoints,
        confirmedCreditHours: snapshot.creditHours,
        pendingCreditHours: snapshot.pendingCreditHours,
        pendingCount: snapshot.pendingCount,
        target: state.targetCgpa,
      },
      grading,
      classification
    );

    // The next semester to act on / the confirmed position for the cockpit and
    // dashboard. The dashboard's `nextSemesterAfter(confirmedPosition)` then
    // lands exactly on the semester the student should act on next:
    //  • released   → the semester right after the baseline (a true "next").
    //  • justStarted/notReleased → the baseline (current) semester itself,
    //    because nextSemesterAfter(previous) == current.
    const confirmedPosition = { levelIndex: confirmedLevel, semesterIndex: confirmedSem };
    const remainingSlots = progress.remainingSlots;
    const remainingCredits =
      curriculum && progress.hasCreditData
        ? progress.remainingCredits
        : Math.max(0, totalProgrammeCredits(curriculum) - snapshot.creditHours);

    const dashboard: DashboardModel = buildDashboard({
      currentPoints: snapshot.qualityPoints,
      currentCredits: snapshot.creditHours,
      currentCgpa: snapshot.cgpa,
      currentLevelIndex: confirmedLevel,
      currentSemesterIndex: confirmedSem,
      targetCgpa: state.targetCgpa ?? 3.6,
      remainingSlots,
      remainingCredits,
      curriculum,
      curriculumPublished: !!curriculum && curriculum.status === 'published',
      grading,
      classification,
      institutionLabel: `${university.shortName} · ${school?.name ?? ''} · ${programme?.shortName ?? ''}`.trim()
        || INSTITUTION_LABEL,
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
      // The confirmed (last-released) semester position and the student's
      // chosen standing, used by planning tools to decide what to target next.
      confirmedPosition,
      standing,
      institutionLabel: `${university.shortName} · ${school?.name ?? ''} · ${programme?.shortName ?? ''}`.trim()
        || INSTITUTION_LABEL,
      maxPoints: maxGradePoints(grading),
      // derived record
      snapshot,
      record,
      semesters,
      classBand,
      pending,
      dashboard,
    };
  }, [state, context]);
}
