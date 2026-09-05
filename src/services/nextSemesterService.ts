// ─────────────────────────────────────────────────────────────────────────
// NEXT SEMESTER PILOT service (Prompt 12)
//
// Works out what the student must achieve in the IMMEDIATE next semester to
// stay on track for their target: the required next-semester GPA, the target
// classification, and mathematically-derived per-course target grades from
// the configured grading system and course credit hours. Grade combinations
// are planning targets, never predicted grades. All math is credit-weighted,
// full precision, config-driven and offline.
// ─────────────────────────────────────────────────────────────────────────

import type {
  CurriculumVersion,
  GradingSystem,
  ClassificationSystem,
} from '../config/types';
import { classifyCgpa } from './classificationService';
import { maxGradePoints, pointsForGrade } from './gradingService';

export interface NextCourse {
  code: string;
  name: string;
  creditHours: number;
}

export interface NextSemesterInfo {
  levelIndex: number;
  semesterIndex: number;
  label: string;
  courses: NextCourse[];
  credits: number;
}

/** The semester immediately after the student's current/last position. */
export function nextSemesterAfter(
  curriculum: CurriculumVersion | undefined,
  levelIndex: number,
  semesterIndex: number
): NextSemesterInfo {
  const nextLevel = semesterIndex >= 2 ? levelIndex + 1 : levelIndex;
  const nextSem = semesterIndex >= 2 ? 1 : semesterIndex + 1;

  const level = curriculum?.levels.find((l) => l.index === nextLevel);
  const sem = level?.semesters.find((s) => s.index === nextSem);
  const courses: NextCourse[] =
    sem?.courses
      .filter((c) => c.status === 'active')
      .map((c) => ({
        code: c.code,
        name: c.name,
        creditHours: c.creditHours || 0,
      })) ?? [];

  return {
    levelIndex: nextLevel,
    semesterIndex: nextSem,
    label: `Level ${nextLevel * 100} — Semester ${nextSem}`,
    courses,
    credits: courses.reduce((s, c) => s + c.creditHours, 0),
  };
}

export interface GradeAssignment {
  code: string;
  name: string;
  creditHours: number;
  grade: string;
  points: number;
}

export interface GradeCombo {
  id: 'efficient' | 'balanced' | 'top';
  label: string;
  description: string;
  assignments: GradeAssignment[];
  totalPoints: number;
  semesterGpa: number;
  /** True if the combination clears the required points. */
  clears: boolean;
}

export type MissionStatus =
  | 'on-track'
  | 'already-above'
  | 'impossible'
  | 'no-data';

export interface NextSemesterPlan {
  next: NextSemesterInfo;
  targetCgpa: number;
  targetClassLabel: string;
  /** GPA required in the next semester to stay on the uniform target path. */
  requiredNextGpa: number | null;
  /** Quality points required from the next semester. */
  requiredNextPoints: number | null;
  /** Ceiling average achievable next semester. */
  maxNextGpa: number;
  /** Cumulative CGPA if the required next GPA is achieved. */
  projectedCgpaAfter: number | null;
  status: MissionStatus;
  combos: GradeCombo[];
  curriculumPublished: boolean;
}

interface PlanInput {
  currentPoints: number;
  currentCredits: number;
  currentCgpa: number | null;
  /** Credits remaining to graduation (including the next semester). */
  remainingCredits: number;
  targetCgpa: number;
  next: NextSemesterInfo;
  /** Fallback credit load when the curriculum has no next-semester courses. */
  fallbackCredits: number;
  curriculumPublished: boolean;
}

interface Band {
  grade: string;
  points: number;
}

/**
 * Minimum-effort grade combination: start every course at the lowest band and
 * upgrade high-credit courses first until the required points are cleared.
 * Returns the assignments, total points and whether the target is reachable.
 */
function minimalCombo(
  courses: NextCourse[],
  bandsDesc: Band[],
  requiredPoints: number
): { assignments: { course: NextCourse; bandIndex: number }[]; total: number; clears: boolean } {
  const lowest = bandsDesc.length - 1;
  const assign: { course: NextCourse; bandIndex: number }[] = courses.map((course) => ({
    course,
    bandIndex: lowest,
  }));
  let total = assign.reduce(
    (s, a) => s + a.course.creditHours * bandsDesc[a.bandIndex].points,
    0
  );
  while (total < requiredPoints - 1e-9) {
    const cands = assign.filter((a) => a.bandIndex > 0);
    if (cands.length === 0) break;
    // Upgrade the highest-credit course that can still move up a band.
    cands.sort((a, b) => b.course.creditHours - a.course.creditHours);
    const pick = cands[0];
    const before = bandsDesc[pick.bandIndex].points;
    pick.bandIndex -= 1;
    const after = bandsDesc[pick.bandIndex].points;
    total += pick.course.creditHours * (after - before);
  }
  return { assignments: assign, total, clears: total >= requiredPoints - 1e-9 };
}

function toCombo(
  id: GradeCombo['id'],
  label: string,
  description: string,
  courses: NextCourse[],
  bandsDesc: Band[],
  pickBand: (c: NextCourse) => number
): GradeCombo {
  const assignments: GradeAssignment[] = courses.map((c) => {
    const bi = pickBand(c);
    const band = bandsDesc[bi];
    return {
      code: c.code,
      name: c.name,
      creditHours: c.creditHours,
      grade: band.grade,
      points: band.points,
    };
  });
  const totalPoints = assignments.reduce((s, a) => s + a.points * a.creditHours, 0);
  const credits = courses.reduce((s, c) => s + c.creditHours, 0);
  return {
    id,
    label,
    description,
    assignments,
    totalPoints,
    semesterGpa: credits > 0 ? totalPoints / credits : 0,
    clears: false, // set by caller against required points
  };
}

export function planNextSemester(
  input: PlanInput,
  grading: GradingSystem,
  classification: ClassificationSystem
): NextSemesterPlan {
  const max = maxGradePoints(grading);
  const bandsDesc: Band[] = [...grading.bands]
    .sort((a, b) => b.points - a.points)
    .map((b) => ({ grade: b.grade, points: b.points }));

  // Next-semester courses: prefer the configured curriculum; otherwise a
  // single unnamed block at the fallback credit load so planning still works.
  const courses: NextCourse[] =
    input.next.courses.length > 0
      ? input.next.courses
      : [{ code: 'Semester', name: 'Curriculum not published', creditHours: input.fallbackCredits }];
  const nextCredits = courses.reduce((s, c) => s + c.creditHours, 0);

  const targetClass = classifyCgpa(input.targetCgpa, classification);

  const base: Omit<NextSemesterPlan, 'requiredNextGpa' | 'requiredNextPoints' | 'maxNextGpa' | 'projectedCgpaAfter' | 'status' | 'combos'> = {
    next: { ...input.next, courses, credits: nextCredits },
    targetCgpa: input.targetCgpa,
    targetClassLabel: targetClass?.label ?? 'your target',
    curriculumPublished: input.curriculumPublished,
  };

  if (input.currentCgpa === null || input.remainingCredits <= 0) {
    return {
      ...base,
      requiredNextGpa: null,
      requiredNextPoints: null,
      maxNextGpa: max,
      projectedCgpaAfter: null,
      status: 'no-data',
      combos: [],
    };
  }

  const totalCredits = input.currentCredits + input.remainingCredits;
  // Uniform required future average to hit the target.
  const requiredFutureGpa =
    (input.targetCgpa * totalCredits - input.currentPoints) / input.remainingCredits;

  const requiredNextGpa = Math.min(max, Math.max(0, requiredFutureGpa));
  const requiredNextPoints = requiredNextGpa * nextCredits;

  const projectedCgpaAfter =
    (input.currentPoints + requiredNextGpa * nextCredits) /
    (input.currentCredits + nextCredits);

  let status: MissionStatus;
  if (requiredFutureGpa <= 1e-9) status = 'already-above';
  else if (requiredFutureGpa > max + 1e-9) status = 'impossible';
  else status = 'on-track';

  // ── Build target-grade combinations ───────────────────────────────────
  const makeCombos = (
    courseList: NextCourse[],
    requiredPoints: number
  ): GradeCombo[] => {
    const efficient = minimalCombo(courseList, bandsDesc, requiredPoints);
    const rPerCredit =
      courseList.reduce((s, c) => s + c.creditHours, 0) > 0
        ? requiredPoints / courseList.reduce((s, c) => s + c.creditHours, 0)
        : 0;

    const eff = toCombo(
      'efficient',
      'Focused plan',
      'Put your strongest grades on the highest-credit courses — the lightest combination that still clears the target.',
      courseList,
      bandsDesc,
      (c) => efficient.assignments.find((a) => a.course === c)!.bandIndex
    );
    const bal = toCombo(
      'balanced',
      'Balanced plan',
      'Aim every course at or above the required average.',
      courseList,
      bandsDesc,
      () => {
        // Weakest band whose points still meet the required per-credit average.
        let idx = bandsDesc.length - 1;
        for (let i = 0; i < bandsDesc.length; i++) {
          if (bandsDesc[i].points >= rPerCredit - 1e-9) idx = i;
        }
        return idx;
      }
    );
    const top = toCombo(
      'top',
      'Maximum cushion',
      'Top grade in every course — the strongest safety margin.',
      courseList,
      bandsDesc,
      () => 0
    );

    for (const combo of [eff, bal, top]) combo.clears = combo.totalPoints >= requiredPoints - 1e-9;
    // De-duplicate identical grade strings.
    const seen = new Set<string>();
    return [eff, bal, top].filter((c) => {
      const key = c.assignments.map((a) => a.grade).join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const combos =
    status === 'impossible'
      ? []
      : makeCombos(courses, Math.max(0, requiredNextPoints));

  return {
    ...base,
    requiredNextGpa,
    requiredNextPoints,
    maxNextGpa: max,
    projectedCgpaAfter,
    status,
    combos,
  };
}

/**
 * Resolve a "What if I get <grade> in this course?" override: lock the chosen
 * grades and solve the lightest combination for the remaining courses.
 */
export function whatIfGrades(
  courses: NextCourse[],
  locked: Record<string, string>,
  grading: GradingSystem,
  requiredNextPoints: number
): {
  lockedPoints: number;
  lockedCredits: number;
  remaining: NextCourse[];
  remainingRequiredPoints: number;
  assignments: GradeAssignment[];
  totalPoints: number;
  semesterGpa: number;
  clears: boolean;
} {
  const totalCredits = courses.reduce((s, c) => s + c.creditHours, 0);
  const lockedAssignments: GradeAssignment[] = [];
  const remaining: NextCourse[] = [];
  let lockedPoints = 0;
  let lockedCredits = 0;

  for (const c of courses) {
    const g = locked[c.code];
    if (g) {
      const pts = pointsForGrade(g, grading) ?? 0;
      lockedAssignments.push({
        code: c.code,
        name: c.name,
        creditHours: c.creditHours,
        grade: g,
        points: pts,
      });
      lockedPoints += pts * c.creditHours;
      lockedCredits += c.creditHours;
    } else {
      remaining.push(c);
    }
  }

  const remainingRequired = Math.max(0, requiredNextPoints - lockedPoints);
  const bandsDesc: Band[] = [...grading.bands]
    .sort((a, b) => b.points - a.points)
    .map((b) => ({ grade: b.grade, points: b.points }));
  const solved = minimalCombo(remaining, bandsDesc, remainingRequired);

  const remainingAssignments: GradeAssignment[] = remaining.map((c) => {
    const bi = solved.assignments.find((a) => a.course === c)!.bandIndex;
    const band = bandsDesc[bi];
    return {
      code: c.code,
      name: c.name,
      creditHours: c.creditHours,
      grade: band.grade,
      points: band.points,
    };
  });

  const assignments = [...lockedAssignments, ...remainingAssignments];
  const totalPoints =
    lockedPoints +
    remainingAssignments.reduce((s, a) => s + a.points * a.creditHours, 0);

  return {
    lockedPoints,
    lockedCredits,
    remaining,
    remainingRequiredPoints: remainingRequired,
    assignments,
    totalPoints,
    semesterGpa: totalCredits > 0 ? totalPoints / totalCredits : 0,
    clears: totalPoints >= requiredNextPoints - 1e-9,
  };
}

/** One reshuffled (random-but-valid) grade combination. */
export interface ShuffledCombo {
  assignments: GradeAssignment[];
  totalPoints: number;
  semesterGpa: number;
  clears: boolean;
}

/**
 * Produce an ALTERNATIVE target-grade mix for the same required points.
 *
 * Starts from the guaranteed minimal combination (the lightest one that
 * clears the required points), then applies a handful of random single-band
 * upgrades — so every result is a valid plan: same courses, same credits,
 * never under the required points, but a different shape of grades. The
 * view keeps a history of these so the student can undo / redo reshuffles.
 */
export function reshufflePlan(
  courses: NextCourse[],
  grading: GradingSystem,
  requiredPoints: number
): ShuffledCombo | null {
  if (courses.length === 0) return null;
  const bandsDesc: Band[] = [...grading.bands]
    .sort((a, b) => b.points - a.points)
    .map((b) => ({ grade: b.grade, points: b.points }));
  const base = minimalCombo(courses, bandsDesc, Math.max(0, requiredPoints));
  const required = Math.max(0, requiredPoints);
  const totalAt = () =>
    base.assignments.reduce(
      (s, a) => s + a.course.creditHours * bandsDesc[a.bandIndex].points,
      0
    );
  // Upgrade up to half the courses (at least one) at random for variety.
  const upgrades = Math.max(1, Math.round(courses.length / 2));
  let applied = 0;
  let guard = 0;
  while (applied < upgrades && guard++ < 200) {
    const pick = base.assignments[Math.floor(Math.random() * base.assignments.length)];
    if (pick.bandIndex > 0) {
      pick.bandIndex -= 1;
      applied++;
    }
  }
  // Redistributing swap (keeps the total at/above the required points): bump
  // one course up a band and another down a band. This keeps reshuffles from
  // converging when the required average is close to the ceiling.
  let swapGuard = 0;
  while (swapGuard++ < 100) {
    const i = Math.floor(Math.random() * base.assignments.length);
    const j = Math.floor(Math.random() * base.assignments.length);
    if (i === j) continue;
    const up = base.assignments[i];
    const down = base.assignments[j];
    if (up.bandIndex === 0 || down.bandIndex === bandsDesc.length - 1) continue;
    const gain =
      up.course.creditHours *
      (bandsDesc[up.bandIndex - 1].points - bandsDesc[up.bandIndex].points);
    const loss =
      down.course.creditHours *
      (bandsDesc[down.bandIndex].points - bandsDesc[down.bandIndex + 1].points);
    if (totalAt() + gain - loss < required - 1e-9) continue;
    up.bandIndex -= 1;
    down.bandIndex += 1;
    break;
  }
  const assignments: GradeAssignment[] = courses.map((c, i) => {
    const band = bandsDesc[base.assignments[i].bandIndex];
    return {
      code: c.code,
      name: c.name,
      creditHours: c.creditHours,
      grade: band.grade,
      points: band.points,
    };
  });
  const totalPoints = assignments.reduce((s, a) => s + a.points * a.creditHours, 0);
  const credits = courses.reduce((s, c) => s + c.creditHours, 0);
  return {
    assignments,
    totalPoints,
    semesterGpa: credits > 0 ? totalPoints / credits : 0,
    clears: totalPoints >= Math.max(0, requiredPoints) - 1e-9,
  };
}
