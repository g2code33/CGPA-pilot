import { useAcademic } from './store';
import { university } from '../config';
import { confirmedRecord, historyTotals, semesterTotals } from '../engine/cgpa';
import { classify } from '../engine/grades';
import { useMemo } from 'react';

export function useDerived() {
  const { state, dispatch } = useAcademic();
  const scale = university.gradingScale;
  const rules = university.classification;

  return useMemo(() => {
    const record = confirmedRecord(state, scale);
    const history = historyTotals(state.semesters, scale);
    const semesters = state.semesters.map((s) => ({
      semester: s,
      totals: semesterTotals(s, scale),
    }));
    const classification = classify(record.cgpa, rules);
    return {
      state,
      dispatch,
      scale,
      rules,
      record,
      history,
      semesters,
      classification,
    };
  }, [state, scale, rules]);
}
