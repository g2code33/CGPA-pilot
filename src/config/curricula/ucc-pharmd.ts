import type { CurriculumLevel, CurriculumVersion } from '../types';

// ─────────────────────────────────────────────────────────────────────────
// UCC School of Pharmacy — Doctor of Pharmacy (PharmD) initial curriculum.
//
// Structure only (Levels 100–600, two semesters each). Course names, codes
// and credit hours are deliberately EMPTY until the administrator enters
// verified curriculum data — CGPA PILOT invents no course information.
// This ships as a DRAFT scaffold; it becomes available to students only
// after the admin reviews and publishes it.
// ─────────────────────────────────────────────────────────────────────────

function scaffoldLevels(): CurriculumLevel[] {
  const levels: CurriculumLevel[] = [];
  for (let n = 1; n <= 6; n++) {
    levels.push({
      index: n,
      label: `Level ${n * 100}`,
      semesters: [
        { index: 1, label: 'Semester 1', courses: [] },
        { index: 2, label: 'Semester 2', courses: [] },
      ],
    });
  }
  return levels;
}

export const uccPharmDCurriculum: CurriculumVersion = {
  id: 'ucc-pharmd-scaffold',
  versionName: 'Initial scaffold (awaiting verified course data)',
  programmeId: 'ucc-pharmd',
  effectiveAcademicYear: '—',
  effectiveDate: '2026-08-31',
  status: 'draft',
  levels: scaffoldLevels(),
};
