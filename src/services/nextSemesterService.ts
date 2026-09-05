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

/** Build a combo from per-course band indices (bands ordered best→worst). */
function comboFromIndices(
  courses: NextCourse[],
  bandsDesc: Band[],
  bandIndex: number[]
): { key: string; assignments: GradeAssignment[]; totalPoints: number; semesterGpa: number } {
  const assignments: GradeAssignment[] = courses.map((c, i) => {
    const band = bandsDesc[bandIndex[i]];
    return { code: c.code, name: c.name, creditHours: c.creditHours, grade: band.grade, points: band.points };
  });
  const totalPoints = assignments.reduce((s, a) => s + a.points * a.creditHours, 0);
  const credits = courses.reduce((s, c) => s + c.creditHours, 0);
  return {
    key: assignments.map((a) => a.grade).join('|'),
    assignments,
    totalPoints,
    semesterGpa: credits > 0 ? totalPoints / credits : 0,
  };
}

/**
 * Repeat single-band upgrades until the required points are met.
 * `preferLow` upgrades the LOWEST-credit courses first (spreads the hard
 * grades onto the small courses); otherwise the highest-credit first.
 */
function upgradeUntil(
  courses: NextCourse[],
  bandsDesc: Band[],
  start: number[],
  required: number,
  preferLow: boolean
): number[] {
  const idx = [...start];
  const total = () => idx.reduce((s, bi, i) => s + courses[i].creditHours * bandsDesc[bi].points, 0);
  let guard = 0;
  while (total() < required - 1e-9 && guard++ < 1000) {
    const movable = idx
      .map((bi, i) => ({ bi, i }))
      .filter((x) => x.bi > 0)
      .sort((a, b) =>
        preferLow
          ? courses[a.i].creditHours - courses[b.i].creditHours
          : courses[b.i].creditHours - courses[a.i].creditHours
      );
    if (movable.length === 0) break;
    idx[movable[0].i] = movable[0].bi - 1;
  }
  return idx;
}

/**
 * The full set of SMART alternative plans for the same required points —
 * every distinct, valid way of shaping the grades that the engine knows:
 *
 *   1. Credit-focused  — strongest grades on the highest-credit courses
 *      (the lightest plan that still clears).
 *   2. Small-course focused — the tougher grades parked on the smallest
 *      courses so the big ones stay easy.
 *   3. Balanced — every course at (or just above) the required average.
 *   4. Uniform — one single grade in every course, the weakest that clears.
 *   5. Cushion — the required plan plus a small safety margin.
 *   6. A randomized valid mix (fresh variety every call).
 *
 * Identical results are de-duplicated; every returned combo clears the
 * required points. The view cycles through these as the student reshuffles.
 */
export function smartReshuffles(
  courses: NextCourse[],
  grading: GradingSystem,
  requiredPoints: number
): ShuffledCombo[] {
  if (courses.length === 0) return [];
  const bandsDesc: Band[] = [...grading.bands]
    .sort((a, b) => b.points - a.points)
    .map((b) => ({ grade: b.grade, points: b.points }));
  const n = courses.length;
  const credits = courses.reduce((s, c) => s + c.creditHours, 0);
  const required = Math.max(0, requiredPoints);
  const lowest = bandsDesc.length - 1;
  const maxTotal = credits * bandsDesc[0].points;
  const rPerCredit = credits > 0 ? required / credits : 0;

  const variants: number[][] = [
    // 1. Credit-focused (strongest on the big courses).
    upgradeUntil(courses, bandsDesc, Array(n).fill(lowest), required, false),
    // 2. Small-course focused (tough grades on the small courses).
    upgradeUntil(courses, bandsDesc, Array(n).fill(lowest), required, true),
    // 3. Balanced (weakest band meeting the average, then top up on big courses).
    (() => {
      const bi = bandsDesc.findIndex((b) => b.points >= rPerCredit - 1e-9);
      const start = bi === -1 ? Array(n).fill(0) : Array(n).fill(bi);
      return upgradeUntil(courses, bandsDesc, start, required, false);
    })(),
    // 4. Uniform (one grade everywhere, weakest that clears).
    (() => {
      const bi = bandsDesc.findIndex((b) => b.points * credits >= required - 1e-9);
      return bi === -1 ? null : Array(n).fill(bi);
    })(),
    // 5. Cushion (required + 4% safety margin, credit-focused).
    required > 0
      ? upgradeUntil(courses, bandsDesc, Array(n).fill(lowest), Math.min(required * 1.04, maxTotal), false)
      : null,
  ].filter((v): v is number[] => v !== null);

  const seen = new Set<string>();
  const out: ShuffledCombo[] = [];
  for (const idx of variants) {
    const built = comboFromIndices(courses, bandsDesc, idx);
    if (seen.has(built.key)) continue;
    if (built.totalPoints < required - 1e-9) continue;
    seen.add(built.key);
    out.push({ ...built, clears: true });
  }
  return out;
}

/**
 * Produce a RANDOM-but-valid alternative target-grade mix for the same
 * required points (used once the smart set is exhausted, for endless
 * variety). Same courses, same credits, never under the required points.
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
