import type { CurriculumVersion } from '../types';

// ─────────────────────────────────────────────────────────────────────────
// UCC School of Pharmacy — Doctor of Pharmacy (PharmD) curriculum.
//
// The real course list (codes, titles, credits per level/semester) is
// published by the administrator. Per the product spec we DO NOT invent
// UCC course data, so this version ships in `draft` status with empty
// levels. When the administrator publishes a version (via configuration,
// bundled or fetched), curriculumService will pick it up and cache it.
//
// Structure for a published version:
//   levels: [
//     { index: 1, label: 'Level 100', semesters: [
//         { index: 1, label: 'Semester 1', courses: [
//             { id, code, name, creditHours, level: 1, semester: 1,
//               programmeId: 'ucc-pharmd', curriculumId: <id>,
//               status: 'active', core: true }, … ] }, … ] }, … ]
// ─────────────────────────────────────────────────────────────────────────

export const uccPharmDCurriculum: CurriculumVersion = {
  id: 'ucc-pharmd-draft',
  versionName: 'Draft (awaiting administrator publication)',
  programmeId: 'ucc-pharmd',
  effectiveAcademicYear: '—',
  effectiveDate: '2026-08-31',
  status: 'draft',
  levels: [],
};
