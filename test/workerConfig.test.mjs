// ─────────────────────────────────────────────────────────────────────────
// worker — full configuration API lifecycle against the real Worker handler
// (with an in-memory D1 stand-in):
//
//   Admin:  (no token) → 401 · (wrong token) → 401 · (secret unset) → 503
//           (valid token + valid catalog) → stored, versions 1
//           second publish → versions 2 (monotonic)
//           invalid catalog → 400 + issues, nothing stored
//   Student: GET /api/config/meta → 404 until published, then version probe
//            GET /api/config/latest → the validated published payload
//            NO token required for reads
//   Static:  non-/api routes pass through to the assets binding
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { __resetLatestAppVersionCache } from '../worker/src/index.ts';
import { createD1Stub } from './helpers/d1Stub.mjs';
import { makeValidCatalog } from './helpers/fixtures.mjs';
import { validateDistributionDocument } from '../src/admin/catalogValidation.ts';

const TOKEN = 'test-admin-token';
const BASE = 'https://cfg.example.test';

function env({ db = true, token = TOKEN } = {}) {
  return {
    CONFIG_DB: db ? createD1Stub() : undefined,
    ADMIN_TOKEN: token,
    ASSETS: undefined,
  };
}

function req(path, { method = 'GET', token, body } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
}

async function publish(e, catalog, { token = TOKEN, note } = {}) {
  return worker.fetch(req('/api/admin/publish', { method: 'POST', token, body: { catalog, note } }), e);
}

test('health probe answers ok', async () => {
  const res = await worker.fetch(req('/api/health'), env());
  assert.equal(res.status, 200);
  const doc = await res.json();
  assert.equal(doc.ok, true);
});

test('public meta is 404 (no-config-published) before anything is published', async () => {
  const res = await worker.fetch(req('/api/config/meta'), env());
  assert.equal(res.status, 404);
  const doc = await res.json();
  assert.equal(doc.format, 'cgpa-pilot-config-meta');
  assert.equal(doc.error, 'no-config-published');
});

test('publish without a token is 401 (token-missing)', async () => {
  const res = await publish(env(), makeValidCatalog(), { token: null });
  assert.equal(res.status, 401);
  const doc = await res.json();
  assert.equal(doc.error, 'token-missing');
});

test('publish with a wrong token is 401 (invalid-credential)', async () => {
  const res = await publish(env(), makeValidCatalog(), { token: 'wrong' });
  assert.equal(res.status, 401);
  const doc = await res.json();
  assert.equal(doc.error, 'invalid-credential');
});

test('publish is disabled (503) when no ADMIN_TOKEN secret is configured', async () => {
  const res = await publish(env({ token: null }), makeValidCatalog(), { token: 'anything' });
  assert.equal(res.status, 503);
  const doc = await res.json();
  assert.equal(doc.error, 'not-configured');
});

test('full lifecycle: admin publish → student meta → student latest → second publish', async () => {
  const e = env();
  const e2 = e; // same D1 stub across calls (authoritative store persists)

  // 1. Admin publishes the first catalog.
  let res = await publish(e2, makeValidCatalog());
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  let doc = await res.json();
  assert.equal(doc.ok, true);
  assert.equal(doc.adminVersion, 1);
  assert.equal(doc.publishedVersion, 1);
  assert.equal(typeof doc.updatedAt, 'string');

  // 2. Student probes the version (cheap meta endpoint, no token).
  res = await worker.fetch(req('/api/config/meta'), e2);
  assert.equal(res.status, 200);
  doc = await res.json();
  assert.equal(doc.format, 'cgpa-pilot-config-meta');
  assert.equal(doc.version, 1);

  // 3. Student downloads the full document — and it validates as a proper
  //    distribution payload (only published, non-personal config).
  res = await worker.fetch(req('/api/config/latest'), e2);
  assert.equal(res.status, 200);
  doc = await res.json();
  assert.equal(doc.format, 'cgpa-pilot-config');
  assert.equal(doc.version, 1);
  const v = validateDistributionDocument(doc.payload);
  assert.equal(v.ok, true, v.issues.join(' · '));
  assert.ok(doc.payload.universities.length > 0);

  // 4. Admin publishes again (same shape, new note) → versions increment.
  res = await publish(e2, makeValidCatalog(), { note: 'second pass' });
  doc = await res.json();
  assert.equal(doc.ok, true);
  assert.equal(doc.adminVersion, 2);
  assert.equal(doc.publishedVersion, 2);

  // 5. Student sees v2 now; the meta probe is the cheap path.
  res = await worker.fetch(req('/api/config/meta'), e2);
  doc = await res.json();
  assert.equal(doc.version, 2);

  // 6. Admin status reports both stored versions.
  res = await worker.fetch(req('/api/admin/status', { token: TOKEN }), e2);
  assert.equal(res.status, 200);
  doc = await res.json();
  assert.equal(doc.format, 'cgpa-pilot-admin-status');
  assert.equal(doc.hasCatalog, true);
  assert.equal(doc.adminVersion, 2);
  assert.equal(doc.hasPublished, true);
  assert.equal(doc.publishedVersion, 2);

  // 7. Admin can pull back the stored catalog (round-trip intact).
  res = await worker.fetch(req('/api/admin/catalog', { token: TOKEN }), e2);
  assert.equal(res.status, 200);
  doc = await res.json();
  assert.equal(doc.format, 'cgpa-pilot-admin-catalog');
  assert.equal(doc.version, 2);
  assert.ok(Array.isArray(doc.catalog.universities));
  assert.ok(Array.isArray(doc.catalog.curricula));
});

test('drafts are stored for admin sync but NEVER reach the student payload', async () => {
  const e = env();
  const res = await publish(e, makeValidCatalog({ addDraft: true }));
  assert.equal(res.status, 200);

  const latest = await (await worker.fetch(req('/api/config/latest'), e)).json();
  assert.ok(latest.payload.curricula.every((c) => c.status === 'published'));
  assert.equal(latest.payload.curricula.length, 1);

  const cat = await (await worker.fetch(req('/api/admin/catalog', { token: TOKEN }), e)).json();
  assert.equal(cat.catalog.curricula.length, 2); // draft travels with the admin catalog
});

test('a catalog failing the publish gate is rejected with issues and nothing is stored', async () => {
  const e = env();
  const res = await publish(e, makeValidCatalog({ duplicateCode: true }));
  assert.equal(res.status, 400);
  const doc = await res.json();
  assert.equal(doc.error, 'validation');
  assert.ok(doc.issues.length > 0);
  assert.ok(doc.issues.some((i) => /duplicate course code/i.test(i)));

  const meta = await worker.fetch(req('/api/config/meta'), e);
  assert.equal(meta.status, 404); // nothing published
});

test('a structurally invalid catalog (orphan programme) is rejected', async () => {
  const e = env();
  const res = await publish(e, makeValidCatalog({ orphanCurriculum: true }));
  assert.equal(res.status, 400);
  const doc = await res.json();
  assert.ok(doc.issues.some((i) => /unknown programme/i.test(i)));
});

test('a non-object catalog body is 400 invalid-body', async () => {
  const e = env();
  // A valid JSON value that is not a catalog object.
  const res = await worker.fetch(
    req('/api/admin/publish', { method: 'POST', token: TOKEN, body: '["not","a","catalog"]' }),
    e
  );
  assert.equal(res.status, 400);
  const doc = await res.json();
  assert.equal(doc.error, 'invalid-body');
});

test('a malformed JSON body is 400 invalid-json', async () => {
  const e = env();
  const res = await worker.fetch(
    req('/api/admin/publish', { method: 'POST', token: TOKEN, body: '{not json' }),
    e
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid-json');
});

test('oversized bodies are 413 without being read', async () => {
  const e = env();
  const r = new Request(`${BASE}/api/admin/publish`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      'content-length': String(99 * 1024 * 1024),
    },
    body: '{"catalog":{}}',
  });
  const res = await worker.fetch(r, e);
  assert.equal(res.status, 413);
});

test('unknown API paths 404; wrong methods 405', async () => {
  const e = env();
  const unknown = await worker.fetch(req('/api/nope'), e);
  assert.equal(unknown.status, 404);
  const deleteStatus = await worker.fetch(req('/api/admin/status', { method: 'DELETE', token: TOKEN }), e);
  assert.equal(deleteStatus.status, 405);
});

test('no D1 binding → 503 not-configured (reads and admin)', async () => {
  const e = env({ db: false });
  const meta = await worker.fetch(req('/api/config/meta'), e);
  assert.equal(meta.status, 503);
  assert.equal((await meta.json()).error, 'not-configured');
  const pub = await publish(e, makeValidCatalog());
  assert.equal(pub.status, 503);
});

test('CORS: preflight 204 + allow-origin on API responses', async () => {
  const e = env();
  const preflight = await worker.fetch(
    new Request(`${BASE}/api/admin/publish`, { method: 'OPTIONS' }),
    e
  );
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  assert.ok((preflight.headers.get('access-control-allow-headers') ?? '').includes('authorization'));

  const meta = await worker.fetch(req('/api/config/meta'), e);
  assert.equal(meta.headers.get('access-control-allow-origin'), '*');
  assert.equal(meta.headers.get('cache-control'), 'no-store');
});

test('static assets pass through the Worker when an ASSETS binding exists', async () => {
  const e = env();
  e.ASSETS = {
    fetch: (request) => Promise.resolve(new Response(`static:${new URL(request.url).pathname}`)),
  };
  const res = await worker.fetch(req('/index.html'), e);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'static:/index.html');

  // /api/* never falls through to static assets.
  const api = await worker.fetch(req('/api/config/meta'), e);
  assert.equal(api.status, 404);
  assert.equal((await api.json()).format, 'cgpa-pilot-config-meta');
});

test('without an ASSETS binding non-API routes 404 (API-only deployment)', async () => {
  const res = await worker.fetch(req('/index.html'), env());
  assert.equal(res.status, 404);
});

// ── PWA identity (manifest + app icon) ────────────────────────────────────
// The admin-set app logo must reach the browser tab + the installed PWA
// (desktop) icon: the Worker serves /manifest.webmanifest and /app-icon
// from the PUBLISHED catalog, falling back to the bundled icon.

test('PWA identity: manifest + /app-icon reflect the admin-set logo', async () => {
  const e = env();
  const LOGO_B64 = Buffer.from('fake-png-bytes-for-test').toString('base64');
  const catalog = {
    ...makeValidCatalog(),
    appearance: { appName: 'Sky CGPA', logo: `data:image/png;base64,${LOGO_B64}` },
  };
  assert.equal((await publish(e, catalog)).status, 200);

  const m = await worker.fetch(req('/manifest.webmanifest'), e);
  assert.equal(m.status, 200);
  assert.match(m.headers.get('content-type') ?? '', /application\/manifest\+json/);
  assert.match(m.headers.get('cache-control') ?? '', /no-store/);
  const doc = await m.json();
  assert.equal(doc.short_name, 'Sky CGPA');
  assert.ok(doc.name.startsWith('Sky CGPA'));
  assert.ok(doc.icons.some((i) => i.src === '/app-icon' && i.purpose === 'any' && i.type === 'image/png'));
  assert.ok(doc.icons.some((i) => i.src === '/app-icon' && i.purpose === 'maskable'));

  const ic = await worker.fetch(req('/app-icon'), e);
  assert.equal(ic.status, 200);
  assert.equal(ic.headers.get('content-type'), 'image/png');
  assert.match(ic.headers.get('cache-control') ?? '', /max-age=300/);
  assert.equal(Buffer.from(await ic.arrayBuffer()).toString('base64'), LOGO_B64);
});

test('PWA identity without a custom logo keeps the bundled icon', async () => {
  const e = env();
  assert.equal((await publish(e, makeValidCatalog())).status, 200);

  const doc = await (await worker.fetch(req('/manifest.webmanifest'), e)).json();
  assert.ok(doc.icons.every((i) => i.src === 'icon-512.png'));

  // /app-icon falls through to the static default icon asset.
  e.ASSETS = { fetch: (request) => Promise.resolve(new Response(`static:${new URL(request.url).pathname}`)) };
  const ic = await worker.fetch(req('/app-icon'), e);
  assert.equal(ic.status, 200);
  assert.equal(await ic.text(), 'static:/icon-512.png');
});

test('PWA identity before any publish still answers (bundled defaults)', async () => {
  const doc = await (await worker.fetch(req('/manifest.webmanifest'), env())).json();
  assert.equal(doc.short_name, 'CGPA Pilot');
  assert.ok(doc.icons.every((i) => i.src === 'icon-512.png'));
});

// ── /api/app/latest (in-app update check for Android/iOS) ─────────────────

test('GET /api/app/latest reports the latest GitHub release version', async () => {
  __resetLatestAppVersionCache();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /api\.github\.com\/repos\/g2code33\/CGPA-pilot\/releases\/latest/);
    return new Response(
      JSON.stringify({
        tag_name: 'v9.9.9',
        html_url: 'https://github.com/g2code33/CGPA-pilot/releases/tag/v9.9.9',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };
  try {
    const res = await worker.fetch(req('/api/app/latest'), env());
    assert.equal(res.status, 200);
    const doc = await res.json();
    assert.equal(doc.ok, true);
    assert.equal(doc.version, '9.9.9');
    assert.match(doc.url, /releases\/tag\/v9\.9\.9/);
  } finally {
    globalThis.fetch = realFetch;
    __resetLatestAppVersionCache();
  }
});

test('GET /api/app/latest is unavailable (silent) when GitHub is unreachable', async () => {
  __resetLatestAppVersionCache();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  try {
    const res = await worker.fetch(req('/api/app/latest'), env());
    assert.equal(res.status, 200);
    const doc = await res.json();
    assert.equal(doc.ok, false);
    assert.equal(doc.error, 'unavailable');
  } finally {
    globalThis.fetch = realFetch;
    __resetLatestAppVersionCache();
  }
});
