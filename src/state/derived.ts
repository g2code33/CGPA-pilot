import { useMemo } from 'react';
import { useAcademic } from './store';
import { resolveContext, INSTITUTION_LABEL } from '../config/context';
import {
  getActiveCurriculum,
  isPublished,
  curriculumTotalCredits,
} from '../services/curriculumService';
import {
  confirmedRecord,
  historyTotals,
  semesterTotals,
} from '../services/cgpaCalculationService';
import { classifyCgpa } from '../services/classificationService';
import { maxGradePoints } from '../services/gradingService';

/**
 * Single derived-data hook for the UI. Components never calculate directly
 * from configuration — they call the services exposed here.
 */
export function useDerived() {
  const { state, dispatch } = useAcademic();

  return useMemo(() => {
    const { university, school, programme, gradingSystem, classificationSystem } =
      resolveContext();
    const grading = gradingSystem!;
    const classification = classificationSystem!;
    const curriculum = getActiveCurriculum();

    const record = confirmedRecord(state, grading);
    const history = historyTotals(state.semesters, grading);
    const semesters = state.semesters.map((semester) => ({
      semester,
      totals: semesterTotals(semester, grading),
    }));
    const classBand = classifyCgpa(record.cgpa, classification);

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
      curriculumPublished: isPublished(curriculum),
      curriculumCredits: curriculum ? curriculumTotalCredits(curriculum) : 0,
      institutionLabel: INSTITUTION_LABEL,
      // derived record
      record,
      history,
      semesters,
      classBand,
      maxPoints: maxGradePoints(grading),
    };
  }, [state]);
}
