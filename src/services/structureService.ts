// ─────────────────────────────────────────────────────────────────────────
// structureService — reads the CONFIGURED curriculum's academic structure
// (levels → semesters → credit loads) so calculations use the real, published
// credit hours rather than assumptions. Fully offline/config-driven.
// ─────────────────────────────────────────────────────────────────────────

import type { CurriculumVersion, CurriculumCourse } from '../config/types';

export interface SemesterSlot {
  levelIndex: number; // 1-based
  levelLabel: string;
  semesterIndex: number; // 1-based within the level
  label: string; // e.g. "Level 100 · Semester 1"
  credits: number; // total active credit hours configured for the semester
  courseCount: number;
}

function slotKey(levelIndex: number, semesterIndex: number): number {
  return levelIndex * 100 + semesterIndex;
}

/** Flatten the curriculum into ordered semester slots with their credit loads. */
export function curriculumSemesters(
  curriculum?: CurriculumVersion
): SemesterSlot[] {
  if (!curriculum) return [];
  const slots: SemesterSlot[] = [];
  for (const level of curriculum.levels) {
    for (const sem of level.semesters) {
      const active = sem.courses.filter((c) => c.status === 'active');
      slots.push({
        levelIndex: level.index,
        levelLabel: level.label,
        semesterIndex: sem.index,
        label: `${level.label} · ${sem.label}`,
        credits: active.reduce((sum, c) => sum + (c.creditHours || 0), 0),
        courseCount: active.length,
      });
    }
  }
  return slots.sort((a, b) => slotKey(a.levelIndex, a.semesterIndex) - slotKey(b.levelIndex, b.semesterIndex));
}

/** Configured credit hours for one specific semester (0 if not published). */
export function semesterCredits(
  curriculum: CurriculumVersion | undefined,
  levelIndex: number,
  semesterIndex: number
): number {
  return (
    curriculumSemesters(curriculum).find(
      (s) => s.levelIndex === levelIndex && s.semesterIndex === semesterIndex
    )?.credits ?? 0
  );
}

/** Active courses configured for one specific semester ([] if none published). */
export function curriculumSemesterCourses(
  curriculum: CurriculumVersion | undefined,
  levelIndex: number,
  semesterIndex: number
): CurriculumCourse[] {
  if (!curriculum) return [];
  const level = curriculum.levels.find((l) => l.index === levelIndex);
  const sem = level?.semesters.find((s) => s.index === semesterIndex);
  return (sem?.courses ?? []).filter((c) => c.status === 'active');
}

export function totalProgrammeCredits(curriculum?: CurriculumVersion): number {
  return curriculumSemesters(curriculum).reduce((sum, s) => sum + s.credits, 0);
}

export interface CurriculumProgress {
  completedSlots: SemesterSlot[];
  remainingSlots: SemesterSlot[];
  completedCredits: number;
  remainingCredits: number;
  totalCredits: number;
  /** True when the curriculum actually carries credit data for these slots. */
  hasCreditData: boolean;
}

/**
 * Split the curriculum into completed vs remaining at the student's current
 * point. "Completed through Level `level`, Semester `semester`" means every
 * slot up to and including that one is done.
 */
export function progressThrough(
  curriculum: CurriculumVersion | undefined,
  completedLevel: number,
  completedSemester: number
): CurriculumProgress {
  const slots = curriculumSemesters(curriculum);
  const throughKey = slotKey(completedLevel, completedSemester);
  const completedSlots = slots.filter(
    (s) => slotKey(s.levelIndex, s.semesterIndex) <= throughKey
  );
  const remainingSlots = slots.filter(
    (s) => slotKey(s.levelIndex, s.semesterIndex) > throughKey
  );
  const completedCredits = completedSlots.reduce((sum, s) => sum + s.credits, 0);
  const remainingCredits = remainingSlots.reduce((sum, s) => sum + s.credits, 0);
  return {
    completedSlots,
    remainingSlots,
    completedCredits,
    remainingCredits,
    totalCredits: completedCredits + remainingCredits,
    hasCreditData: slots.some((s) => s.credits > 0),
  };
}
