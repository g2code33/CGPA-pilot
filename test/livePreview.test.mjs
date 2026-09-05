// ─────────────────────────────────────────────────────────────────────────
// Live student preview pipeline (admin → student side):
//
//   working AdminCatalog → buildDistribution (same code the backend
//   publishing uses) → setRuntimeCatalog (in-memory ONLY) → the student
//   accessors see exactly the working changes (new course, changed band,
//   branding) and ONLY the PUBLISHED curricula.
//
//   Also: the injection is reversible — restoring the previous runtime
//   catalog brings the app back to what it ran under before the preview.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeValidCatalog } from './helpers/fixtures.mjs';
import { buildDistribution } from '../src/admin/catalogPublish.ts';
import {
  getRuntimeCatalog,
  isRuntimeCatalogSet,
  seedRuntimeCatalog,
  setRuntimeCatalog,
} from '../src/config/runtime.ts';
import {
  getActiveCurriculum,
  getUniversity,
  listUniversities,
} from '../src/services/curriculumService.ts';

const CTX = { universityId: 'uni-1', schoolId: 'sch-1', programmeId: 'prog-1' };

function inject(working) {
  const dist = buildDistribution(working);
  setRuntimeCatalog({
    universities: dist.universities,
    curricula: dist.curricula,
    appearance: dist.appearance,
    settings: dist.settings,
    version: null,
    updatedAt: null,
    cachedAt: new Date().toISOString(),
    source: 'local',
  });
}

test('working catalog changes are visible to the student accessors', () => {
  const working = makeValidCatalog();
  // Student-visible changes:
  working.universities[0].name = 'Renamed University';
  working.universities[0].gradingSystem.bands[1].minScore = 45;
  const courses = working.curricula[0].levels[0].semesters[0].courses;
  courses.push({
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
  working.appearance = { appName: 'Preview Pilot', tagline: 'seen in preview' };

  const wasSet = isRuntimeCatalogSet();
  const previous = wasSet ? getRuntimeCatalog() : null;
  try {
    inject(working);

    // University-level change is live for students.
    assert.equal(listUniversities().length, 1);
    assert.equal(getUniversity('uni-1').name, 'Renamed University');
    assert.equal(getUniversity('uni-1').gradingSystem.bands[1].minScore, 45);

    // The active (published) curriculum carries the NEW course.
    const active = getActiveCurriculum(CTX);
    assert.ok(active);
    const courseCodes = active.levels[0].semesters[0].courses.map((c) => c.code);
    assert.ok(courseCodes.includes('TST99'));

    // Branding rides along.
    assert.equal(getRuntimeCatalog().appearance.appName, 'Preview Pilot');
  } finally {
    if (previous) setRuntimeCatalog(previous);
  }
});

test('draft curricula are NEVER part of the student preview', () => {
  const working = makeValidCatalog({ addDraft: true });
  assert.equal(working.curricula.length, 2);

  const wasSet = isRuntimeCatalogSet();
  const previous = wasSet ? getRuntimeCatalog() : null;
  try {
    inject(working);
    const curricula = getRuntimeCatalog().curricula;
    assert.equal(curricula.length, 1); // draft filtered out by buildDistribution
    assert.equal(curricula[0].status, 'published');
    const active = getActiveCurriculum(CTX);
    assert.ok(active);
    assert.equal(active.id, 'cur-pub');
  } finally {
    if (previous) setRuntimeCatalog(previous);
  }
});

test('the distribution is a deep clone — editing the working catalog later does not leak into the preview snapshot', () => {
  const working = makeValidCatalog();
  const dist = buildDistribution(working);
  working.universities[0].name = 'MUTATED AFTER BUILD';
  assert.equal(dist.universities[0].name, 'Test University');
  working.curricula[0].versionName = 'MUTATED CURRICULUM';
  assert.equal(dist.curricula[0].versionName, 'Test Curriculum 2026/27');
});

test('restoring the previous runtime catalog returns the app to its pre-preview state', () => {
  // Simulate the app already running under a (seed) catalog.
  const running = seedRuntimeCatalog();
  setRuntimeCatalog(running);

  const working = makeValidCatalog();
  working.universities[0].name = 'Preview Only Name';
  inject(working);
  assert.equal(getRuntimeCatalog().universities[0].name, 'Preview Only Name');

  // Preview closed → restore.
  setRuntimeCatalog(running);
  assert.equal(getRuntimeCatalog().universities[0].name, running.universities[0].name);
  assert.notEqual(getRuntimeCatalog().universities[0].name, 'Preview Only Name');
});
