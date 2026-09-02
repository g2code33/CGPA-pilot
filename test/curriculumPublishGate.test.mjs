// ─────────────────────────────────────────────────────────────────────────
// Curriculum publication gate (Prompt 17/18) — a curriculum whose critical
// validation fails MUST NOT be publishable, at BOTH the canPublish() check
// and the transitionCurriculum() service boundary (defense in depth).
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  seedCatalog,
  createCurriculum,
  transitionCurriculum,
  reviewCurriculum,
  canPublish,
  addCourse,
  updateCourse,
} from '../src/admin/adminConfigService.ts';

function freshDraftCurriculum() {
  const seed = seedCatalog();
  const programmeId = seed.universities[0].schools[0].programmes[0].id;
  const catalog = createCurriculum(seed, programmeId, {
    versionName: 'TEST Gate Curriculum',
    effectiveAcademicYear: '2026/27',
    effectiveDate: '2026-08-31',
  });
  const created = catalog.curricula.find((c) => c.versionName === 'TEST Gate Curriculum');
  return { catalog, id: created.id };
}

/** Add one course and fill it with the given values. */
function addFilledCourse(catalog, id, values) {
  const next = addCourse(catalog, id, 1, 1);
  const version = next.curricula.find((c) => c.id === id);
  const course = version.levels.find((l) => l.index === 1).semesters.find((s) => s.index === 1).courses.slice(-1)[0];
  return updateCourse(next, id, 1, 1, course.id, {
    code: values.code,
    name: values.name,
    creditHours: values.creditHours,
    core: values.core ?? true,
  });
}

test('an empty draft (scaffold, no courses) fails critical validation', () => {
  const { catalog, id } = freshDraftCurriculum();
  const version = catalog.curricula.find((c) => c.id === id);
  const errors = reviewCurriculum(version).filter((i) => i.severity === 'error');
  assert.ok(errors.length > 0, 'empty scaffold must have blocking errors');
  assert.ok(errors.some((e) => /No courses entered/i.test(e.message)));
  assert.equal(canPublish(version), false);
});

test('transitionCurriculum refuses review→published when validation fails', () => {
  let { catalog, id } = freshDraftCurriculum();
  let r = transitionCurriculum(catalog, id, 'review');
  assert.equal(r.ok, true);
  catalog = r.catalog;
  // Service-layer block: no critical-invalid curriculum can ever publish.
  r = transitionCurriculum(catalog, id, 'published');
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /critical validation/i);
  const after = r.catalog.curricula.find((c) => c.id === id);
  assert.equal(after.status, 'review');
});

test('a curriculum with a valid course can be published', () => {
  let { catalog, id } = freshDraftCurriculum();
  catalog = addFilledCourse(catalog, id, { code: 'TST101', name: 'TEST Valid Course', creditHours: 3 });
  let r = transitionCurriculum(catalog, id, 'review');
  assert.equal(r.ok, true, r.reason);
  catalog = r.catalog;
  r = transitionCurriculum(catalog, id, 'published');
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.catalog.curricula.find((c) => c.id === id).status, 'published');
});

test('a zero-credit course is a critical error that blocks publish', () => {
  let { catalog, id } = freshDraftCurriculum();
  catalog = addFilledCourse(catalog, id, { code: 'TST000', name: 'TEST Bad Course', creditHours: 0 });
  const version = catalog.curricula.find((c) => c.id === id);
  const errors = reviewCurriculum(version).filter((i) => i.severity === 'error');
  assert.ok(errors.some((e) => /invalid credits/i.test(e.message)));
  assert.equal(canPublish(version), false);
});

test('duplicate course codes are critical errors', () => {
  let { catalog, id } = freshDraftCurriculum();
  catalog = addFilledCourse(catalog, id, { code: 'DUP101', name: 'One', creditHours: 2 });
  catalog = addFilledCourse(catalog, id, { code: 'DUP101', name: 'Two', creditHours: 2 });
  const errors = reviewCurriculum(catalog.curricula.find((c) => c.id === id))
    .filter((i) => i.severity === 'error');
  assert.ok(errors.some((e) => /Duplicate course code/i.test(e.message)));
});
