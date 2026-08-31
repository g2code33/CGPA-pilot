import type { University } from '../types';

// ─────────────────────────────────────────────────────────────────────────
// University of Cape Coast (UCC)
// Source for grading scale & degree classification:
//   https://ucc.edu.gh/main/applicants-and-students/grading-system
// School of Pharmacy · Doctor of Pharmacy (PharmD)
//
// NOTE: course lists per level/semester are NOT published here. The
// administrator configures the real curriculum (codes, titles, credits) in a
// later prompt — the student app never fabricates UCC course information.
// ─────────────────────────────────────────────────────────────────────────

export const ucc: University = {
  id: 'ucc',
  name: 'University of Cape Coast',
  shortName: 'UCC',
  country: 'Ghana',

  gradingScale: {
    id: 'ucc-standard',
    name: 'UCC Standard Undergraduate Scale',
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

  classification: {
    id: 'ucc-undergraduate',
    scaleName: 'UCC Degree Classification',
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
      id: 'ucc-pharmacy',
      name: 'School of Pharmacy',
      programmes: [
        {
          id: 'ucc-pharmacy-pharmd',
          name: 'Doctor of Pharmacy',
          shortName: 'PharmD',
          expectedLevels: 6,
          curricula: [
            {
              id: 'ucc-pharmd-current',
              label: 'Current curriculum',
              // Deliberately empty: the administrator publishes the real
              // level/semester/course structure. No UCC courses are invented.
              levels: [],
            },
          ],
        },
      ],
    },
  ],
};
