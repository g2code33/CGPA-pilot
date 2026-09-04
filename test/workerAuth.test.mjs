// ─────────────────────────────────────────────────────────────────────────
// worker — single-admin authentication (the ONE passcode, every device):
//
//   auth-state: public probe, hasCredential false → true after setup
//   setup:      operator-token only; creates the credential; 409 on repeat;
//               weak passcode 400; wrong operator token 401
//   login:      correct passcode → session token + credential params (NEVER
//               the plaintext); wrong passcode 401; no credential 404
//   sessions:   valid session authorizes admin routes; forged session 401;
//               expired session 401; raw operator token still works
//   passcode:   change requires the current one; old passcode stops working
//               online after a change (stale local credentials can't win)
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.ts';
import { createD1Stub } from './helpers/d1Stub.mjs';
import { makeValidCatalog } from './helpers/fixtures.mjs';

const TOKEN = 'test-admin-token';
const BASE = 'https://cfg.example.test';
const PASSCODE = 'correct-horse-battery';

function env(overrides = {}) {
  return {
    CONFIG_DB: createD1Stub(),
    ADMIN_TOKEN: TOKEN,
    ASSETS: undefined,
    ...overrides,
  };
}

function req(path, { method = 'GET', token, body } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Operator-token setup; returns the parsed response. */
async function setup(e, { operator = TOKEN, passcode = PASSCODE } = {}) {
  const res = await worker.fetch(
    req('/api/admin/setup', { method: 'POST', token: operator, body: { passcode } }),
    e
  );
  return { status: res.status, doc: await res.json() };
}

async function login(e, passcode, { session } = {}) {
  const res = await worker.fetch(
    req('/api/admin/login', { method: 'POST', token: session ?? null, body: { passcode } }),
    e
  );
  return { status: res.status, doc: await res.json() };
}

test('auth-state reports no credential before setup (and is public)', async () => {
  const e = env();
  const res = await worker.fetch(req('/api/admin/auth-state'), e);
  assert.equal(res.status, 200);
  const doc = await res.json();
  assert.equal(doc.format, 'cgpa-pilot-auth-state');
  assert.equal(doc.configured, true);
  assert.equal(doc.hasCredential, false);
});

test('setup with a wrong operator token is 401', async () => {
  const { status, doc } = await setup(env(), { operator: 'wrong-operator' });
  assert.equal(status, 401);
  assert.equal(doc.error, 'unauthorized');
});

test('setup with a weak passcode is 400', async () => {
  const { status, doc } = await setup(env(), { passcode: '123' });
  assert.equal(status, 400);
  assert.equal(doc.error, 'weak-passcode');
});

test('setup creates the credential, issues a session, and is one-time (409 on repeat)', async () => {
  const e = env();
  const first = await setup(e);
  assert.equal(first.status, 200);
  assert.equal(first.doc.ok, true);
  assert.ok(typeof first.doc.session === 'string' && first.doc.session.startsWith('cps1.'));
  assert.ok(first.doc.credential?.salt && first.doc.credential?.hash);
  assert.equal(first.doc.credential.iterations, 210000);
  // The response must never contain the passcode itself.
  assert.ok(!JSON.stringify(first.doc).includes(PASSCODE));

  const second = await setup(e);
  assert.equal(second.status, 409);
  assert.equal(second.doc.error, 'credential-exists');
});

test('auth-state reports hasCredential after setup', async () => {
  const e = env();
  await setup(e);
  const res = await worker.fetch(req('/api/admin/auth-state'), e);
  const doc = await res.json();
  assert.equal(doc.hasCredential, true);
});

test('login before setup is 404 (no-credential)', async () => {
  const { status, doc } = await login(env(), PASSCODE);
  assert.equal(status, 404);
  assert.equal(doc.error, 'no-credential');
});

test('login with the wrong passcode is 401 (invalid-passcode)', async () => {
  const e = env();
  await setup(e);
  const { status, doc } = await login(e, 'not-the-passcode');
  assert.equal(status, 401);
  assert.equal(doc.error, 'invalid-passcode');
});

test('login with the correct passcode returns a session + credential params (no plaintext)', async () => {
  const e = env();
  await setup(e);
  const { status, doc } = await login(e, PASSCODE);
  assert.equal(status, 200);
  assert.equal(doc.ok, true);
  assert.ok(doc.session.startsWith('cps1.'));
  assert.ok(doc.expiresAt);
  assert.ok(doc.credential.salt && doc.credential.hash);
  assert.ok(!JSON.stringify(doc).includes(PASSCODE));
});

test('a valid session authorizes admin routes (no raw token needed)', async () => {
  const e = env();
  await setup(e);
  const { doc } = await login(e, PASSCODE);
  const res = await worker.fetch(req('/api/admin/status', { token: doc.session }), e);
  assert.equal(res.status, 200);
  const catalog = makeValidCatalog();
  const pub = await worker.fetch(
    req('/api/admin/publish', { method: 'POST', token: doc.session, body: { catalog } }),
    e
  );
  assert.equal(pub.status, 200);
  const pubDoc = await pub.json();
  assert.equal(pubDoc.ok, true);
  assert.equal(pubDoc.adminVersion, 1);
});

test('a forged session token is 401 (HMAC keyed by the operator secret)', async () => {
  const e = env();
  await setup(e);
  const exp = Date.now() + 60_000;
  const forged = `cps1.${exp}.deadbeef`;
  const res = await worker.fetch(req('/api/admin/status', { token: forged }), e);
  assert.equal(res.status, 401);
  const doc = await res.json();
  assert.equal(doc.error, 'invalid-credential');
});

test('an expired session token is 401', async () => {
  const e = env({ SESSION_TTL_MS: '50' }); // 50 ms TTL (test hook)
  await setup(e);
  const { doc } = await login(e, PASSCODE);
  await new Promise((r) => setTimeout(r, 80));
  const res = await worker.fetch(req('/api/admin/status', { token: doc.session }), e);
  assert.equal(res.status, 401);
});

test('a session signed by a DIFFERENT secret is 401 (cross-worker forgery)', async () => {
  const e = env();
  await setup(e);
  const { doc } = await login(e, PASSCODE);
  const other = env({ ADMIN_TOKEN: 'another-operator-token' });
  const res = await worker.fetch(req('/api/admin/status', { token: doc.session }), other);
  assert.equal(res.status, 401);
});

test('the raw operator token still works after setup (automation path)', async () => {
  const e = env();
  await setup(e);
  const res = await worker.fetch(req('/api/admin/status', { token: TOKEN }), e);
  assert.equal(res.status, 200);
});

test('changing the passcode: requires the current one, rotates the digest', async () => {
  const e = env();
  await setup(e);
  const { doc: s1 } = await login(e, PASSCODE);

  // Wrong current passcode → 401 invalid-current.
  const bad = await worker.fetch(
    req('/api/admin/passcode', {
      method: 'POST',
      token: s1.session,
      body: { current: 'nope', next: 'new-passcode-1' },
    }),
    e
  );
  assert.equal(bad.status, 401);
  assert.equal((await bad.json()).error, 'invalid-current');

  // Weak new passcode → 400.
  const weak = await worker.fetch(
    req('/api/admin/passcode', {
      method: 'POST',
      token: s1.session,
      body: { current: PASSCODE, next: '123' },
    }),
    e
  );
  assert.equal(weak.status, 400);
  assert.equal((await weak.json()).error, 'weak-passcode');

  // Valid change → ok + new credential params (new salt + version 2).
  const okRes = await worker.fetch(
    req('/api/admin/passcode', {
      method: 'POST',
      token: s1.session,
      body: { current: PASSCODE, next: 'brand-new-pass-1' },
    }),
    e
  );
  assert.equal(okRes.status, 200);
  const okDoc = await okRes.json();
  assert.equal(okDoc.ok, true);
  assert.equal(okDoc.credential.version, 2);
  assert.notEqual(okDoc.credential.salt, s1.credential.salt); // fresh salt

  // The old passcode no longer signs in (the backend is authoritative).
  const oldLogin = await login(e, PASSCODE);
  assert.equal(oldLogin.status, 401);
  // The new one does.
  const newLogin = await login(e, 'brand-new-pass-1');
  assert.equal(newLogin.status, 200);
});

test('passcode change without a valid credential is 401 (no session)', async () => {
  const e = env();
  await setup(e);
  const res = await worker.fetch(
    req('/api/admin/passcode', {
      method: 'POST',
      token: null,
      body: { current: PASSCODE, next: 'brand-new-pass-1' },
    }),
    e
  );
  assert.equal(res.status, 401);
});

test('login and auth-state still answer (503) when the Worker is not configured', async () => {
  const e = env({ ADMIN_TOKEN: undefined });
  const authState = await worker.fetch(req('/api/admin/auth-state'), e);
  assert.equal(authState.status, 503);
  const loginRes = await worker.fetch(
    req('/api/admin/login', { method: 'POST', body: { passcode: PASSCODE } }),
    e
  );
  assert.equal(loginRes.status, 503);
});
