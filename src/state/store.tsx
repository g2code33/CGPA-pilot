import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import type {
  AcademicState,
  CalcMode,
  CourseEntry,
  InputMode,
  SemesterEntry,
} from './studentState';
import { uid } from '../util/format';
import { initCurriculum } from '../services/curriculumService';

// ─────────────────────────────────────────────────────────────────────────
// TEMPORARY, IN-MEMORY academic state.
// Deliberately NOT persisted: no localStorage, no sessionStorage, no
// IndexedDB, no cookies, no URLs. Everything resets on refresh / Clear.
// ─────────────────────────────────────────────────────────────────────────

function makeCourse(): CourseEntry {
  return {
    id: uid(),
    code: '',
    name: '',
    creditHours: 3,
    score: null,
    grade: null,
    pending: false,
  };
}

function makeSemester(levelIndex: number, semesterIndex: number): SemesterEntry {
  return {
    id: uid(),
    label: `Level ${levelIndex * 100} · Semester ${semesterIndex}`,
    levelIndex,
    semesterIndex,
    gpa: null,
    creditHoursOverride: null,
    courses: [],
    pending: false,
  };
}

function initialState(): AcademicState {
  return {
    inputMode: 'quick',
    mode: 'current',
    semesters: [],
    baseline: {
      levelIndex: 1,
      semesterIndex: 1,
      cgpa: null,
      creditHours: 0,
      pendingCreditHours: 0,
      justEntered: false,
    },
    targetCgpa: 3.6, // First Class (UCC)
    plannedNextCreditHours: 18,
  };
}

/** Map the student-facing input mode to the engine data mode. */
function engineModeFor(inputMode: InputMode): CalcMode {
  return inputMode === 'history' ? 'history' : 'current';
}

type Action =
  | { type: 'reset' }
  | { type: 'setInputMode'; inputMode: InputMode }
  | { type: 'setMode'; mode: CalcMode }
  | { type: 'setTarget'; target: number | null }
  | { type: 'setBaseline'; patch: Partial<AcademicState['baseline']> }
  | { type: 'setPlannedNext'; creditHours: number }
  | { type: 'addSemester' }
  | { type: 'removeSemester'; semesterId: string }
  | { type: 'renameSemester'; semesterId: string; label: string }
  | { type: 'setSemesterGpa'; semesterId: string; gpa: number | null }
  | { type: 'setSemesterPending'; semesterId: string; pending: boolean }
  | {
      type: 'setSemesterCredits';
      semesterId: string;
      creditHours: number | null;
    }
  | { type: 'addCourse'; semesterId: string }
  | { type: 'removeCourse'; semesterId: string; courseId: string }
  | {
      type: 'updateCourse';
      semesterId: string;
      courseId: string;
      patch: Partial<CourseEntry>;
    };

function nextLevelSemester(semesters: SemesterEntry[]): {
  level: number;
  semester: number;
} {
  // Follow the conventional two-semesters-per-level progression.
  const n = semesters.length + 1;
  const level = Math.ceil(n / 2);
  const semester = ((n - 1) % 2) + 1;
  return { level, semester };
}

function reducer(state: AcademicState, action: Action): AcademicState {
  switch (action.type) {
    case 'reset':
      return initialState();

    case 'setInputMode': {
      const mode = engineModeFor(action.inputMode);
      // History mode needs at least one semester entry to fill in.
      const semesters =
        mode === 'history' && state.semesters.length === 0
          ? [makeSemester(1, 1)]
          : state.semesters;
      return { ...state, inputMode: action.inputMode, mode, semesters };
    }

    case 'setMode':
      return { ...state, mode: action.mode };

    case 'setTarget':
      return { ...state, targetCgpa: action.target };

    case 'setBaseline':
      return { ...state, baseline: { ...state.baseline, ...action.patch } };

    case 'setPlannedNext':
      return {
        ...state,
        plannedNextCreditHours: Math.max(1, action.creditHours || 1),
      };

    case 'addSemester': {
      const { level, semester } = nextLevelSemester(state.semesters);
      return {
        ...state,
        semesters: [...state.semesters, makeSemester(level, semester)],
      };
    }

    case 'removeSemester':
      return {
        ...state,
        semesters: state.semesters.filter((s) => s.id !== action.semesterId),
      };

    case 'renameSemester':
      return {
        ...state,
        semesters: state.semesters.map((s) =>
          s.id === action.semesterId ? { ...s, label: action.label } : s
        ),
      };

    case 'setSemesterGpa':
      return {
        ...state,
        semesters: state.semesters.map((s) =>
          s.id === action.semesterId ? { ...s, gpa: action.gpa } : s
        ),
      };

    case 'setSemesterPending':
      // Marking pending never deletes entered values (restored on release),
      // but the term is excluded from the confirmed CGPA while pending.
      return {
        ...state,
        semesters: state.semesters.map((s) =>
          s.id === action.semesterId ? { ...s, pending: action.pending } : s
        ),
      };

    case 'setSemesterCredits':
      return {
        ...state,
        semesters: state.semesters.map((s) =>
          s.id === action.semesterId
            ? { ...s, creditHoursOverride: action.creditHours }
            : s
        ),
      };

    case 'addCourse':
      return {
        ...state,
        semesters: state.semesters.map((s) =>
          s.id === action.semesterId
            ? { ...s, courses: [...s.courses, makeCourse()] }
            : s
        ),
      };

    case 'removeCourse':
      return {
        ...state,
        semesters: state.semesters.map((s) =>
          s.id === action.semesterId
            ? { ...s, courses: s.courses.filter((c) => c.id !== action.courseId) }
            : s
        ),
      };

    case 'updateCourse':
      return {
        ...state,
        semesters: state.semesters.map((s) =>
          s.id === action.semesterId
            ? {
                ...s,
                courses: s.courses.map((c) =>
                  c.id === action.courseId ? { ...c, ...action.patch } : c
                ),
              }
            : s
        ),
      };

    default:
      return state;
  }
}

interface Store {
  state: AcademicState;
  dispatch: React.Dispatch<Action>;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  // Load the locally cached/bundled published curriculum BEFORE first render.
  useMemo(() => initCurriculum(), []);
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useAcademic(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useAcademic must be used within StoreProvider');
  return ctx;
}
