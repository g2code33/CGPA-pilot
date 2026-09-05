// ─────────────────────────────────────────────────────────────────────────
// catalogDiff — the "accurate deployment" review engine:
//   • identical catalogs → empty report
//   • added / removed universities + curricula detected
//   • field-level changes reported with paths + before/after
//   • course-level added / removed / modified (matched by code)
//   • appearance + settings diffs
//   • id-based array matching (reorder = not a change)
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeValidCatalog } from './helpers/fixtures.mjs';
import { diffCatalogs, deepFieldChanges, humanizePath } from '../src/admin/catalogDiff.ts';

test('identical catalogs → empty report (no changes to review)', () => {
  const a = makeValidCatalog();
  const b = JSON.parse(JSON.stringify(a));
  const r = diffCatalogs(a, b);
  assert.equal(r.isEmpty, true);
  assert.equal(r.totalChanges, 0);
  assert.equal(r.summary, 'No changes');
});

test('null/undefined sides are treated as empty (fresh publish = everything added)', () => {
  const b = makeValidCatalog();
  const r = diffCatalogs(null, b);
  assert.equal(r.isEmpty, false);
  assert.equal(r.universities.length, 1);
  assert.equal(r.universities[0].kind, 'added');
  assert.equal(r.curricula.length, 1);
  assert.equal(r.curricula[0].kind, 'added');
});

test('renamed university is a changed entity with a field change', () => {
  const a = makeValidCatalog();
  const b = makeValidCatalog();
  b.universities[0].name = 'Renamed University';
  const r = diffCatalogs(a, b);
  assert.equal(r.universities.length, 1);
  assert.equal(r.universities[0].kind, 'changed');
  assert.ok(r.universities[0].changes.some((c) => c.path === 'name' && c.after === 'Renamed University'));
});

test('added + removed curriculum versions', () => {
  const a = makeValidCatalog();
  const b = makeValidCatalog();
  b.curricula.push({ ...b.curricula[0], id: 'cur-new', versionName: 'Brand New 2027/28', status: 'published' });
  a.curricula.push({ ...a.curricula[0], id: 'cur-gone', versionName: 'Old Version', status: 'archived' });
  const r = diffCatalogs(a, b);
  const added = r.curricula.find((c) => c.id === 'cur-new');
  const removed = r.curricula.find((c) => c.id === 'cur-gone');
  assert.equal(added.kind, 'added');
  assert.equal(removed.kind, 'removed');
  assert.equal(r.curricula.length, 2);
});

test('course added / removed / modified are matched by code', () => {
  const a = makeValidCatalog();
  const b = makeValidCatalog();
  // modify an existing course (credits + name)
  b.curricula[0].levels[0].semesters[0].courses[0].creditHours = 4;
  b.curricula[0].levels[0].semesters[0].courses[0].name = 'Renamed Course';
  // remove course 2
  b.curricula[0].levels[0].semesters[0].courses.splice(1, 1);
  // add a new course
  b.curricula[0].levels[0].semesters[0].courses.push({
    id: 'crs-new',
    code: 'TST99',
    name: 'New Course',
    creditHours: 2,
    level: 1,
    semester: 1,
    programmeId: 'prog-1',
    curriculumId: 'cur-pub',
    status: 'active',
    core: true,
  });
  const r = diffCatalogs(a, b);
  assert.equal(r.curricula.length, 1);
  const e = r.curricula[0];
  assert.equal(e.kind, 'changed');
  assert.equal(e.courses.added.length, 1);
  assert.equal(e.courses.added[0].code, 'TST99');
  assert.equal(e.courses.removed.length, 1);
  assert.equal(e.courses.removed[0].code, 'TST12');
  assert.equal(e.courses.changed.length, 1);
  assert.equal(e.courses.changed[0].course.code, 'TST11');
  assert.ok(e.courses.changed[0].changes.some((c) => c.path === 'course.creditHours' && c.before === 3 && c.after === 4));
});

test('curriculum status transition is reported (draft → published)', () => {
  const a = makeValidCatalog();
  const b = makeValidCatalog();
  b.curricula[0].status = 'draft';
  const r = diffCatalogs(b, a);
  assert.equal(r.curricula[0].status.before, 'draft');
  assert.equal(r.curricula[0].status.after, 'published');
});

test('appearance changes (branding) are reported incl. logo', () => {
  const a = makeValidCatalog();
  const b = makeValidCatalog();
  b.appearance = { appName: 'CGPA Pilot', logo: 'data:image/png;base64,AAA', tagline: 'Navigate your future' };
  const r = diffCatalogs(a, b);
  assert.ok(r.appearance.length > 0);
  assert.ok(r.appearance.some((c) => c.path === 'logo' && c.kind === 'added'));
  assert.equal(r.totalChanges >= 3, true);
});

test('settings changes are reported', () => {
  const a = makeValidCatalog();
  const b = makeValidCatalog();
  b.settings = { allowWhatIf: false };
  const r = diffCatalogs(a, b);
  assert.equal(r.settings.length, 1);
  assert.equal(r.settings[0].path, 'allowWhatIf');
  assert.equal(r.settings[0].after, false);
});

test('reordering an id-bearing array is NOT a change', () => {
  const before = { items: [{ id: 'a', v: 1 }, { id: 'b', v: 2 }] };
  const after = { items: [{ id: 'b', v: 2 }, { id: 'a', v: 1 }] };
  assert.equal(deepFieldChanges(before, after).length, 0);
});

test('index array (no ids) reports element changes by position', () => {
  const before = { list: [1, 2, 3] };
  const after = { list: [1, 9, 3] };
  const ch = deepFieldChanges(before, after);
  assert.equal(ch.length, 1);
  assert.equal(ch[0].path, 'list[1]');
  assert.equal(ch[0].before, 2);
  assert.equal(ch[0].after, 9);
});

test('humanizePath renders readable breadcrumbs', () => {
  const h = humanizePath('schools[0].programmes[1].name');
  assert.match(h, /Schools/);
  assert.match(h, /Item 0/);
  assert.match(h, /Programmes/);
  assert.match(h, /Name$/);
});
