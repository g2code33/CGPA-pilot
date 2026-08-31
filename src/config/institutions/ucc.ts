import type { University } from '../types';
import { uccPharmDCurriculum } from '../curricula/ucc-pharmd';

// ─────────────────────────────────────────────────────────────────────────
// University of Cape Coast (UCC) — School of Pharmacy — Doctor of Pharmacy
//
// Grading system & degree classification published by UCC:
//   https://ucc.edu.gh/main/applicants-and-students/grading-system
// Course curricula are NOT invented: the PharmD curriculum version below is
// held in `draft` status with an empty course list until the administrator
// publishes the real level/semester/course data.
// ─────────────────────────────────────────────────────────────────────────

export const ucc: University = {
  id: 'ucc',
  name: 'University of Cape Coast',
  shortName: 'UCC',
  country: 'Ghana',
  gradingSystemId: 'ucc-standard',
  classificationSystemId: 'ucc-undergraduate',

  gradingSystem: {
    id: 'ucc-standard',
    name: 'UCC Standard Undergraduate Grading',
    bands: [
      { grade: 'A', minScore: 80, maxScore: 100, points: 4.0, interpretation: 'Excellent' },
      { grade: 'B+', minScore: 75, maxScore: 79, points: 3.5, interpretation: 'Very Good' },
      { grade: 'B', minScore: 70, maxScore: 74, points: 3.0, interpretation: 'Good' },
      { grade: 'C+', minScore: 65, maxScore: 69, points: 2.5, interpretation: 'Average' },
      { grade: 'C', minScore: 60, maxScore: 64, points: 2.0, interpretation: 'Fair' },
      { grade: 'D+', minScore: 55, maxScore: 59, points: 1.5, interpretation: 'Barely Satisfactory' },
      { grade: 'D', minScore: 50, maxScore: 54, points: 1.0, interpretation: 'Weak Pass' },
      { grade: 'E', minScore: 0, maxScore: 49, points: 0.0, interpretation: 'Fail' },
    ],
  },

  classificationSystem: {
    id: 'ucc-undergraduate',
    name: 'UCC Degree Classification',
    graduationMinCgpa: 1.0,
    bands: [
      { id: 'first', label: 'First Class', minCgpa: 3.6, maxCgpa: 4.0, tone: 'gold' },
      { id: 'second-upper', label: 'Second Class (Upper Division)', minCgpa: 3.0, maxCgpa: 3.59, tone: 'green' },
      { id: 'second-lower', label: 'Second Class (Lower Division)', minCgpa: 2.5, maxCgpa: 2.99, tone: 'teal' },
      { id: 'third', label: 'Third Class Division', minCgpa: 2.0, maxCgpa: 2.49, tone: 'blue' },
      { id: 'pass', label: 'Pass', minCgpa: 1.0, maxCgpa: 1.99, tone: 'gray' },
      { id: 'fail', label: 'Below graduation requirement', minCgpa: 0, maxCgpa: 0.99, tone: 'red' },
    ],
  },

  schools: [
    {
      id: 'ucc-school-of-pharmacy',
      name: 'School of Pharmacy',
      universityId: 'ucc',
      programmes: [
        {
          id: 'ucc-pharmd',
          name: 'Doctor of Pharmacy',
          shortName: 'PharmD',
          schoolId: 'ucc-school-of-pharmacy',
          duration: {
            years: 6,
            expectedLevels: 6,
            label: '6-year professional doctorate',
          },
          curriculumVersionIds: [uccPharmDCurriculum.id],
        },
      ],
    },
  ],
};
