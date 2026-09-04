// ─────────────────────────────────────────────────────────────────────────
// Config-as-code seed wiring. The committed admin-catalog.json is the single
// durable source for BOTH the admin console's boot seed and the student
// app's bundled universities/curricula. These tests guard that the wiring is
// consistent: every programme the student default exposes references a
// curriculum version that actually ships, and the admin seed equals what the
// student bundle is seeded from.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { seedCatalog } from '../src/admin/adminConfigService.ts';
import { UNIVERSITIES, BUNDLED_CURRICULA } from '../src/config/context.ts';
import {
  SEED_ADMIN_CATALOG,
  COMMITTED_CATALOG,
} from '../src/config/seed.ts';
import { buildDistribution } from '../src/admin/catalogPublish.ts';
import {
  validateCatalogStructure,
  validateDistributionDocument,
} from '../src/admin/catalogValidation.ts';

test('a committed admin seed is present (not falling back to an empty file)', () => {
  assert.ok(COMMITTED_CATALOG, 'committed admin-catalog.json should be valid + non-empty');
  assert.ok(COMMITTED_CATALOG.universities.length > 0, 'seed must ship at least one university');
  assert.ok(Array.isArray(COMMITTED_CATALOG.curricula));
});

test('admin boot seed carries the same institutions/curricula as the student bundle', () => {
  const adminSeed = seedCatalog();
  // Both surfaces come from the same committed catalog, so their roots match.
  assert.equal(adminSeed.universities.length, UNIVERSITIES.length);
  assert.equal(adminSeed.curricula.length, BUNDLED_CURRICULA.length);
  assert.equal(adminSeed.universities[0].id, UNIVERSITIES[0].id);
  assert.equal(adminSeed.curricula[0].id, BUNDLED_CURRICULA[0].id);
});

test('every programme exposed by the seed references a bundled curriculum version', () => {
  const seed = SEED_ADMIN_CATALOG;
  const ids = new Set(seed.curricula.map((c) => c.id));
  for (const u of seed.universities) {
    for (const s of u.schools) {
      for (const p of s.programmes) {
        for (const cid of p.curriculumVersionIds ?? []) {
          assert.ok(
            ids.has(cid),
            `programme ${p.id} references curriculum ${cid} that is not bundled`
          );
        }
      }
    }
  }
});

test('the committed seed is a valid BOOTSTRAP (backend unavailable fallback)', () => {
  // Structural integrity — the seed must never leave the app without a
  // working configuration.
  const structural = validateCatalogStructure(SEED_ADMIN_CATALOG);
  assert.equal(structural.ok, true, structural.issues.join(' · '));
  // And it must produce a valid distribution document for the wire protocol,
  // even when it contains no published curriculum yet.
  const dist = buildDistribution(SEED_ADMIN_CATALOG);
  const distCheck = validateDistributionDocument(dist);
  assert.equal(distCheck.ok, true, distCheck.issues.join(' · '));
});

test('a published seed curriculum stays consistent with its programme', () => {
  const seed = SEED_ADMIN_CATALOG;
  for (const c of seed.curricula) {
    // If a curriculum is referenced by a programme, it must belong to it.
    const owner = seed.universities
      .flatMap((u) => u.schools)
      .flatMap((s) => s.programmes)
      .find((p) => p.id === c.programmeId);
    assert.ok(owner, `curriculum ${c.id} has no owning programme ${c.programmeId}`);
  }
});
