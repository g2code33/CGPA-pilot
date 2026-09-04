// ─────────────────────────────────────────────────────────────────────────
// catalogValidation — the shared validation rules (client + Worker) and the
// distribution builder. Guarantees: a valid catalog passes, every kind of
// corruption is caught, the committed seed is a valid bootstrap, and
// distribution documents contain ONLY published curricula.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCatalogStructure,
  validateDistributionDocument,
  validateAdminCatalogForPublish,
  validateAppearance,
} from '../src/admin/catalogValidation.ts';
import { buildDistribution } from '../src/admin/catalogPublish.ts';
import { seedCatalog } from '../src/admin/adminConfigService.ts';
import { makeValidCatalog, makeDistributionPayload } from './helpers/fixtures.mjs';

test('a structurally valid admin catalog passes', () => {
  const r = validateCatalogStructure(makeValidCatalog());
  assert.equal(r.ok, true, r.issues.join(' · '));
});

test('the committed seed catalog is a valid bootstrap', () => {
  const seed = seedCatalog();
  const r = validateCatalogStructure(seed);
  assert.equal(r.ok, true, r.issues.join(' · '));
});

test('the seed builds a valid (possibly empty-published) distribution document', () => {
  const seed = seedCatalog();
  const doc = buildDistribution(seed);
  const r = validateDistributionDocument(doc);
  assert.equal(r.ok, true, r.issues.join(' · '));
});

test('buildDistribution includes ONLY published curricula', () => {
  const catalog = makeValidCatalog({ addDraft: true });
  const doc = buildDistribution(catalog);
  assert.equal(doc.curricula.length, 1);
  assert.equal(doc.curricula[0].id, 'cur-pub');
  assert.ok(doc.curricula.every((c) => c.status === 'published'));
  assert.equal(doc.format, 'cgpa-pilot-curriculum');
  assert.equal(doc.schemaVersion, 1);
});

test('an empty university list is rejected', () => {
  const r = validateCatalogStructure({ universities: [], curricula: [] });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /at least one university/i.test(i)));
});

test('duplicate university ids are rejected', () => {
  const catalog = makeValidCatalog();
  catalog.universities.push(JSON.parse(JSON.stringify(catalog.universities[0])));
  const r = validateCatalogStructure(catalog);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /duplicate university id/i.test(i)));
});

test('a curriculum referencing an unknown programme is rejected', () => {
  const r = validateCatalogStructure(makeValidCatalog({ orphanCurriculum: true }));
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /unknown programme/i.test(i)));
});

test('a course with zero credits is a structural error', () => {
  const catalog = makeValidCatalog();
  const course = catalog.curricula[0].levels[0].semesters[0].courses[0];
  course.creditHours = 0;
  const r = validateCatalogStructure(catalog);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /credit hours/i.test(i)));
});

test('a course placed in the wrong level/semester is rejected', () => {
  const catalog = makeValidCatalog();
  const course = catalog.curricula[0].levels[0].semesters[0].courses[0];
  course.level = 99;
  const r = validateCatalogStructure(catalog);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /level/i.test(i)));
});

test('a PUBLISHED curriculum with duplicate codes blocks the publish gate', () => {
  const r = validateAdminCatalogForPublish(makeValidCatalog({ duplicateCode: true }));
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /duplicate course code/i.test(i)));
});

test('a PUBLISHED curriculum with a missing course name blocks the publish gate', () => {
  const r = validateAdminCatalogForPublish(makeValidCatalog({ missingCourseName: true }));
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /missing its name/i.test(i)));
});

test('draft curricula are exempt from the per-curriculum publish gate', () => {
  const r = validateAdminCatalogForPublish(makeValidCatalog({ addDraft: true }));
  assert.equal(r.ok, true, r.issues.join(' · '));
});

test('distribution documents require the exact wire format', () => {
  const doc = makeDistributionPayload();
  doc.format = 'something-else';
  assert.equal(validateDistributionDocument(doc).ok, false);
  doc.format = 'cgpa-pilot-curriculum';
  doc.schemaVersion = 99;
  assert.equal(validateDistributionDocument(doc).ok, false);
});

test('a distribution document containing a non-published curriculum is rejected', () => {
  const catalog = makeValidCatalog({ addDraft: true });
  const doc = {
    format: 'cgpa-pilot-curriculum',
    schemaVersion: 1,
    generatedAt: '2026-09-04T00:00:00.000Z',
    universities: catalog.universities,
    curricula: catalog.curricula, // includes the draft!
  };
  const r = validateDistributionDocument(doc);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /only contain published/i.test(i)));
});

test('a malformed appearance block is rejected', () => {
  const issues = [];
  validateAppearance({ icons: { plane: { image: 'data:...' } } }, issues); // missing emoji
  assert.ok(issues.some((i) => /emoji/i.test(i)));
  const issues2 = [];
  validateAppearance({ appName: 42 }, issues2);
  assert.ok(issues2.some((i) => /string/i.test(i)));
});

test('garbage input never crashes validation', () => {
  assert.equal(validateCatalogStructure(null).ok, false);
  assert.equal(validateCatalogStructure('nope').ok, false);
  assert.equal(validateCatalogStructure({ universities: 'x' }).ok, false);
  assert.equal(validateDistributionDocument(42).ok, false);
  assert.equal(validateDistributionDocument(null).ok, false);
});
