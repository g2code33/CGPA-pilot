// ─────────────────────────────────────────────────────────────────────────
// END-TO-END lifecycle through the REAL components:
//
//   admin client (adminApi) ──► real Worker handler ──► in-memory D1
//   student sync (configSync) ──► real Worker handler ──► IndexedDB shim
//
// Scenarios (per the required test plan):
//   Admin:    FIRST-TIME SETUP — the ONE passcode is created once (operator
//             token); a second setup attempt is rejected (409)
//   Admin:    a SECOND admin device signs in with the SAME passcode (single
//             identity, not per-device) and operates via its session token
//             (no raw operator token needed)
//   Admin:    publish v1 → confirm persistence → refresh (state stays)
//   Student:  fresh device online → downloads + stores v1
//   Admin:    edit + republish → v2 (still via the passcode session)
//   Student:  previously-synced device reconnects → detects v2 → local updates
//   Student:  offline again → the newly synced data remains available
//   Fresh device → obtains the current published configuration
//   Admin:    passcode change → old passcode stops working online, new works
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1Stub } from './helpers/d1Stub.mjs';
import { createIdbShim } from './helpers/idbShim.mjs';
import { makeLocalStorage, makeValidCatalog } from './helpers/fixtures.mjs';

const TOKEN = 'e2e-token';
const PASSCODE = 'e2e-admin-pass';
const PASSCODE_V2 = 'e2e-admin-pass-2';
const ORIGIN = 'http://127.0.0.1:8787';

// ── Backend (one D1 database for the whole scenario) ─────────────────────
const worker = (await import('../worker/src/index.ts')).default;
const db = createD1Stub();
const env = { CONFIG_DB: db, ADMIN_TOKEN: TOKEN, ASSETS: undefined };

/** Route a same-origin fetch call straight into the Worker handler. */
function workerFetch(url, opts = {}) {
  const u = new URL(url, ORIGIN);
  const headers = Object.fromEntries(
    Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])
  );
  const req = new Request(u.origin + u.pathname + u.search, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body,
  });
  return worker.fetch(req, env);
}
/** A "network" that only reaches the backend while online. */
function onlineWorkerFetch(online) {
  return async (url, opts) => {
    if (!online()) throw new Error('offline');
    return workerFetch(url, opts);
  };
}

// ── Student device (its own localStorage + IndexedDB) ────────────────────
const ls = makeLocalStorage();
globalThis.window = { localStorage: ls };
const idb = createIdbShim();
globalThis.indexedDB = idb;

const sync = await import('../src/services/configSync.ts');
const cache = await import('../src/services/configCache.ts');
const runtime = await import('../src/config/runtime.ts');

// ── Admin device #1 (its own storage) ────────────────────────────────────
const adminLs = makeLocalStorage();
const adminWindow = { localStorage: adminLs };
globalThis.window = { localStorage: ls, _admin: adminLs }; // student device first
const adminStorage = await import('../src/admin/adminStorage.ts');
const adminApi = await import('../src/admin/adminApi.ts');

// After setup, admin ops run via the PASSCODE SESSION (no raw token).
const ADMIN_DEPS = { fetchImpl: onlineWorkerFetch(() => true), baseOverride: ORIGIN };

// Switch the global window per client under test.
function asStudent() {
  Object.defineProperty(globalThis, 'window', { value: { localStorage: ls }, writable: true, configurable: true });
}
function asAdmin() {
  Object.defineProperty(globalThis, 'window', { value: adminWindow, writable: true, configurable: true });
}
const STUDENT_DEPS = { baseOverride: ORIGIN };

test('ADMIN: first-time setup creates the ONE passcode (operator token, one-time)', async () => {
  asAdmin();
  const st = await adminApi.getAuthState(ADMIN_DEPS);
  assert.equal(st.configured, true);
  assert.equal(st.hasCredential, false);

  const r = await adminApi.setupPasscode(TOKEN, PASSCODE, { ...ADMIN_DEPS, tokenOverride: TOKEN });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.sessionToken);

  // Setup is ONE-TIME: a second attempt is rejected.
  const again = await adminApi.setupPasscode(TOKEN, 'other-pass', { ...ADMIN_DEPS, tokenOverride: TOKEN });
  assert.equal(again.ok, false);
  assert.equal(again.error, 'credential-exists');

  // The device now holds the session + credential (never the plaintext).
  const auth = adminStorage.readAdminAuth();
  assert.equal(auth.offlineSession, true);
  assert.ok(auth.credential?.salt && auth.credential?.hash);
  assert.ok(!JSON.stringify(auth).includes(PASSCODE));

  const st2 = await adminApi.getAuthState(ADMIN_DEPS);
  assert.equal(st2.hasCredential, true);
});

test('ADMIN: a SECOND admin device signs in with the SAME passcode (single identity)', async () => {
  // A brand-new device: fresh storage, no operator token saved at all.
  const otherLs = makeLocalStorage();
  Object.defineProperty(globalThis, 'window', { value: { localStorage: otherLs }, writable: true, configurable: true });
  const otherDeps = { fetchImpl: onlineWorkerFetch(() => true), baseOverride: ORIGIN };

  const wrong = await adminApi.loginPasscode('not-the-passcode', otherDeps);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.error, 'invalid-passcode');

  const ok = await adminApi.loginPasscode(PASSCODE, otherDeps);
  assert.equal(ok.ok, true, JSON.stringify(ok));

  // And it operates the backend purely with its session token
  // (nothing published yet → no versions, but the credential is accepted).
  const st = await adminApi.getBackendStatus(otherDeps);
  assert.equal(st.state, 'connected');
  assert.equal(st.adminVersion, null);
  asAdmin();
});

test('ADMIN: publish v1 (via the passcode session) → backend persistence confirmed', async () => {
  asAdmin();
  const r = await adminApi.publishCatalog(makeValidCatalog(), ADMIN_DEPS);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.adminVersion, 1);
  assert.equal(r.publishedVersion, 1);

  // "Refresh admin. Confirm data remains."
  const st = await adminApi.getBackendStatus(ADMIN_DEPS);
  assert.equal(st.state, 'connected');
  assert.equal(st.adminVersion, 1);
  assert.equal(st.publishedVersion, 1);

  // Pull back from the backend (round-trip).
  const pulled = await adminApi.pullBackendCatalog(ADMIN_DEPS);
  assert.equal(pulled.ok, true);
  assert.ok(pulled.catalog.universities.length > 0);
});

test('ADMIN: the second device now sees the SAME published catalog (one admin, one catalog)', async () => {
  // Fresh storage again — but this time it already signed in with the
  // passcode in the earlier test; re-sign-in to get a live session.
  const otherLs = makeLocalStorage();
  Object.defineProperty(globalThis, 'window', { value: { localStorage: otherLs }, writable: true, configurable: true });
  const otherDeps = { fetchImpl: onlineWorkerFetch(() => true), baseOverride: ORIGIN };
  const ok = await adminApi.loginPasscode(PASSCODE, otherDeps);
  assert.equal(ok.ok, true);
  const st = await adminApi.getBackendStatus(otherDeps);
  assert.equal(st.state, 'connected');
  assert.equal(st.adminVersion, 1);
  assert.equal(st.publishedVersion, 1);
  const pulled = await adminApi.pullBackendCatalog(otherDeps);
  assert.equal(pulled.ok, true);
  assert.equal(pulled.adminVersion, 1);
  asAdmin();
});

test('STUDENT: fresh device online → downloads latest config and stores it locally', async () => {
  asStudent();
  const online = { value: true };
  const outcome = await sync.bootStudentConfig({
    fetchImpl: onlineWorkerFetch(() => online.value),
    ...STUDENT_DEPS,
    bootDeadlineMs: 3000,
  });
  assert.equal(outcome.status, 'synced', JSON.stringify(outcome));
  assert.equal(outcome.localVersion, 1);

  // Stored locally (IndexedDB + meta) — this is what offline mode will use.
  assert.equal(cache.readConfigMetaSync().version, 1);
  const stored = await cache.readCachedConfigAsync();
  assert.equal(stored.version, 1);
  assert.ok(stored.curricula.length > 0);
  // Runtime is running the synced config.
  assert.equal(runtime.getRuntimeCatalog().version, 1);
});

test('ADMIN: edit the catalog and republish → v2', async () => {
  asAdmin();
  const pulled = await adminApi.pullBackendCatalog(ADMIN_DEPS);
  assert.equal(pulled.ok, true);
  const edited = pulled.catalog;
  // Edit: bump one course's credits.
  const course = edited.curricula.find((c) => c.status === 'published')
    .levels[0].semesters[0].courses[0];
  course.creditHours = 5;
  const r = await adminApi.publishCatalog(edited, { ...ADMIN_DEPS, note: 'credit update' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.adminVersion, 2);
  assert.equal(r.publishedVersion, 2);
});

test('STUDENT: previously-synced device reconnects → detects v2 → local data updates', async () => {
  asStudent();
  const outcome = await sync.checkAndSync(runtime.getRuntimeCatalog(), {
    fetchImpl: onlineWorkerFetch(() => true),
    ...STUDENT_DEPS,
  });
  assert.equal(outcome.status, 'synced', JSON.stringify(outcome));
  assert.equal(outcome.localVersion, 2);
  assert.equal(outcome.changed, true);
  assert.equal(cache.readConfigMetaSync().version, 2);
  // The edit actually made it to the device.
  const stored = await cache.readCachedConfigAsync();
  const course = stored.curricula.find((c) => c.status === 'published')
    .levels[0].semesters[0].courses[0];
  assert.equal(course.creditHours, 5);
});

test('STUDENT: disconnect again → the newly synced data remains available offline', async () => {
  asStudent();
  // Boot while offline: no network at all, app runs the v2 cache.
  const outcome = await sync.bootStudentConfig({
    fetchImpl: onlineWorkerFetch(() => false),
    ...STUDENT_DEPS,
    bootDeadlineMs: 3000,
  });
  assert.equal(outcome.status, 'offline');
  assert.equal(runtime.getRuntimeCatalog().version, 2);
  const stored = await cache.readCachedConfigAsync();
  assert.equal(stored.version, 2);
  const course = stored.curricula.find((c) => c.status === 'published')
    .levels[0].semesters[0].courses[0];
  assert.equal(course.creditHours, 5);
});

test('STUDENT: a brand-new device (fresh storage) obtains the current published config', async () => {
  asStudent();
  // Simulate a new device: wipe everything, fresh IDB + localStorage.
  ls.clear();
  idb._reset();
  runtime.setRuntimeCatalog(runtime.seedRuntimeCatalog());
  const outcome = await sync.bootStudentConfig({
    fetchImpl: onlineWorkerFetch(() => true),
    ...STUDENT_DEPS,
    bootDeadlineMs: 3000,
  });
  assert.equal(outcome.status, 'synced');
  assert.equal(outcome.localVersion, 2);
  assert.equal(cache.readConfigMetaSync().version, 2);
  const stored = await cache.readCachedConfigAsync();
  assert.equal(stored.version, 2);
});

test('BACKEND UNAVAILABLE: existing local data keeps working, app is not bricked', async () => {
  asStudent();
  // The device already has v2 cached (from the previous test).
  assert.equal(cache.readConfigMetaSync().version, 2);
  const outcome = await sync.bootStudentConfig({
    fetchImpl: async () => {
      throw new Error('network down');
    },
    ...STUDENT_DEPS,
    bootDeadlineMs: 3000,
  });
  assert.equal(outcome.status, 'offline');
  assert.equal(outcome.changed, false);
  assert.equal(runtime.getRuntimeCatalog().version, 2);
  const stored = await cache.readCachedConfigAsync();
  assert.equal(stored.version, 2);
});

test('ADMIN: passcode change → the old passcode stops working online, the new one works', async () => {
  asAdmin();
  const changed = await adminApi.changePasscode(PASSCODE, PASSCODE_V2, ADMIN_DEPS);
  assert.equal(changed.ok, true, JSON.stringify(changed));
  // This device's local credential was refreshed (offline sign-in keeps working).
  const localAuth = adminStorage.readAdminAuth();
  assert.equal(localAuth.credential.version, 2);

  // A different device with the OLD passcode is now rejected by the backend…
  const oldDeviceLs = makeLocalStorage();
  Object.defineProperty(globalThis, 'window', { value: { localStorage: oldDeviceLs }, writable: true, configurable: true });
  const otherDeps = { fetchImpl: onlineWorkerFetch(() => true), baseOverride: ORIGIN };
  const oldLogin = await adminApi.loginPasscode(PASSCODE, otherDeps);
  assert.equal(oldLogin.ok, false);
  assert.equal(oldLogin.error, 'invalid-passcode');
  // …while the NEW passcode signs in everywhere.
  const newLogin = await adminApi.loginPasscode(PASSCODE_V2, otherDeps);
  assert.equal(newLogin.ok, true);
  asAdmin();
});
