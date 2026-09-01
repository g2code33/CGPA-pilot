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
import {
  curriculumSemesters,
  progressThrough,
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

    // Current-CGPA mode: the configured curriculum tells us completed and
    // remaining credit structure from the student's current level/semester.
    const progress: CurriculumProgress = progressThrough(
      curriculum,
      state.baseline.levelIndex,
      state.baseline.semesterIndex
    );
    const curriculumCompletedCredits =
      curriculum && progress.hasCreditData ? progress.completedCredits : null;

    const snapshot = computeSnapshot(state, grading, {
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
      curriculumPublished: !!curriculum,
      slots,
      totalProgrammeCredits: totalProgrammeCredits(curriculum),
      progress,
      institutionLabel: `${university.shortName} · ${school?.name ?? ''} · ${programme?.shortName ?? ''}`.trim()
        || INSTITUTION_LABEL,
      maxPoints: maxGradePoints(grading),
      // derived record
      snapshot,
      record,
      semesters,
      classBand,
      pending,
    };
  }, [state, context]);
}
