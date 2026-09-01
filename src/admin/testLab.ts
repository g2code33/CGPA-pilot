// ─────────────────────────────────────────────────────────────────────────
// Admin Calculation Test Lab (Prompt 17)
//
// A deterministic, offline test harness that runs the SAME calculation
// engines the student app uses against FABRICATED test data, compares the
// actual output to an administrator-defined expected value and reports
// PASS/FAIL. It never reads, requires or stores real student data — every
// number here is synthetic and labelled as test data.
//
// Supported measured values:
//   cgpaHistory            weighted CGPA over test semesters (GPA-history mode)
//   cgpaCurrent            current-mode CGPA (baseline CGPA/credits)
//   semesterGpa            semester GPA derived from test course grades
//   classification         label of the classification band for a CGPA
//   requiredFutureGpa      average GPA needed over remaining credits
//   targetStatus           feasibility status id ('achievable', …)
//   maxPossibleFinalCgpa   best-case final CGPA (all remaining at ceiling)
//   whatIfProjectedCgpa    CGPA after a hypothetical future semester
//   whatIfTrajectoryCgpa   final CGPA if the hypothetical GPA is held
//   milestoneGraduationCgpa projected CGPA at graduation for a scenario GPA
//   nextRequiredGpa        GPA required next semester (uniform target path)
//   scoreGradePoints       grade points for a raw score (grade boundary test)
//
// Intermediate values are NEVER rounded: comparison uses full internal
// precision with a tolerance that reflects binary floating-point error only.
// ─────────────────────────────────────────────────────────────────────────

import type {
  ClassificationSystem,
  CurriculumCourse as ConfigCourse,
  CurriculumVersion,
  GradingSystem,
} from '../config/types';
import type { AcademicState, CourseEntry, SemesterEntry } from '../state/studentState';
import { computeSnapshot, weightedCgpa } from '../services/coreCgpaService';
import { gradeFromScore, pointsForGrade, maxGradePoints } from '../services/gradingService';
import { classifyCgpa } from '../services/classificationService';
import { analyzeTarget } from '../services/targetService';
import { maximumFinalCgpa, requiredFutureGpaPrecise } from '../services/coreCgpaService';
import { futureScenario } from '../services/scenarioService';
import { analyzeMilestones } from '../services/milestoneService';
import { nextSemesterAfter, planNextSemester } from '../services/nextSemesterService';
import { curriculumSemesters, progressThrough } from '../services/structureService';

// ── Fabricated test configuration ────────────────────────────────────────

/** Standard UCC-style scale (SYNTHETIC TEST DATA — not a student record). */
export const TEST_GRADING: GradingSystem = {
  id: 'test-ucc-scale',
  name: 'TEST 4.0 scale',
  bands: [
    { grade: 'A', points: 4.0, minScore: 80, maxScore: 100 },
    { grade: 'B+', points: 3.5, minScore: 75, maxScore: 79 },
    { grade: 'B', points: 3.0, minScore: 70, maxScore: 74 },
    { grade: 'C+', points: 2.5, minScore: 65, maxScore: 69 },
    { grade: 'C', points: 2.0, minScore: 60, maxScore: 64 },
    { grade: 'D+', points: 1.5, minScore: 55, maxScore: 59 },
    { grade: 'D', points: 1.0, minScore: 50, maxScore: 54 },
    { grade: 'E', points: 0.0, minScore: 0, maxScore: 49 },
  ],
};

/** UCC-style classification (SYNTHETIC TEST DATA). */
export const TEST_CLASSIFICATION: ClassificationSystem = {
  id: 'test-ucc-classes',
  name: 'TEST classes',
  bands: [
    { id: 'first', label: 'First Class', minCgpa: 3.6, maxCgpa: 4.0, tone: 'gold' },
    { id: '2u', label: 'Second Class Upper', minCgpa: 3.0, maxCgpa: 3.59, tone: 'green' },
    { id: '2l', label: 'Second Class Lower', minCgpa: 2.5, maxCgpa: 2.99, tone: 'blue' },
    { id: 'third', label: 'Third Class', minCgpa: 2.0, maxCgpa: 2.49, tone: 'blue' },
    { id: 'pass', label: 'Pass', minCgpa: 1.0, maxCgpa: 1.99, tone: 'gray' },
  ],
};

export interface TestCurriculumOptions {
  levels?: number;
  creditsPerSemester?: number;
  /** Custom per-semester credit loads, e.g. [18,18,21,15,…] (flattened). */
  credits?: number[];
  versionName?: string;
}

/**
 * Build a fabricated curriculum: `levels` levels × 2 semesters, each carrying
 * placeholder TEST courses whose credit hours total the semester load. This
 * gives `structureService` real credit/slot data without any real courses.
 */
export function buildTestCurriculum(opts: TestCurriculumOptions = {}): CurriculumVersion {
  const levels = opts.levels ?? 4;
  const flat = opts.credits ?? [];
  const defaultLoad = opts.creditsPerSemester ?? 18;

  const semesterCredits = (levelIndex: number, semIndex: number) => {
    const flatIndex = (levelIndex - 1) * 2 + (semIndex - 1);
    return flat[flatIndex] ?? defaultLoad;
  };

  return {
    id: `test-curriculum-${levels}l-${defaultLoad}cr`,
    versionName: opts.versionName ?? `TEST curriculum · ${levels} levels · ${defaultLoad} cr/sem`,
    programmeId: 'test-programme',
    effectiveAcademicYear: '2026/27',
    effectiveDate: '2026-08-31',
    status: 'published',
    levels: Array.from({ length: levels }, (_, li) => {
      const levelIndex = li + 1;
      return {
        index: levelIndex,
        label: `TEST Level ${levelIndex * 100}`,
        semesters: [1, 2].map((semIndex) => {
          const load = semesterCredits(levelIndex, semIndex);
          // One placeholder TEST course carrying the whole semester load.
          const courses: ConfigCourse[] = [
            {
              id: `test-course-${levelIndex}-${semIndex}`,
              code: `TST${levelIndex}${semIndex}0`,
              name: `TEST placeholder course · ${load} credits`,
              creditHours: load,
              level: levelIndex,
              semester: semIndex,
              programmeId: 'test-programme',
              curriculumId: `test-curriculum-${levels}l-${defaultLoad}cr`,
              status: 'active',
              core: true,
            },
          ];
          return {
            index: semIndex,
            label: semIndex === 1 ? 'Semester 1' : 'Semester 2',
            courses,
          };
        }),
      };
    }),
  };
}

// ── Test case model ──────────────────────────────────────────────────────

export type Metric =
  | 'cgpaHistory'
  | 'cgpaCurrent'
  | 'semesterGpa'
  | 'classification'
  | 'requiredFutureGpa'
  | 'targetStatus'
  | 'maxPossibleFinalCgpa'
  | 'whatIfProjectedCgpa'
  | 'whatIfTrajectoryCgpa'
  | 'milestoneGraduationCgpa'
  | 'nextRequiredGpa'
  | 'scoreGradePoints';

export interface TestSemester {
  gpa?: number | null;
  credits?: number;
  pending?: boolean;
  /** Fabricated course grades for course-derived semester GPA tests. */
  courses?: { grade?: string | null; score?: number | null; credits: number; pending?: boolean }[];
}

export interface LabCase {
  id: string;
  name: string;
  category:
    | 'Credit weighting'
    | 'Semester GPA'
    | 'Maximum GPA'
    | 'Minimum GPA'
    | 'Target feasibility'
    | 'Pending results'
    | 'Classification boundaries'
    | 'Rounding'
    | 'Curriculum changes'
    | 'Programme structure'
    | 'What-If'
    | 'Milestones'
    | 'Next-semester planning';
  metric: Metric;

  // Position inputs
  currentCgpa?: number | null;
  completedCredits?: number;
  pendingCredits?: number;
  currentLevel?: number;
  currentSemester?: number;
  semesters?: TestSemester[];

  // Goal / scenario inputs
  targetCgpa?: number;
  futureGpa?: number;
  futureCredits?: number;
  userScenarioGpa?: number;
  score?: number;

  // Curriculum inputs
  curriculum?: CurriculumVersion;
  grading?: GradingSystem;
  classification?: ClassificationSystem;

  // Expected result
  expected: number | string;
  note?: string;
}

export interface LabResult {
  id: string;
  name: string;
  category: LabCase['category'];
  metric: Metric;
  expected: string;
  actual: string;
  pass: boolean;
  detail?: string;
}

const TOL = 1e-6; // floating-point tolerance only — no rounding of intermediates

function n(v: number | null | undefined, digits = 4): string {
  return v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(digits);
}

function makeHistoryState(c: LabCase): AcademicState {
  const semesters: SemesterEntry[] = (c.semesters ?? []).map((s, i) => {
    const level = Math.floor(i / 2) + 1;
    const sem = (i % 2) + 1;
    return {
      id: `test-sem-${i}`,
      label: `TEST L${level * 100} S${sem}`,
      levelIndex: level,
      semesterIndex: sem,
      gpa: s.gpa ?? null,
      creditHoursOverride: s.credits ?? null,
      pending: !!s.pending,
      courses: (s.courses ?? []).map(
        (course, ci): CourseEntry => ({
          id: `test-course-${i}-${ci}`,
          code: `TST${i}${ci}`,
          name: `TEST course ${i}-${ci}`,
          creditHours: course.credits,
          score: course.score ?? null,
          grade: course.grade ?? null,
          pending: !!course.pending,
        })
      ),
    };
  });
  return {
    inputMode: 'history',
    mode: 'history',
    semesters,
    baseline: {
      levelIndex: c.currentLevel ?? 1,
      semesterIndex: c.currentSemester ?? 1,
      cgpa: c.currentCgpa ?? null,
      creditHours: c.completedCredits ?? 0,
      pendingCreditHours: c.pendingCredits ?? 0,
    },
    targetCgpa: c.targetCgpa ?? null,
    plannedNextCreditHours: 18,
  };
}

function makeCurrentState(c: LabCase): AcademicState {
  return {
    inputMode: 'quick',
    mode: 'current',
    semesters: [],
    baseline: {
      levelIndex: c.currentLevel ?? 1,
      semesterIndex: c.currentSemester ?? 1,
      cgpa: c.currentCgpa ?? null,
      creditHours: c.completedCredits ?? 0,
      pendingCreditHours: c.pendingCredits ?? 0,
    },
    targetCgpa: c.targetCgpa ?? null,
    plannedNextCreditHours: c.futureCredits ?? 18,
  };
}

function compare(actual: number | string | null, expected: number | string): { pass: boolean; actual: string; expected: string } {
  if (typeof expected === 'string') {
    const actualStr = actual === null || actual === undefined ? '—' : String(actual);
    return { pass: actualStr === expected, actual: actualStr, expected };
  }
  if (actual === null || actual === undefined || Number.isNaN(actual as number)) {
    return { pass: false, actual: '—', expected: n(expected) };
  }
  return {
    pass: Math.abs((actual as number) - expected) <= TOL,
    actual: n(actual as number),
    expected: n(expected),
  };
}

/** Run a single fabricated test case through the real engines. */
export function runLabCase(c: LabCase): LabResult {
  const grading = c.grading ?? TEST_GRADING;
  const classification = c.classification ?? TEST_CLASSIFICATION;
  const curriculum = c.curriculum;
  const target = c.targetCgpa ?? 3.6;
  const ceiling = maxGradePoints(grading);

  let actual: number | string | null = null;
  let detail: string | undefined;

  const configuredCredits = (li: number, si: number) => {
    if (!curriculum) return 0;
    return (
      curriculumSemesters(curriculum).find(
        (s) => s.levelIndex === li && s.semesterIndex === si
      )?.credits ?? 0
    );
  };

  switch (c.metric) {
    case 'cgpaHistory': {
      const r = weightedCgpa(makeHistoryState(c).semesters, grading, configuredCredits);
      actual = r.cgpa;
      detail = `${r.totalCreditHours} graded credits · ${r.pendingCreditHours} pending`;
      break;
    }
    case 'cgpaCurrent': {
      const snap = computeSnapshot(makeCurrentState(c), grading);
      actual = snap.cgpa;
      detail = `${snap.creditHours} graded credits · ${snap.pendingCreditHours} pending`;
      break;
    }
    case 'semesterGpa': {
      const r = weightedCgpa(makeHistoryState(c).semesters, grading, configuredCredits);
      const term = r.terms[0];
      actual = term?.gpa ?? null;
      detail = term ? `${term.creditHours} credits · ${term.qualityPoints.toFixed(2)} points (source: ${term.source})` : 'no term';
      break;
    }
    case 'classification': {
      const label = classifyCgpa(c.currentCgpa ?? 0, classification)?.label ?? '—';
      actual = label;
      break;
    }
    case 'requiredFutureGpa': {
      const completed = c.completedCredits ?? 0;
      const currentPoints = (c.currentCgpa ?? 0) * completed;
      const remaining = curriculum
        ? progressThrough(curriculum, c.currentLevel ?? 1, c.currentSemester ?? 1).remainingCredits
        : (c.futureCredits ?? 0);
      actual = requiredFutureGpaPrecise(currentPoints, completed, remaining, target);
      detail = `${completed} completed · ${remaining} remaining`;
      break;
    }
    case 'targetStatus': {
      const completed = c.completedCredits ?? 0;
      const currentPoints = (c.currentCgpa ?? 0) * completed;
      const remaining = c.futureCredits ?? 0;
      const a = analyzeTarget(
        { currentPoints, creditsCompleted: completed, creditsRemaining: remaining, targetCgpa: target, currentCgpa: c.currentCgpa ?? null },
        grading,
        classification
      );
      actual = a.status;
      detail = `required ${n(a.requiredFutureGpa)} · ceiling ${n(ceiling)}`;
      break;
    }
    case 'maxPossibleFinalCgpa': {
      const completed = c.completedCredits ?? 0;
      const currentPoints = (c.currentCgpa ?? 0) * completed;
      const remaining = c.futureCredits ?? 0;
      actual = maximumFinalCgpa(currentPoints, completed, remaining, grading);
      break;
    }
    case 'whatIfProjectedCgpa':
    case 'whatIfTrajectoryCgpa': {
      const completed = c.completedCredits ?? 0;
      const currentPoints = (c.currentCgpa ?? 0) * completed;
      const f = futureScenario(
        {
          currentPoints,
          currentCredits: completed,
          currentCgpa: c.currentCgpa ?? null,
          futureCredits: c.futureCredits ?? 18,
          futureGpa: c.futureGpa ?? ceiling,
          remainingCredits: c.futureCredits ?? 18,
          targetCgpa: target,
        },
        grading,
        classification
      );
      actual = c.metric === 'whatIfProjectedCgpa' ? f.projectedCgpa : f.trajectoryFinalCgpa;
      detail = `${f.targetStatusLabel} · Δ ${n(f.differenceFromCurrent)}`;
      break;
    }
    case 'milestoneGraduationCgpa': {
      const completed = c.completedCredits ?? 0;
      const currentPoints = (c.currentCgpa ?? 0) * completed;
      const level = c.currentLevel ?? 1;
      const progress = curriculum
        ? progressThrough(curriculum, level, c.currentSemester ?? 1)
        : { remainingSlots: [], remainingCredits: c.futureCredits ?? 0 };
      const a = analyzeMilestones(
        {
          currentPoints,
          currentCredits: completed,
          currentCgpa: c.currentCgpa ?? null,
          currentLevelIndex: level,
          remainingSlots: progress.remainingSlots,
          targetCgpa: target,
          userGpa: c.userScenarioGpa ?? c.futureGpa ?? ceiling,
          fallbackCreditsPerSemester: c.futureCredits ?? 18,
          fallbackSemesterCount: 6,
        },
        grading,
        classification
      );
      const graduation = a.stages.find((s) => s.isGraduation) ?? a.stages[a.stages.length - 1];
      actual = graduation?.projected.user ?? null;
      detail = graduation ? `${graduation.detail} · ${graduation.creditsRemainingAfter} credits remaining after` : 'no stages';
      break;
    }
    case 'nextRequiredGpa': {
      const completed = c.completedCredits ?? 0;
      const currentPoints = (c.currentCgpa ?? 0) * completed;
      const level = c.currentLevel ?? 1;
      const sem = c.currentSemester ?? 1;
      const next = curriculum ? nextSemesterAfter(curriculum, level, sem) : null;
      const remaining = curriculum
        ? progressThrough(curriculum, level, sem).remainingCredits
        : (c.futureCredits ?? 18);
      const plan = planNextSemester(
        {
          currentPoints,
          currentCredits: completed,
          currentCgpa: c.currentCgpa ?? null,
          remainingCredits: remaining,
          targetCgpa: target,
          next: next ?? {
            levelIndex: level,
            semesterIndex: sem + 1,
            label: 'TEST next semester',
            courses: [],
            credits: c.futureCredits ?? 18,
          },
          fallbackCredits: c.futureCredits ?? 18,
          curriculumPublished: !!curriculum,
        },
        grading,
        classification
      );
      actual = plan.requiredNextGpa;
      detail = `${plan.status} · ${plan.next.credits} next credits`;
      break;
    }
    case 'scoreGradePoints': {
      const grade = gradeFromScore(c.score ?? 0, grading);
      actual = pointsForGrade(grade, grading);
      detail = `score ${c.score} → grade ${grade}`;
      break;
    }
  }

  const cmp = compare(actual, c.expected);
  return {
    id: c.id,
    name: c.name,
    category: c.category,
    metric: c.metric,
    expected: cmp.expected,
    actual: cmp.actual,
    pass: cmp.pass,
    detail,
  };
}

export function runLabSuite(cases: LabCase[]): LabResult[] {
  return cases.map(runLabCase);
}
