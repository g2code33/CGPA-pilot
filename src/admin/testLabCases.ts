// ─────────────────────────────────────────────────────────────────────────
// Built-in TEST LAB suite (Prompt 17).
//
// EVERY value below is FABRICATED TEST DATA — no real student information is
// used, implied or required. Expected results were hand-computed from the
// documented UCC-style test scale (A=4.00 … E=0.00; First ≥3.60, 2:1 ≥3.00,
// 2:2 ≥2.50, 3rd ≥2.00, Pass ≥1.00) using credit weighting at FULL precision.
// ─────────────────────────────────────────────────────────────────────────

import type { LabCase } from './testLab';
import {
  buildTestCurriculum,
  TEST_GRADING,
  TEST_CLASSIFICATION,
} from './testLab';

/** Standard fabricated 4-level, 18-credits-per-semester curriculum. */
const CURR_4L_18 = buildTestCurriculum({ levels: 4, creditsPerSemester: 18 });
/** A fabricated 6-level structure (PharmD-style length). */
const CURR_6L_18 = buildTestCurriculum({ levels: 6, creditsPerSemester: 18 });
/** Fabricated curriculum with mixed credit loads (different structure). */
const CURR_MIXED = buildTestCurriculum({
  levels: 4,
  credits: [16, 16, 18, 18, 21, 21, 15, 18],
});

const G = TEST_GRADING;
const C = TEST_CLASSIFICATION;

export const BUILTIN_TEST_CASES: LabCase[] = [
  // ── Credit weighting ──────────────────────────────────────────────────
  {
    id: 'weight-01',
    name: 'Weighted history CGPA (two equal 18-cr semesters, 3.0 & 3.5)',
    category: 'Credit weighting',
    metric: 'cgpaHistory',
    semesters: [
      { gpa: 3.0, credits: 18 },
      { gpa: 3.5, credits: 18 },
    ],
    grading: G, classification: C,
    expected: 3.25,
    note: '(3.0·18 + 3.5·18) / 36 = 3.25 — semesters are NOT simply averaged.',
  },
  {
    id: 'weight-02',
    name: 'Unequal credit loads must weight the heavier semester',
    category: 'Credit weighting',
    metric: 'cgpaHistory',
    semesters: [
      { gpa: 2.0, credits: 10 },
      { gpa: 4.0, credits: 30 },
    ],
    grading: G, classification: C,
    expected: 3.5,
    note: '(2.0·10 + 4.0·30) / 40 = 140/40 = 3.50.',
  },
  {
    id: 'weight-03',
    name: 'Three different loads (15 / 21 / 18 credits)',
    category: 'Credit weighting',
    metric: 'cgpaHistory',
    semesters: [
      { gpa: 2.5, credits: 15 },
      { gpa: 3.5, credits: 21 },
      { gpa: 4.0, credits: 18 },
    ],
    grading: G, classification: C,
    // points: 37.5 + 73.5 + 72 = 183; credits: 54 → 3.388888…
    expected: 183 / 54,
    note: '183 quality points over 54 credits = 3.3889 (intermediate precision kept).',
  },

  // ── Semester GPA (course-derived) ─────────────────────────────────────
  {
    id: 'semgpa-01',
    name: 'Course-derived semester GPA: one A (4cr) + one B (2cr)',
    category: 'Semester GPA',
    metric: 'semesterGpa',
    semesters: [
      {
        courses: [
          { grade: 'A', credits: 4 },
          { grade: 'B', credits: 2 },
        ],
      },
    ],
    grading: G, classification: C,
    expected: (4.0 * 4 + 3.0 * 2) / 6,
    note: '22 points over 6 credits = 3.6667.',
  },
  {
    id: 'semgpa-02',
    name: 'Score-derived semester GPA: 80→A (3cr) + 70→B (3cr)',
    category: 'Semester GPA',
    metric: 'semesterGpa',
    semesters: [
      {
        courses: [
          { score: 80, credits: 3 },
          { score: 70, credits: 3 },
        ],
      },
    ],
    grading: G, classification: C,
    expected: 3.5,
    note: 'Score boundaries: 80 = A (4.00), 70 = B (3.00) → 21/6 = 3.50.',
  },

  // ── Maximum GPA ───────────────────────────────────────────────────────
  {
    id: 'max-01',
    name: 'Maximum final CGPA with straight ceiling from 3.00',
    category: 'Maximum GPA',
    metric: 'maxPossibleFinalCgpa',
    currentCgpa: 3.0, completedCredits: 36, futureCredits: 108,
    grading: G, classification: C,
    expected: (3.0 * 36 + 4.0 * 108) / 144,
    note: '(108 + 432) / 144 = 3.75 best possible finish.',
  },
  {
    id: 'max-02',
    name: 'Maximum grade points: score 100 is 4.00',
    category: 'Maximum GPA',
    metric: 'scoreGradePoints',
    score: 100,
    grading: G, classification: C,
    expected: 4.0,
  },
  {
    id: 'max-03',
    name: 'Maximum grade points: score 80 (A boundary) is 4.00',
    category: 'Maximum GPA',
    metric: 'scoreGradePoints',
    score: 80,
    grading: G, classification: C,
    expected: 4.0,
    note: 'Lower A boundary must still award 4.00.',
  },

  // ── Minimum GPA ───────────────────────────────────────────────────────
  {
    id: 'min-01',
    name: 'Minimum grade points: score 49 (E boundary) is 0.00',
    category: 'Minimum GPA',
    metric: 'scoreGradePoints',
    score: 49,
    grading: G, classification: C,
    expected: 0.0,
  },
  {
    id: 'min-02',
    name: 'Minimum grade points: score 0 is 0.00',
    category: 'Minimum GPA',
    metric: 'scoreGradePoints',
    score: 0,
    grading: G, classification: C,
    expected: 0.0,
  },
  {
    id: 'min-03',
    name: 'Minimum (fail-band) semester holds CGPA below pass',
    category: 'Minimum GPA',
    metric: 'cgpaHistory',
    semesters: [
      { gpa: 0.0, credits: 18 },
      { gpa: 1.0, credits: 18 },
    ],
    grading: G, classification: C,
    expected: 0.5,
    note: '(0 + 18)/36 = 0.50.',
  },

  // ── Target feasibility ────────────────────────────────────────────────
  {
    id: 'target-01',
    name: 'Required future GPA: 3.00 → 3.60 over 108 remaining is impossible',
    category: 'Target feasibility',
    metric: 'requiredFutureGpa',
    currentCgpa: 3.0, completedCredits: 36, currentLevel: 1, currentSemester: 2,
    targetCgpa: 3.6, curriculum: CURR_4L_18,
    grading: G, classification: C,
    // (3.6·144 − 3.0·36)/108 = (518.4−108)/108 = 410.4/108 = 3.8
    expected: 3.8,
    note: 'Required 3.80 sits above the 3.75 tier — mathematically possible but extremely demanding.',
  },
  {
    id: 'target-02',
    name: 'Feasibility tier: required ~4.33 (target 4.00) → impossible',
    category: 'Target feasibility',
    metric: 'targetStatus',
    currentCgpa: 3.0, completedCredits: 36, futureCredits: 108,
    targetCgpa: 4.0,
    grading: G, classification: C,
    expected: 'impossible',
  },
  {
    id: 'target-03',
    name: 'Required future GPA: 3.25 → 3.60 over 108 remaining',
    category: 'Target feasibility',
    metric: 'requiredFutureGpa',
    currentCgpa: 3.25, completedCredits: 36, currentLevel: 1, currentSemester: 2,
    targetCgpa: 3.6, curriculum: CURR_4L_18,
    grading: G, classification: C,
    // (3.6·144 − 3.25·36)/108 = (518.4−117)/108 = 401.4/108 = 3.7167
    expected: 401.4 / 108,
  },
  {
    id: 'target-04',
    name: 'Feasibility tier: required 3.80 → extremely-demanding',
    category: 'Target feasibility',
    metric: 'targetStatus',
    currentCgpa: 3.3, completedCredits: 72, futureCredits: 108,
    targetCgpa: 3.6,
    grading: G, classification: C,
    expected: 'extremely-demanding',
    note: '(3.6·180 − 3.3·72)/108 = (648−237.6)/108 = 3.80, above the 3.75 orange tier.',
  },
  {
    id: 'target-05',
    name: 'Feasibility tier: required ~3.625 → very-demanding',
    category: 'Target feasibility',
    metric: 'targetStatus',
    currentCgpa: 3.55, completedCredits: 72, futureCredits: 108,
    targetCgpa: 3.6,
    grading: G, classification: C,
    expected: 'very-demanding',
    note: '(648 − 255.6)/108 = 3.6333, between 3.50 and 3.75.',
  },
  {
    id: 'target-06',
    name: 'Feasibility tier: required ~3.35 → achievable',
    category: 'Target feasibility',
    metric: 'targetStatus',
    currentCgpa: 3.2, completedCredits: 36, futureCredits: 18,
    targetCgpa: 3.25,
    grading: G, classification: C,
    expected: 'achievable',
    note: '(3.25·54 − 3.2·36)/18 = (175.5−115.2)/18 = 3.35 ≤ 3.50 green tier.',
  },
  {
    id: 'target-07',
    name: 'Target already achieved → met',
    category: 'Target feasibility',
    metric: 'targetStatus',
    currentCgpa: 3.7, completedCredits: 126, futureCredits: 18,
    targetCgpa: 3.6,
    grading: G, classification: C,
    expected: 'met',
  },
  {
    id: 'target-08',
    name: 'Required GPA edge: exactly 3.50 still achievable (boundary)',
    category: 'Target feasibility',
    metric: 'targetStatus',
    currentCgpa: 3.0, completedCredits: 72, futureCredits: 36,
    targetCgpa: (3.0 * 72 + 3.5 * 36) / 108, // 3.1667 final
    grading: G, classification: C,
    expected: 'achievable',
    note: 'Constructed so required future GPA is exactly the 3.50 green tier.',
  },

  // ── Pending results ───────────────────────────────────────────────────
  {
    id: 'pending-01',
    name: 'Pending whole semester excluded from confirmed CGPA',
    category: 'Pending results',
    metric: 'cgpaHistory',
    semesters: [
      { gpa: 3.0, credits: 18 },
      { gpa: 3.8, credits: 18, pending: true },
    ],
    grading: G, classification: C,
    expected: 3.0,
    note: 'The 3.80 term is unreleased: confirmed CGPA stays 3.00; its 18 credits are tracked separately as pending.',
  },
  {
    id: 'pending-02',
    name: 'Pending individual course excluded, graded courses still count',
    category: 'Pending results',
    metric: 'semesterGpa',
    semesters: [
      {
        courses: [
          { grade: 'A', credits: 3 },
          { grade: 'C', credits: 3, pending: true },
        ],
      },
    ],
    grading: G, classification: C,
    expected: 4.0,
    note: 'Only the released A counts toward the confirmed semester GPA.',
  },
  {
    id: 'pending-03',
    name: 'Current-mode pending credits excluded from completed total',
    category: 'Pending results',
    metric: 'cgpaCurrent',
    currentCgpa: 3.2, completedCredits: 54, pendingCredits: 18,
    grading: G, classification: C,
    expected: 3.2,
    note: 'Reported CGPA is over released results only (36 credits); 18 pending credits do not alter it.',
  },

  // ── Classification boundaries ─────────────────────────────────────────
  {
    id: 'class-01',
    name: 'Boundary: 3.60 exactly = First Class',
    category: 'Classification boundaries',
    metric: 'classification',
    currentCgpa: 3.6,
    grading: G, classification: C,
    expected: 'First Class',
  },
  {
    id: 'class-02',
    name: 'Boundary: 3.59 = Second Class Upper (not First)',
    category: 'Classification boundaries',
    metric: 'classification',
    currentCgpa: 3.59,
    grading: G, classification: C,
    expected: 'Second Class Upper',
  },
  {
    id: 'class-03',
    name: 'Boundary: 3.00 exactly = Second Class Upper',
    category: 'Classification boundaries',
    metric: 'classification',
    currentCgpa: 3.0,
    grading: G, classification: C,
    expected: 'Second Class Upper',
  },
  {
    id: 'class-04',
    name: 'Boundary: 2.99 = Second Class Lower',
    category: 'Classification boundaries',
    metric: 'classification',
    currentCgpa: 2.99,
    grading: G, classification: C,
    expected: 'Second Class Lower',
  },
  {
    id: 'class-05',
    name: 'Boundary: 2.50 exactly = Second Class Lower',
    category: 'Classification boundaries',
    metric: 'classification',
    currentCgpa: 2.5,
    grading: G, classification: C,
    expected: 'Second Class Lower',
  },
  {
    id: 'class-06',
    name: 'Boundary: 2.49 = Third Class',
    category: 'Classification boundaries',
    metric: 'classification',
    currentCgpa: 2.49,
    grading: G, classification: C,
    expected: 'Third Class',
  },
  {
    id: 'class-07',
    name: 'Boundary: 2.00 exactly = Third Class',
    category: 'Classification boundaries',
    metric: 'classification',
    currentCgpa: 2.0,
    grading: G, classification: C,
    expected: 'Third Class',
  },
  {
    id: 'class-08',
    name: 'Boundary: 1.00 exactly = Pass',
    category: 'Classification boundaries',
    metric: 'classification',
    currentCgpa: 1.0,
    grading: G, classification: C,
    expected: 'Pass',
  },

  // ── Rounding / full precision ─────────────────────────────────────────
  {
    id: 'round-01',
    name: 'No intermediate rounding: 3.3888… is kept precise (history)',
    category: 'Rounding',
    metric: 'cgpaHistory',
    semesters: [
      { gpa: 3.3, credits: 10 },
      { gpa: 3.4, credits: 44 },
    ],
    grading: G, classification: C,
    // 33 + 149.6 = 182.6 over 54 = 3.381481…
    expected: 182.6 / 54,
    note: 'Rounding happens only for display; the engine keeps the full value.',
  },
  {
    id: 'round-02',
    name: 'Score boundary 79 → B+ (3.50), 75 → B+ (3.50)',
    category: 'Rounding',
    metric: 'scoreGradePoints',
    score: 79,
    grading: G, classification: C,
    expected: 3.5,
  },
  {
    id: 'round-03',
    name: 'Score boundary 54 → D (1.00), 50 → D (1.00)',
    category: 'Rounding',
    metric: 'scoreGradePoints',
    score: 50,
    grading: G, classification: C,
    expected: 1.0,
  },

  // ── Curriculum changes ────────────────────────────────────────────────
  {
    id: 'curr-01',
    name: 'Curriculum credit load drives required GPA (4-level · 18cr = 144 total)',
    category: 'Curriculum changes',
    metric: 'requiredFutureGpa',
    currentCgpa: 3.0, completedCredits: 36, currentLevel: 1, currentSemester: 2,
    targetCgpa: 3.6, curriculum: CURR_4L_18,
    grading: G, classification: C,
    expected: 3.8,
  },
  {
    id: 'curr-02',
    name: '6-level programme (216 cr total) changes the required GPA',
    category: 'Curriculum changes',
    metric: 'requiredFutureGpa',
    currentCgpa: 3.0, completedCredits: 36, currentLevel: 1, currentSemester: 2,
    targetCgpa: 3.6, curriculum: CURR_6L_18,
    grading: G, classification: C,
    // (3.6·216 − 108)/180 = (777.6−108)/180 = 669.6/180 = 3.72
    expected: 3.72,
  },
  {
    id: 'curr-03',
    name: 'Required GPA feasibility follows the 6-level structure',
    category: 'Curriculum changes',
    metric: 'targetStatus',
    currentCgpa: 3.0, completedCredits: 36, futureCredits: 180,
    targetCgpa: 3.6,
    grading: G, classification: C,
    expected: 'very-demanding',
    note: 'Required 3.72 sits in the 3.50–3.75 tier — feasible but demanding.',
  },
  {
    id: 'curr-04',
    name: 'Mixed per-semester loads feed the remaining-credit total',
    category: 'Programme structure',
    metric: 'requiredFutureGpa',
    currentCgpa: 3.0, completedCredits: 16, currentLevel: 1, currentSemester: 1,
    targetCgpa: 3.5, curriculum: CURR_MIXED,
    grading: G, classification: C,
    // total = 143; remaining after L100S1 = 127 → (3.5·143 − 48)/127 = 452.5/127
    expected: 452.5 / 127,
    note: 'TEST loads [16,16,18,18,21,21,15,18] total 143 credits.',
  },

  // ── What-If scenarios ─────────────────────────────────────────────────
  {
    id: 'whatif-01',
    name: 'What-If projected CGPA: 3.00 + a 4.00 semester (36→54 credits)',
    category: 'What-If',
    metric: 'whatIfProjectedCgpa',
    currentCgpa: 3.0, completedCredits: 36, futureGpa: 4.0, futureCredits: 18,
    targetCgpa: 3.6,
    grading: G, classification: C,
    expected: (3.0 * 36 + 4.0 * 18) / 54,
    note: '= 180/54 = 3.3333.',
  },
  {
    id: 'whatif-02',
    name: 'What-If held-average trajectory: 3.00 holding 3.80 to graduation',
    category: 'What-If',
    metric: 'whatIfTrajectoryCgpa',
    currentCgpa: 3.0, completedCredits: 36, futureGpa: 3.8, futureCredits: 108,
    targetCgpa: 3.6,
    grading: G, classification: C,
    expected: (3.0 * 36 + 3.8 * 108) / 144,
    note: '= (108 + 410.4)/144 = 3.60 — exactly reaches the target.',
  },

  // ── Milestones ───────────────────────────────────────────────────────
  {
    id: 'milestone-01',
    name: 'Milestone graduation projection at a flat scenario GPA of 4.00',
    category: 'Milestones',
    metric: 'milestoneGraduationCgpa',
    currentCgpa: 3.0, completedCredits: 36, currentLevel: 1, currentSemester: 2,
    targetCgpa: 3.6, userScenarioGpa: 4.0, curriculum: CURR_4L_18,
    grading: G, classification: C,
    expected: (3.0 * 36 + 4.0 * 108) / 144,
    note: 'Straight ceiling from 3.00 over the remaining slots finishes 3.75.',
  },
  {
    id: 'milestone-02',
    name: 'Milestone graduation projection at a flat scenario GPA of 3.50',
    category: 'Milestones',
    metric: 'milestoneGraduationCgpa',
    currentCgpa: 3.0, completedCredits: 36, currentLevel: 1, currentSemester: 2,
    targetCgpa: 3.6, userScenarioGpa: 3.5, curriculum: CURR_4L_18,
    grading: G, classification: C,
    expected: (3.0 * 36 + 3.5 * 108) / 144,
    note: '= (108 + 378)/144 = 3.375.',
  },

  // ── Next-semester planning ────────────────────────────────────────────
  {
    id: 'next-01',
    name: 'Required next-semester GPA clamps at the ceiling when impossible (target 4.00)',
    category: 'Next-semester planning',
    metric: 'nextRequiredGpa',
    currentCgpa: 3.0, completedCredits: 36, currentLevel: 1, currentSemester: 2,
    targetCgpa: 4.0, futureCredits: 18, curriculum: CURR_4L_18,
    grading: G, classification: C,
    expected: 4.0,
    note: 'Uniform required average is 4.33 (> 4.00 ceiling): the planner clamps next GPA to 4.00 and flags status impossible.',
  },
  {
    id: 'next-02',
    name: 'Required next-semester GPA on a reachable target (6-level)',
    category: 'Next-semester planning',
    metric: 'nextRequiredGpa',
    currentCgpa: 3.0, completedCredits: 36, currentLevel: 1, currentSemester: 2,
    targetCgpa: 3.6, futureCredits: 18, curriculum: CURR_6L_18,
    grading: G, classification: C,
    expected: 3.72,
    note: 'Clamped above zero; the planner shows the 3.72 average needed next.',
  },
];
