// ─────────────────────────────────────────────────────────────────────────
// Whole-curriculum single-file import (the six-year PharmD JSON contract):
//   { program, levels: [{ level: "Level 100", semesters | cycles: [{
//     semester | cycle, courses: [{code,title,T,P,C}], total_credits }] }] }
// Level 600 uses "cycles"; combined elective codes must be split; HTML
// entities in titles must be decoded.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { importCoursesFile } from '../src/admin/importService.ts';
import { expandCombinedCodes } from '../src/admin/adminConfigService.ts';

function jsonFile(payload, name = 'curriculum.json') {
  return new File([JSON.stringify(payload)], name, { type: 'application/json' });
}

const fullCurriculum = {
  program: 'PharmD New Curriculum Structure',
  levels: [
    {
      level: 'Level 100',
      semesters: [
        {
          semester: '1st semester',
          total_credits: 18,
          courses: [
            { code: 'PHM101', title: 'Human Anatomy I', T: 2, P: 0, C: 2 },
            { code: 'PHM102', title: 'Human Anatomy I (Practical)', T: 0, P: 1, C: 1 },
          ],
        },
        {
          semester: '2nd semester',
          total_credits: 20,
          courses: [
            { code: 'PHM103', title: 'Drugs &amp; Society', T: 3, P: 0, C: 3 },
          ],
        },
      ],
    },
    {
      level: 'Level 600',
      cycles: [
        {
          cycle: 'Cycle one',
          total_credits: 28,
          courses: [
            { code: 'PHM601', title: 'Clinical Clerkship', T: 4, P: 8, C: 12 },
          ],
        },
        {
          cycle: 'Cycle two',
          total_credits: 8,
          courses: [
            { code: 'PHM608, 610, 612, 614', title: 'Elective I (pick one)', T: 2, P: 0, C: 2 },
            { code: 'PHM609/611/613/615', title: 'Elective II (pick one)', T: 2, P: 0, C: 2 },
          ],
        },
      ],
    },
  ],
};

test('structured JSON: levels sorted, cycles mapped to level slots', async () => {
  const r = await importCoursesFile(jsonFile(fullCurriculum));
  assert.equal(r.format, 'json');
  assert.equal(r.program, 'PharmD New Curriculum Structure');
  // Levels sorted even though input order put 100 then 600.
  assert.deepEqual(r.levels.map((l) => l.levelIndex), [1, 6]);
  const l600 = r.levels.find((l) => l.levelIndex === 6);
  assert.ok(l600, 'Level 600 present');
  // Cycles become the two semester slots (period 1 and 2).
  assert.deepEqual(l600.semesters.map((s) => s.semesterIndex), [1, 2]);
  assert.match(l600.semesters[0].label, /cycle one/i);
});

test('structured JSON: total_credits captured per period', async () => {
  const r = await importCoursesFile(jsonFile(fullCurriculum));
  const totals = r.levels
    .flatMap((l) => l.semesters)
    .map((s) => s.totalCredits);
  assert.deepEqual(totals, [18, 20, 28, 8]);
});

test('structured JSON: credits come from C; HTML entities decoded in titles', async () => {
  const r = await importCoursesFile(jsonFile(fullCurriculum));
  const l100s1 = r.semesters.find((s) => s.levelIndex === 1 && s.semesterIndex === 1);
  const anatomy = l100s1.rows.find((c) => c.code === 'PHM101');
  assert.equal(anatomy.creditHours, 2);
  const l100s2 = r.semesters.find((s) => s.levelIndex === 1 && s.semesterIndex === 2);
  const society = l100s2.rows.find((c) => c.code === 'PHM103');
  assert.equal(society.name, 'Drugs & Society');
});

test('structured JSON: C missing → credits fall back to T + P', async () => {
  const data = {
    levels: [
      {
        level: 'Level 200',
        semesters: [
          { semester: '1st semester', courses: [{ code: 'PHM201', title: 'Lab', T: 1, P: 2 }] },
        ],
      },
    ],
  };
  const r = await importCoursesFile(jsonFile(data));
  assert.equal(r.semesters[0].rows[0].creditHours, 3);
});

test('expandCombinedCodes: comma and slash combined electives expand with prefix', () => {
  assert.deepEqual(
    expandCombinedCodes('PHM608, 610, 612, 614'),
    ['PHM608', 'PHM610', 'PHM612', 'PHM614']
  );
  assert.deepEqual(
    expandCombinedCodes('PHM609/611/613/615'),
    ['PHM609', 'PHM611', 'PHM613', 'PHM615']
  );
});

test('expandCombinedCodes: plain codes pass through', () => {
  assert.deepEqual(expandCombinedCodes('PHM101'), ['PHM101']);
  assert.deepEqual(expandCombinedCodes('ASP'), ['ASP']);
});
