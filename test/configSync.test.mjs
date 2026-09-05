// ─────────────────────────────────────────────────────────────────────────
// configSync + configCache — the offline-first student lifecycle:
//
//   fresh device + online        → downloads + applies the published config
//   up-to-date device + online   → meta probe only, NO payload download
//   stale device + online        → detects newer version, stores it
//   offline device               → zero network, runs the local cache
//   static host / no backend     → graceful "no-backend", seed stays
//   corrupt backend payload      → rejected, local cache untouched
//   interrupted boot transfer    → "pending", background finishes it
//   legacy v1 cache              → migrated into IndexedDB
//
// Run under Node with in-memory localStorage + IndexedDB shims.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeLocalStorage } from './helpers/fixtures.mjs';
import { createIdbShim } from './helpers/idbShim.mjs';
import { makeValidCatalog, makeDistributionPayload, makeFakeFetch } from './helpers/fixtures.mjs';

// ── Browser environment shims (configCache is the only module touching them) ─
const ls = makeLocalStorage();
globalThis.window = { localStorage: ls };
const idb = createIdbShim();
globalThis.indexedDB = idb;

const {
  seedRuntimeCatalog,
  getRuntimeCatalog,
  setRuntimeCatalog,
} = await import('../src/config/runtime.ts');
const cache = await import('../src/services/configCache.ts');
const sync = await import('../src/services/configSync.ts');
const { buildDistribution } = await import('../src/admin/catalogPublish.ts');

const LOCAL = 'cgpa-pilot.config.v1'; // legacy v1 payload key

function freshState() {
  ls.clear();
  idb._reset();
  setRuntimeCatalog(seedRuntimeCatalog());
  sync.clearPendingConfigUpdate();
}

/** Persist a previously-synced local config so the meta is on disk. */
async function persistLocal(version) {
  const dist = buildDistribution(makeValidCatalog());
  await cache.writeCachedConfig(
    { universities: dist.universities, curricula: dist.curricula },
    { version, updatedAt: '2026-09-04T09:00:00Z', source: 'backend' }
  );
}

function localConfig(version, source = 'backend') {
  const seed = seedRuntimeCatalog();
  return { ...seed, version, source, cachedAt: new Date().toISOString() };
}

function serverDocs(version, payloadOverride) {
  const payload = payloadOverride ?? buildDistribution(makeValidCatalog());
  return [
    { path: '/api/config/meta', body: { format: 'cgpa-pilot-config-meta', version, updatedAt: '2026-09-04T10:00:00Z' } },
    { path: '/api/config/latest', body: { format: 'cgpa-pilot-config', version, updatedAt: '2026-09-04T10:00:00Z', payload } },
  ];
}

test('fresh device + online + server v3 → downloads, validates, applies, stores', async () => {
  freshState();
  const f = makeFakeFetch(serverDocs(3));
  const local = seedRuntimeCatalog();
  const outcome = await sync.checkAndSync(local, { fetchImpl: f, isOnline: () => true });

  assert.equal(outcome.status, 'synced', JSON.stringify(outcome));
  assert.equal(outcome.changed, true);
  assert.equal(outcome.localVersion, 3);

  // Runtime now runs the downloaded config.
  assert.equal(getRuntimeCatalog().version, 3);
  assert.equal(getRuntimeCatalog().source, 'backend');
  assert.ok(getRuntimeCatalog().universities.length > 0);

  // Meta (synchronous) reflects the stored version.
  const meta = cache.readConfigMetaSync();
  assert.equal(meta.version, 3);
  assert.equal(meta.source, 'backend');

  // The payload is durably stored in IndexedDB for offline use.
  const stored = await cache.readCachedConfigAsync();
  assert.equal(stored.version, 3);
  assert.ok(stored.curricula.length > 0);

  // Only two network calls: meta probe + latest download.
  assert.equal(f.calls.length, 2);
});

test('up-to-date device → meta probe only, no payload download', async () => {
  freshState();
  const f = makeFakeFetch(serverDocs(3));
  const outcome = await sync.checkAndSync(localConfig(3), { fetchImpl: f, isOnline: () => true });
  assert.equal(outcome.status, 'up-to-date');
  assert.equal(outcome.changed, false);
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls[0].url.includes('/api/config/meta'));
});

test('server OLDER than local → no downgrade', async () => {
  freshState();
  const f = makeFakeFetch(serverDocs(2));
  const outcome = await sync.checkAndSync(localConfig(5), { fetchImpl: f, isOnline: () => true });
  assert.equal(outcome.status, 'up-to-date');
  assert.equal(outcome.changed, false);
  assert.equal(getRuntimeCatalog().version, null); // runtime untouched (seed)
});

test('offline → zero network, local cache runs as-is', async () => {
  freshState();
  const f = makeFakeFetch(serverDocs(3));
  const local = localConfig(2);
  const outcome = await sync.checkAndSync(local, { fetchImpl: f, isOnline: () => false });
  assert.equal(outcome.status, 'offline');
  assert.equal(outcome.changed, false);
  assert.equal(f.calls.length, 0);
});

test('network failure → graceful offline, nothing changes', async () => {
  freshState();
  await persistLocal(2); // a previously synced device
  const f = makeFakeFetch([{ path: '/api/config/meta', throw: 'connection refused' }]);
  const outcome = await sync.checkAndSync(localConfig(2), { fetchImpl: f, isOnline: () => true });
  assert.equal(outcome.status, 'offline');
  assert.equal(cache.readConfigMetaSync().version, 2);
});

test('static host (non-JSON 404) → no-backend, seed/local untouched', async () => {
  freshState();
  const f = makeFakeFetch([
    { path: '/api/config/meta', status: 404, contentType: 'text/html', body: '<html>Not Found</html>' },
  ]);
  const outcome = await sync.checkAndSync(seedRuntimeCatalog(), { fetchImpl: f, isOnline: () => true });
  assert.equal(outcome.status, 'no-backend');
  assert.equal(outcome.changed, false);
});

test('backend reachable but nothing published → no-published', async () => {
  freshState();
  const f = makeFakeFetch([
    { path: '/api/config/meta', status: 404, body: { format: 'cgpa-pilot-config-meta', error: 'no-config-published' } },
  ]);
  const outcome = await sync.checkAndSync(seedRuntimeCatalog(), { fetchImpl: f, isOnline: () => true });
  assert.equal(outcome.status, 'no-published');
  assert.equal(outcome.serverVersion, null);
});

test('corrupt backend payload → rejected, local cache untouched', async () => {
  freshState();
  await persistLocal(1);
  const badPayload = buildDistribution(makeValidCatalog({ duplicateCode: true }));
  const f = makeFakeFetch(serverDocs(2, badPayload));
  const outcome = await sync.checkAndSync(localConfig(1), { fetchImpl: f, isOnline: () => true });
  assert.equal(outcome.status, 'invalid-remote');
  assert.equal(outcome.changed, false);
  assert.equal(cache.readConfigMetaSync().version, 1); // still the old version
});

test('boot deadline expires mid-download → pending (background retries)', async () => {
  freshState();
  await persistLocal(1);
  const f = makeFakeFetch([
    { path: '/api/config/meta', body: { format: 'cgpa-pilot-config-meta', version: 4, updatedAt: '2026-09-04T10:00:00Z' } },
    { path: '/api/config/latest', hang: true },
  ]);
  const outcome = await sync.checkAndSync(localConfig(1), {
    fetchImpl: f,
    isOnline: () => true,
    deadlineMs: 120,
  });
  assert.equal(outcome.status, 'pending');
  assert.equal(outcome.changed, false);
  assert.equal(cache.readConfigMetaSync().version, 1);
});

test('bootStudentConfig on a fresh device renders the synced config before first paint', async () => {
  freshState();
  const f = makeFakeFetch(serverDocs(1));
  const outcome = await sync.bootStudentConfig({ fetchImpl: f, isOnline: () => true, bootDeadlineMs: 2000 });
  assert.equal(outcome.status, 'synced');
  assert.equal(getRuntimeCatalog().version, 1);
  // The next boot reads the persisted store, not the network.
  const stored = await cache.readCachedConfigAsync();
  assert.equal(stored.version, 1);
});

test('second boot of the same device: meta is current → up-to-date, no re-download', async () => {
  freshState();
  const f1 = makeFakeFetch(serverDocs(1));
  await sync.bootStudentConfig({ fetchImpl: f1, isOnline: () => true, bootDeadlineMs: 2000 });
  // Fresh process state but same persisted store.
  const f2 = makeFakeFetch(serverDocs(1));
  const outcome = await sync.bootStudentConfig({ fetchImpl: f2, isOnline: () => true, bootDeadlineMs: 2000 });
  assert.equal(outcome.status, 'up-to-date');
  assert.equal(f2.calls.length, 1); // meta probe only
  assert.equal(getRuntimeCatalog().version, 1);
});

test('legacy v1 localStorage cache is read and migrated into IndexedDB', async () => {
  freshState();
  const legacyPayload = {
    universities: makeValidCatalog().universities,
    curricula: makeValidCatalog().curricula,
    cachedAt: '2026-01-01T00:00:00Z',
    schemaVersion: 1,
  };
  ls.setItem(LOCAL, JSON.stringify(legacyPayload));
  const loaded = await cache.readCachedConfigAsync();
  assert.equal(loaded.source, 'legacy');
  assert.equal(loaded.version, null);
  // Migration landed the payload in IndexedDB.
  await new Promise((r) => setTimeout(r, 20));
  const fromIdb = await cache.readCachedConfigAsync();
  assert.ok(fromIdb.universities.length > 0);
  assert.notEqual(fromIdb.source, 'seed');
});

test('when IndexedDB is unavailable the version meta is NOT written (device keeps re-syncing)', async () => {
  freshState();
  const realIdb = globalThis.indexedDB;
  delete globalThis.indexedDB;
  try {
    await cache.writeCachedConfig(
      { universities: makeValidCatalog().universities, curricula: makeValidCatalog().curricula },
      { version: 7, updatedAt: '2026-09-04T10:00:00Z', source: 'backend' }
    );
    // No durable payload → meta must stay null so the next boot re-checks.
    assert.equal(cache.readConfigMetaSync().version, null);
  } finally {
    globalThis.indexedDB = realIdb;
  }
});

test('recordBackgroundSync flags a mid-session update for an explicit reload', async () => {
  freshState();
  const f = makeFakeFetch(serverDocs(5));
  // Simulate: app already rendered on v1; background check finds v5.
  const outcome = await sync.checkAndSync(localConfig(1), { fetchImpl: f, isOnline: () => true });
  assert.equal(outcome.status, 'synced');
  assert.equal(sync.getPendingConfigUpdate(), null); // boot-style apply → nothing pending

  // The background wrapper records it as pending (UI offers "reload to apply").
  sync.recordBackgroundSync(outcome);
  assert.deepEqual(sync.getPendingConfigUpdate(), { version: 5, updatedAt: null });

  // A listener is notified when the pending flag changes.
  const seen = [];
  const off = sync.onConfigUpdate((p) => seen.push(p));
  sync.clearPendingConfigUpdate();
  off();
  assert.equal(seen.length, 1);
  assert.equal(seen[0], null);
  assert.equal(sync.getPendingConfigUpdate(), null);
});

test('wipeDeviceStorage PRESERVES the config cache (Clear must not drop to a stale seed)', async () => {
  freshState();
  const f = makeFakeFetch(serverDocs(2));
  await sync.checkAndSync(seedRuntimeCatalog(), { fetchImpl: f, isOnline: () => true });
  assert.equal(cache.readConfigMetaSync().version, 2);
  cache.wipeDeviceStorage();
  await new Promise((r) => setTimeout(r, 20));
  // The offline curriculum config survives a Clear: meta + payload stay put,
  // so the app can never fall back to the bundled (stale) seed after a
  // refresh. Student work is in-memory and reset by the store + reload.
  const meta = cache.readConfigMetaSync();
  assert.equal(meta.version, 2);
  assert.equal(meta.source, 'backend');
  const loaded = await cache.readCachedConfigAsync();
  assert.equal(loaded.version, 2);
  assert.equal(loaded.source, 'backend');
});
