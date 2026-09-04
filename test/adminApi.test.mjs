// ─────────────────────────────────────────────────────────────────────────
// adminApi — the admin console's backend client: status classification,
// publish (client gate → server round-trip → sync metadata), and pull
// (backend authoritative catalog adoption).
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeLocalStorage, makeValidCatalog, makeFakeFetch } from './helpers/fixtures.mjs';

const ls = makeLocalStorage();
globalThis.window = { localStorage: ls };

const api = await import('../src/admin/adminApi.ts');
const storage = await import('../src/admin/adminStorage.ts');

function freshState(token = 'tok-123') {
  ls.clear();
  if (token !== null) storage.writeApiToken(token);
}

test('token is stored/cleared through the admin storage boundary', () => {
  freshState(null);
  assert.equal(storage.readApiToken(), null);
  storage.writeApiToken('  abc  ');
  assert.equal(storage.readApiToken(), 'abc');
  storage.writeApiToken(null);
  assert.equal(storage.readApiToken(), null);
});

test('status: connected backend reports both stored versions', async () => {
  freshState();
  const f = makeFakeFetch([
    { path: '/api/admin/status', body: { format: 'cgpa-pilot-admin-status', hasCatalog: true, adminVersion: 4, hasPublished: true, publishedVersion: 4, updatedAt: '2026-09-04T09:00:00Z' } },
  ]);
  const st = await api.getBackendStatus({ fetchImpl: f, baseOverride: '' });
  assert.equal(st.state, 'connected');
  assert.equal(st.adminVersion, 4);
  assert.equal(st.publishedVersion, 4);
});

test('status: 401 → unauthorized', async () => {
  freshState('wrong-token');
  const f = makeFakeFetch([
    { path: '/api/admin/status', status: 401, body: { ok: false, error: 'invalid-token', message: 'nope' } },
  ]);
  const st = await api.getBackendStatus({ fetchImpl: f });
  assert.equal(st.state, 'unauthorized');
});

test('status: 503 → not-configured', async () => {
  freshState();
  const f = makeFakeFetch([
    { path: '/api/admin/status', status: 503, body: { ok: false, error: 'not-configured', message: 'set ADMIN_TOKEN' } },
  ]);
  const st = await api.getBackendStatus({ fetchImpl: f });
  assert.equal(st.state, 'not-configured');
});

test('status: network failure → unreachable', async () => {
  freshState();
  const f = makeFakeFetch([{ path: '/api/admin/status', throw: 'offline' }]);
  const st = await api.getBackendStatus({ fetchImpl: f });
  assert.equal(st.state, 'unreachable');
});

test('status: non-API HTTP response → not-configured (static host)', async () => {
  freshState();
  const f = makeFakeFetch([
    { path: '/api/admin/status', status: 404, contentType: 'text/html', body: '<html>404</html>' },
  ]);
  const st = await api.getBackendStatus({ fetchImpl: f });
  assert.equal(st.state, 'not-configured');
});

test('publish: happy path persists and records sync metadata', async () => {
  freshState();
  const f = makeFakeFetch([
    { path: '/api/admin/publish', body: { ok: true, adminVersion: 6, publishedVersion: 6, updatedAt: '2026-09-04T10:00:00Z' } },
  ]);
  const r = await api.publishCatalog(makeValidCatalog(), { fetchImpl: f, tokenOverride: 'tok-123' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.adminVersion, 6);
  assert.equal(r.publishedVersion, 6);
  const meta = storage.readAdminSyncMeta();
  assert.equal(meta.adminVersion, 6);
  assert.equal(meta.publishedVersion, 6);
  assert.ok(meta.lastSyncAt);
  // The catalog body was sent as JSON.
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].url, /\/api\/admin\/publish$/);
});

test('publish: the Bearer token goes on the Authorization header', async () => {
  freshState();
  const f = makeFakeFetch([
    { path: '/api/admin/publish', body: { ok: true, adminVersion: 1, publishedVersion: 1, updatedAt: 'x' } },
  ]);
  await api.publishCatalog(makeValidCatalog(), { fetchImpl: f, tokenOverride: 'sekret' });
  assert.equal(f.calls[0].opts.headers.authorization, 'Bearer sekret');
});

test('publish: client gate blocks a failing catalog BEFORE any network call', async () => {
  freshState();
  const f = makeFakeFetch([
    { path: '/api/admin/publish', body: { ok: true } }, // must never be reached
  ]);
  const r = await api.publishCatalog(makeValidCatalog({ duplicateCode: true }), { fetchImpl: f, tokenOverride: 't' });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /duplicate course code/i.test(i)));
  assert.equal(f.calls.length, 0);
});

test('publish: without a stored token it fails fast (no network)', async () => {
  freshState(null);
  const f = makeFakeFetch([{ path: '/api/admin/publish', body: { ok: true } }]);
  const r = await api.publishCatalog(makeValidCatalog(), { fetchImpl: f });
  assert.equal(r.ok, false);
  assert.match(r.error, /token/i);
  assert.equal(f.calls.length, 0);
});

test('publish: server 400 validation → issues surfaced, no sync metadata', async () => {
  freshState();
  const f = makeFakeFetch([
    { path: '/api/admin/publish', status: 400, body: { ok: false, error: 'validation', issues: ['server says: bad code'] } },
  ]);
  const r = await api.publishCatalog(makeValidCatalog(), { fetchImpl: f, tokenOverride: 't' });
  assert.equal(r.ok, false);
  assert.ok(r.issues.includes('server says: bad code'));
  assert.equal(storage.readAdminSyncMeta().adminVersion, null);
});

test('publish: server 401 → unauthorized message', async () => {
  freshState('bad');
  const f = makeFakeFetch([
    { path: '/api/admin/publish', status: 401, body: { ok: false, error: 'invalid-token' } },
  ]);
  const r = await api.publishCatalog(makeValidCatalog(), { fetchImpl: f });
  assert.equal(r.ok, false);
  assert.match(r.error, /token/i);
});

test('pull: valid backend catalog is returned for adoption', async () => {
  freshState();
  const catalog = makeValidCatalog();
  const f = makeFakeFetch([
    { path: '/api/admin/catalog', body: { format: 'cgpa-pilot-admin-catalog', version: 9, updatedAt: '2026-09-04T11:00:00Z', catalog } },
  ]);
  const r = await api.pullBackendCatalog({ fetchImpl: f, tokenOverride: 't' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.adminVersion, 9);
  assert.deepEqual(r.catalog.universities, catalog.universities);
  assert.equal(storage.readAdminSyncMeta().adminVersion, 9);
});

test('pull: 404 → clear "nothing published yet" error', async () => {
  freshState();
  const f = makeFakeFetch([
    { path: '/api/admin/catalog', status: 404, body: { format: 'cgpa-pilot-admin-catalog', error: 'no-catalog' } },
  ]);
  const r = await api.pullBackendCatalog({ fetchImpl: f, tokenOverride: 't' });
  assert.equal(r.ok, false);
  assert.match(r.error, /no catalog/i);
});

test('pull: a backend catalog that fails validation is NOT adopted', async () => {
  freshState();
  const bad = makeValidCatalog({ duplicateCode: true });
  const f = makeFakeFetch([
    { path: '/api/admin/catalog', body: { format: 'cgpa-pilot-admin-catalog', version: 3, updatedAt: 'x', catalog: bad } },
  ]);
  const r = await api.pullBackendCatalog({ fetchImpl: f, tokenOverride: 't' });
  assert.equal(r.ok, false);
  assert.equal(storage.readAdminSyncMeta().adminVersion, null);
});

test('pull: network failure → unreachable error, nothing adopted', async () => {
  freshState();
  const f = makeFakeFetch([{ path: '/api/admin/catalog', throw: 'offline' }]);
  const r = await api.pullBackendCatalog({ fetchImpl: f, tokenOverride: 't' });
  assert.equal(r.ok, false);
  assert.equal(storage.readAdminSyncMeta().adminVersion, null);
});

// ── Single-admin auth: auth-state / login / setup / passcode change ───────

const CRED = { salt: 'aa'.repeat(16), hash: 'bb'.repeat(32), iterations: 210000, version: 1 };

function setAuthV2(patch) {
  storage.writeAdminAuth({
    v: 2,
    sessionToken: null,
    sessionExpiry: null,
    offlineSession: false,
    credential: null,
    legacyPassHash: null,
    ...patch,
  });
}

test('auth-state: reports configured + hasCredential from the probe', async () => {
  freshState(null);
  const f = makeFakeFetch([
    { path: '/api/admin/auth-state', body: { format: 'cgpa-pilot-auth-state', configured: true, hasCredential: true } },
  ]);
  const st = await api.getAuthState({ fetchImpl: f });
  assert.equal(st.configured, true);
  assert.equal(st.hasCredential, true);
});

test('auth-state: 503 → not configured; offline → unreachable', async () => {
  freshState(null);
  const f503 = makeFakeFetch([
    { path: '/api/admin/auth-state', status: 503, body: { configured: false, hasCredential: false } },
  ]);
  const st = await api.getAuthState({ fetchImpl: f503 });
  assert.equal(st.configured, false);
  assert.equal(st.error, 'not-configured');

  const fOff = makeFakeFetch([{ path: '/api/admin/auth-state', throw: 'offline' }]);
  const st2 = await api.getAuthState({ fetchImpl: fOff });
  assert.equal(st2.configured, false);
  assert.equal(st2.error, 'unreachable');
});

test('login: success stores the session + credential and retires the legacy hash', async () => {
  freshState(null);
  setAuthV2({ legacyPassHash: 'legacy-sha-256-digest', offlineSession: false });
  const f = makeFakeFetch([
    {
      path: '/api/admin/login',
      body: { ok: true, session: 'cps1.123.abc', expiresAt: '2026-10-04T00:00:00Z', credential: CRED },
    },
  ]);
  const r = await api.loginPasscode('my-passcode', { fetchImpl: f });
  assert.equal(r.ok, true);
  assert.equal(r.sessionToken, 'cps1.123.abc');
  const auth = storage.readAdminAuth();
  assert.equal(auth.sessionToken, 'cps1.123.abc');
  assert.equal(auth.offlineSession, true);
  assert.deepEqual(auth.credential, CRED);
  assert.equal(auth.legacyPassHash, null, 'legacy digest retired after an online sign-in');
  // The passcode itself was sent (and only it) in the body — never stored.
  const sent = JSON.parse(f.calls[0].opts.body);
  assert.deepEqual(sent, { passcode: 'my-passcode' });
  assert.ok(!JSON.stringify(auth).includes('my-passcode'));
});

test('login: 404 → no-credential (setup required); 401 → invalid-passcode; offline → unreachable', async () => {
  freshState(null);
  const f404 = makeFakeFetch([
    { path: '/api/admin/login', status: 404, body: { ok: false, error: 'no-credential' } },
  ]);
  assert.equal((await api.loginPasscode('x', { fetchImpl: f404 })).error, 'no-credential');

  const f401 = makeFakeFetch([
    { path: '/api/admin/login', status: 401, body: { ok: false, error: 'invalid-passcode' } },
  ]);
  assert.equal((await api.loginPasscode('x', { fetchImpl: f401 })).error, 'invalid-passcode');

  const fOff = makeFakeFetch([{ path: '/api/admin/login', throw: 'offline' }]);
  assert.equal((await api.loginPasscode('x', { fetchImpl: fOff })).error, 'unreachable');
});

test('login: a failed online attempt does NOT touch stored auth state', async () => {
  freshState(null);
  setAuthV2({ credential: CRED });
  const f401 = makeFakeFetch([
    { path: '/api/admin/login', status: 401, body: { ok: false, error: 'invalid-passcode' } },
  ]);
  await api.loginPasscode('wrong', { fetchImpl: f401 });
  assert.deepEqual(storage.readAdminAuth().credential, CRED);
  assert.equal(storage.readAdminAuth().offlineSession, false);
});

test('setup: success sends the OPERATOR token and stores session + credential', async () => {
  freshState(null);
  const f = makeFakeFetch([
    {
      path: '/api/admin/setup',
      body: { ok: true, session: 'cps1.999.def', expiresAt: '2026-10-04T00:00:00Z', credential: CRED },
    },
  ]);
  const r = await api.setupPasscode('operator-token', 'new-admin-pass', { fetchImpl: f });
  assert.equal(r.ok, true);
  assert.equal(f.calls[0].opts.headers.authorization, 'Bearer operator-token');
  assert.equal(storage.readAdminAuth().sessionToken, 'cps1.999.def');
  assert.deepEqual(storage.readAdminAuth().credential, CRED);
});

test('setup: missing operator token / weak passcode fail BEFORE any network call', async () => {
  freshState(null);
  const fNoToken = makeFakeFetch([{ path: '/api/admin/setup', body: { ok: true } }]);
  const r1 = await api.setupPasscode('   ', 'new-admin-pass', { fetchImpl: fNoToken });
  assert.equal(r1.ok, false);
  assert.equal(r1.error, 'invalid-body');
  assert.equal(fNoToken.calls.length, 0);

  const fWeak = makeFakeFetch([{ path: '/api/admin/setup', body: { ok: true } }]);
  const r2 = await api.setupPasscode('tok', '123', { fetchImpl: fWeak });
  assert.equal(r2.ok, false);
  assert.equal(r2.error, 'weak-passcode');
  assert.equal(fWeak.calls.length, 0);
});

test('setup: 401 wrong operator token; 409 already set', async () => {
  freshState(null);
  const f401 = makeFakeFetch([
    { path: '/api/admin/setup', status: 401, body: { ok: false, error: 'unauthorized' } },
  ]);
  assert.equal((await api.setupPasscode('bad', 'new-admin-pass', { fetchImpl: f401 })).error, 'unauthorized');

  const f409 = makeFakeFetch([
    { path: '/api/admin/setup', status: 409, body: { ok: false, error: 'credential-exists' } },
  ]);
  assert.equal((await api.setupPasscode('tok', 'new-admin-pass', { fetchImpl: f409 })).error, 'credential-exists');
});

test('changePasscode: success refreshes the stored credential (session kept)', async () => {
  freshState(null);
  const future = new Date(Date.now() + 3600_000).toISOString();
  setAuthV2({ sessionToken: 'cps1.1.a', sessionExpiry: future, offlineSession: true, credential: CRED });
  const rotated = { ...CRED, salt: 'cc'.repeat(16), version: 2 };
  const f = makeFakeFetch([
    { path: '/api/admin/passcode', body: { ok: true, credential: rotated } },
  ]);
  const r = await api.changePasscode('cur', 'next-pass', { fetchImpl: f });
  assert.equal(r.ok, true);
  const auth = storage.readAdminAuth();
  assert.deepEqual(auth.credential, rotated);
  assert.equal(auth.sessionToken, 'cps1.1.a', 'session survives a passcode change');
  const sent = JSON.parse(f.calls[0].opts.body);
  assert.deepEqual(sent, { current: 'cur', next: 'next-pass' });
});

test('changePasscode: weak next passcode fails before any network call', async () => {
  freshState(null);
  const f = makeFakeFetch([{ path: '/api/admin/passcode', body: { ok: true } }]);
  const r = await api.changePasscode('cur', '123', { fetchImpl: f });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'weak-passcode');
  assert.equal(f.calls.length, 0);
});

test('changePasscode: 401 with an active session → "session expired" message', async () => {
  freshState(null);
  const future = new Date(Date.now() + 3600_000).toISOString();
  setAuthV2({ sessionToken: 'cps1.1.a', sessionExpiry: future, offlineSession: true });
  const f401 = makeFakeFetch([
    { path: '/api/admin/passcode', status: 401, body: { ok: false, error: 'invalid-credential' } },
  ]);
  const r = await api.changePasscode('cur', 'next-pass', { fetchImpl: f401 });
  assert.equal(r.ok, false);
  assert.match(r.message, /session/i);
});

test('credential priority: valid session wins over the raw token; expired session falls back to the token', async () => {
  freshState('raw-token');
  const future = new Date(Date.now() + 3600_000).toISOString();
  const past = new Date(Date.now() - 3600_000).toISOString();

  setAuthV2({ sessionToken: 'cps1.valid', sessionExpiry: future });
  const f1 = makeFakeFetch([
    { path: '/api/admin/status', body: { format: 'cgpa-pilot-admin-status', hasCatalog: false, hasPublished: false } },
  ]);
  await api.getBackendStatus({ fetchImpl: f1 });
  assert.equal(f1.calls[0].opts.headers.authorization, 'Bearer cps1.valid');

  setAuthV2({ sessionToken: 'cps1.expired', sessionExpiry: past });
  const f2 = makeFakeFetch([
    { path: '/api/admin/status', body: { format: 'cgpa-pilot-admin-status', hasCatalog: false, hasPublished: false } },
  ]);
  await api.getBackendStatus({ fetchImpl: f2 });
  assert.equal(f2.calls[0].opts.headers.authorization, 'Bearer raw-token');

  // With NEITHER a session nor a saved raw token → no Authorization header.
  ls.clear();
  setAuthV2({});
  const f3 = makeFakeFetch([
    { path: '/api/admin/status', body: { format: 'cgpa-pilot-admin-status', hasCatalog: false, hasPublished: false } },
  ]);
  await api.getBackendStatus({ fetchImpl: f3 });
  assert.equal(f3.calls[0].opts.headers.authorization, undefined);
});

test('legacy v1 auth record migrates to v2 on first read (hash preserved, session kept)', async () => {
  ls.clear();
  ls.setItem('cgpa-pilot.admin.auth.v1', JSON.stringify({ passHash: 'old-digest', session: true }));
  const auth = storage.readAdminAuth();
  assert.equal(auth.v, 2);
  assert.equal(auth.offlineSession, true);
  assert.equal(auth.legacyPassHash, 'old-digest');
  assert.equal(auth.credential, null);
  // The v1 key is retired.
  assert.equal(ls.getItem('cgpa-pilot.admin.auth.v1'), null);
  assert.ok(ls.getItem('cgpa-pilot.admin.auth.v2'));
});
