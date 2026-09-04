import { useMemo } from 'react';
import { useAcademic } from '../state/store';
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
    const configuredCreditsFor = (levelIndex: number, semesterIndex: number) =>
      configuredSemesterCredits(curriculum, levelIndex, semesterIndex);

    // ── Single source of truth: how to interpret the selected semester ───
    const historyLast =
      state.mode === 'history' && state.semesters.length > 0
        ? {
            levelIndex: state.semesters[state.semesters.length - 1].levelIndex,
            semesterIndex: state.semesters[state.semesters.length - 1].semesterIndex,
          }
        : null;
    const standing: Standing =
      state.mode === 'history' ? 'released' : (state.baseline.standing ?? 'released');

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
    // whole completed-but-unreleased semester; for Released it is any advanced
    // "not released" course credits the user tagged.
    const advancedPending =
      state.mode === 'current' && semesterRole === 'next-semester' && standing === 'released'
        ? state.baseline.pendingCreditHours || 0
        : 0;
    const pendingLoad =
      semesterRole === 'upon-release' ? model.pendingCreditHours : advancedPending;

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
            },
          }
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
    // outcomes once released (this is the "upon release" consequence for a
    // Not Released student).
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

    const remainingSlots = progress.remainingSlots;
    const remainingCredits =
      curriculum && progress.hasCreditData
        ? progress.remainingCredits
        : Math.max(0, totalProgrammeCredits(curriculum) - snapshot.creditHours);

    const dashboard: DashboardModel = buildDashboard({
      currentPoints: snapshot.qualityPoints,
      currentCredits: snapshot.creditHours,
      currentCgpa: snapshot.cgpa,
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
        || INSTITUTION_LABEL,
      // Let the dashboard/print text reflect the same role as the UI.
      semesterRole,
      standing,
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
