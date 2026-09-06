// ─────────────────────────────────────────────────────────────────────────
// catalogSize — v1.0.19: the admin must ALWAYS know where the catalog's
// weight lives, and an over-limit publish must name the exact images to
// shrink (client pre-check + server 413 + diagnostics share one message).
// Run: npm test
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dataUrlBytes,
  humanBytes,
  catalogAssetList,
  largestAssetsSummary,
  oversizeCatalogMessage,
  D1_VALUE_SAFE_BYTES,
} from '../src/admin/catalogSize.ts';
import { publishCatalog } from '../src/admin/adminApi.ts';
import { makeValidCatalog } from './helpers/fixtures.mjs';

// A base64 payload of exactly n decoded bytes ('A' padding is fine for
// size math — the measurement is length-based, not decodability-based).
const b64Of = (n) => 'data:image/png;base64,' + 'A'.repeat(Math.ceil((n * 4) / 3));

// ── dataUrlBytes / humanBytes ────────────────────────────────────────────

test('dataUrlBytes: measures the base64 payload, not the header', () => {
  assert.equal(dataUrlBytes('data:image/png;base64,AAAA'), 3); // 4 chars → 3 bytes
  assert.equal(dataUrlBytes(b64Of(300_000)), 300_000);
  assert.equal(dataUrlBytes(b64Of(1_600_000)), 1_600_000);
});

test('dataUrlBytes: plain URLs, paths and empty values cost nothing', () => {
  assert.equal(dataUrlBytes('https://example.com/logo.png'), 0);
  assert.equal(dataUrlBytes('./icon-512.png'), 0);
  assert.equal(dataUrlBytes('data:image/png;utf8,hi'), 0); // not base64
  assert.equal(dataUrlBytes(undefined), 0);
  assert.equal(dataUrlBytes(null), 0);
  assert.equal(dataUrlBytes(''), 0);
});

test('humanBytes: friendly units', () => {
  assert.equal(humanBytes(500), '500 B');
  assert.equal(humanBytes(25_000), '25 KB');
  assert.equal(humanBytes(1_600_000), '1.6 MB');
});

// ── catalogAssetList ─────────────────────────────────────────────────────

test('catalogAssetList: labels, order and trash aggregation', () => {
  const catalog = makeValidCatalog();
  catalog.appearance = {
    logo: b64Of(1_600_000), // App logo — the biggest
    appIcon: { emoji: '🧭', image: b64Of(950_000) },
    icons: { target: { emoji: '🎯', image: b64Of(400_000) } },
    appImage: undefined,
    taglineImage: b64Of(100_000),
  };
  catalog.universities[0].logo = b64Of(700_000);
  catalog.universities[0].schools[0].logo = b64Of(200_000);
  catalog.trash = [
    {
      id: 't1',
      kind: 'university',
      label: 'Old Uni',
      deletedAt: new Date().toISOString(),
      // a deleted university still carrying its big logo
      data: { id: 'u-old', name: 'Old Uni', shortName: 'OU', logo: b64Of(500_000), schools: [] },
      parent: {},
    },
  ];

  const assets = catalogAssetList(catalog);
  // Sorted largest-first, with human labels.
  assert.deepEqual(
    assets.map((a) => a.label),
    [
      'App logo', // 1.6 MB
      'App icon', // 950 KB
      `University “${catalog.universities[0].shortName || catalog.universities[0].name}” logo`, // 700 KB
      'Recycle bin (1 embedded image)', // 500 KB
      'Tool icon: Target', // 400 KB
      `Department “${catalog.universities[0].schools[0].name}” logo`, // 200 KB
      'Tagline image', // 100 KB
    ]
  );
  assert.equal(assets[0].bytes, 1_600_000);
  // Trash is aggregated (500 KB image inside the deleted university).
  const trash = assets.find((a) => a.label.startsWith('Recycle bin'));
  assert.equal(trash.bytes, 500_000);
});

test('catalogAssetList: empty catalog → no assets', () => {
  assert.deepEqual(catalogAssetList({ universities: [], curricula: [] }), []);
});

// ── The shared over-limit message ────────────────────────────────────────

test('oversizeCatalogMessage: names the biggest images and the fix', () => {
  const assets = catalogAssetList({
    universities: [],
    curricula: [],
    appearance: {
      logo: b64Of(1_600_000),
      icons: { target: { emoji: '🎯', image: b64Of(950_000) } },
    },
  });
  const msg = oversizeCatalogMessage(4_000_000, assets);
  assert.match(msg, /4\.0 MB as stored JSON/);
  assert.match(msg, /~2 MB per record/);
  assert.match(msg, /Largest images: App logo \(1\.6 MB\), Tool icon: Target \(950 KB\)/);
  assert.match(msg, /under ~300 KB each/);
});

test('oversizeCatalogMessage: graceful fallback when no embedded images are found', () => {
  const msg = oversizeCatalogMessage(3_000_000, []);
  assert.match(msg, /3\.0 MB as stored JSON/);
  assert.doesNotMatch(msg, /Largest images/);
  assert.match(msg, /smaller images/i);
});

test('largestAssetsSummary: top-N only', () => {
  const assets = [
    { label: 'A', bytes: 100 },
    { label: 'B', bytes: 200 },
    { label: 'C', bytes: 300 },
    { label: 'D', bytes: 400 },
  ];
  assert.equal(largestAssetsSummary(assets, 3), 'A (100 B), B (200 B), C (300 B)');
});

// ── The client pre-check: refused BEFORE any network call ────────────────

test('publishCatalog: an over-limit catalog attempts R2 migration, then is refused locally if it still cannot slim', async () => {
  const huge = b64Of(2_200_000); // ~2.2 MB inside the stored JSON
  const catalog = {
    ...makeValidCatalog(),
    appearance: { appIcon: { emoji: '🧭', image: huge } },
  };
  let calls = 0;
  const r = await publishCatalog(catalog, {
    baseOverride: 'https://unused.example',
    tokenOverride: 'test-token',
    fetchImpl: () => {
      calls += 1;
      throw new Error('migration unreachable');
    },
  });
  assert.equal(r.ok, false);
  // R2 auto-migration is attempted first; when the migration is unreachable
  // the original actionable oversize message is what the admin sees.
  assert.equal(calls, 1, 'one migrate-assets attempt before refusing');
  assert.match(r.error, /2\.[0-9] MB as stored JSON/);
  assert.match(r.error, /Largest images: App icon \(2\.2 MB\)/);
  assert.match(r.error, /~2 MB per record/);
});

test('publishCatalog: a small catalog still passes the size pre-check (proceeds to auth/network)', async () => {
  const catalog = makeValidCatalog();
  let fetchCalled = false;
  const r = await publishCatalog(catalog, {
    baseOverride: 'https://unused.example',
    tokenOverride: 'test-token',
    fetchImpl: () => {
      fetchCalled = true;
      // Stop after the request is made — the size gate is what's under test.
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    },
  });
  assert.equal(fetchCalled, true, 'an under-limit catalog must reach the network');
  assert.equal(r.ok, true);
});

test('the shared safe limit is the one the worker enforces (~2 MB with margin)', () => {
  assert.ok(D1_VALUE_SAFE_BYTES < 2 * 1024 * 1024);
  assert.ok(D1_VALUE_SAFE_BYTES > 1_800_000);
});
