// ─────────────────────────────────────────────────────────────────────────
// v1.0.20 — R2 asset storage: worker module + routes.
//
//   Module (worker/src/assets.ts, fake bucket):
//     storeAsset        content-addressed key, dedup, MIME + size guards
//     migrateCatalogAssets  every data URL → asset ref (incl. trash deep scan)
//     bucketUsage       paginated list totals
//     getAccountR2Usage whole-account R2 via (injected) Cloudflare API
//
//   Routes (real Worker handler, in-memory D1 + R2 stubs):
//     POST /api/admin/assets        auth · 503 no-R2 · 400 not-image · 413
//     GET  /api/assets/<key>        public · immutable cache · CORS · 404
//     POST /api/admin/migrate-assets  body catalog → slimmed refs (idempotent)
//     GET/POST /api/admin/storage    report + validated Cloudflare creds
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.ts';
import {
  storeAsset,
  migrateCatalogAssets,
  bucketUsage,
  getAccountR2Usage,
  MAX_ASSET_BYTES,
} from '../worker/src/assets.ts';
import { createD1Stub } from './helpers/d1Stub.mjs';
import { createR2Stub } from './helpers/r2Stub.mjs';
import { makeValidCatalog } from './helpers/fixtures.mjs';

const TOKEN = 'test-admin-token';
const BASE = 'https://assets.example.test';

function envWithR2({ r2 = true, db = true, token = TOKEN } = {}) {
  return {
    CONFIG_DB: db ? createD1Stub() : undefined,
    ADMIN_TOKEN: token,
    ASSETS: undefined,
    R2_ASSETS: r2 ? createR2Stub() : undefined,
  };
}

function req(path, { method = 'GET', token, body, headers: extra } = {}) {
  const h = { accept: 'application/json', ...(extra ?? {}) };
  if (token) h.authorization = `Bearer ${token}`;
  let raw;
  if (body !== undefined) {
    // Raw image bodies (ArrayBuffer/typed arrays) pass through untouched;
    // everything else is JSON.
    if (typeof body === 'string' || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
      raw = body;
    } else {
      raw = JSON.stringify(body);
      h['content-type'] = 'application/json';
    }
  }
  return new Request(`${BASE}${path}`, { method, headers: h, body: raw });
}

const PNG_3 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PNG_A = PNG_3;
const PNG_B = new Uint8Array([...PNG_3, 0xff]);
const dataUrl = (b64, mime = 'image/png') => `data:${mime};base64,${b64}`;
const B64_A = Buffer.from(PNG_A).toString('base64');
const B64_B = Buffer.from(PNG_B).toString('base64');

// ── storeAsset ────────────────────────────────────────────────────────────

test('storeAsset: content-addressed key, ref + url, stored bytes', async () => {
  const bucket = createR2Stub();
  const stored = await storeAsset(bucket, PNG_A, 'image/png');
  assert.match(stored.key, /^catalog\/[0-9a-f]{16}\.png$/);
  assert.equal(stored.ref, `asset:${stored.key}`);
  assert.equal(stored.url, `/api/assets/${stored.key}`);
  assert.equal(stored.bytes, PNG_A.byteLength);
  // The bytes + content type are what get served later.
  const obj = await bucket.get(stored.key);
  assert.equal(obj.size, PNG_A.byteLength);
  assert.equal(obj.httpMetadata.contentType, 'image/png');
});

test('storeAsset: same bytes → same key (dedup on re-upload)', async () => {
  const bucket = createR2Stub();
  const a = await storeAsset(bucket, PNG_A, 'image/png');
  const b = await storeAsset(bucket, PNG_A, 'image/png');
  assert.equal(a.key, b.key);
  const c = await storeAsset(bucket, PNG_B, 'image/png');
  assert.notEqual(a.key, c.key);
});

test('storeAsset: rejects unsupported MIME, empty and oversize payloads', async () => {
  const bucket = createR2Stub();
  await assert.rejects(() => storeAsset(bucket, PNG_A, 'image/svg+xml'), /unsupported image type/);
  await assert.rejects(() => storeAsset(bucket, new Uint8Array(0), 'image/png'), /empty image/);
  const big = new Uint8Array(MAX_ASSET_BYTES + 1);
  await assert.rejects(() => storeAsset(bucket, big, 'image/png'), /limit is 2 MB/);
});

// ── migrateCatalogAssets ──────────────────────────────────────────────────

function catalogWithImages() {
  const c = makeValidCatalog();
  c.appearance = {
    appName: 'Test',
    logo: dataUrl(B64_A),
    appIcon: { image: dataUrl(B64_B), emoji: '🧭', size: 48 },
    appImage: dataUrl(B64_B),
    taglineImage: undefined,
    icons: { calculate: { image: dataUrl(B64_A), emoji: '🧮' } },
  };
  c.universities[0].logo = dataUrl(B64_B);
  c.universities[0].schools[0].logo = dataUrl(B64_A);
  // Recycle-bin snapshot with data URLs nested at odd depths (deep scan).
  c.trash = [
    { id: 'trash-1', kind: 'school', label: 'Old School', deletedAt: '2026-01-01', data: { logo: dataUrl(B64_B), deep: { list: [dataUrl(B64_A)] } } },
  ];
  return c;
}

test('migrateCatalogAssets: rewrites every known field to asset refs', async () => {
  const bucket = createR2Stub();
  const c = catalogWithImages();
  const snapshot = JSON.parse(JSON.stringify(c));
  const r = await migrateCatalogAssets(bucket, c);
  assert.match(r.catalog.appearance.logo, /^asset:catalog\/[0-9a-f]{16}\.png$/);
  assert.match(r.catalog.appearance.appIcon.image, /^asset:catalog\/[0-9a-f]{16}\.png$/);
  assert.match(r.catalog.appearance.appImage, /^asset:catalog\/[0-9a-f]{16}\.png$/);
  assert.match(r.catalog.appearance.icons.calculate.image, /^asset:catalog\/[0-9a-f]{16}\.png$/);
  assert.match(r.catalog.universities[0].logo, /^asset:catalog\/[0-9a-f]{16}\.png$/);
  assert.match(r.catalog.universities[0].schools[0].logo, /^asset:catalog\/[0-9a-f]{16}\.png$/);
  // The input catalog is not mutated.
  assert.equal(JSON.stringify(c), JSON.stringify(snapshot));
  // Every referenced object exists in the bucket.
  const ref = (v) => v.slice('asset:'.length);
  for (const v of [
    r.catalog.appearance.logo,
    r.catalog.appearance.appImage,
    r.catalog.universities[0].logo,
  ]) {
    assert.ok(await bucket.get(ref(v)), 'bucket must contain the referenced key');
  }
});

test('migrateCatalogAssets: dedups identical images (2 unique images → 2 puts)', async () => {
  const bucket = createR2Stub();
  const c = catalogWithImages();
  const r = await migrateCatalogAssets(bucket, c);
  // A appears in 4 places (logo, icon, school logo, trash), B in 4 places.
  assert.equal(r.moved, 2);
  assert.equal(bucket.puts.length, 2);
  assert.equal(r.bytesMoved, PNG_A.byteLength + PNG_B.byteLength);
  // Same image → same ref, everywhere.
  assert.equal(r.catalog.appearance.logo, r.catalog.appearance.icons.calculate.image);
  assert.equal(r.catalog.appearance.appIcon.image, r.catalog.appearance.appImage);
});

test('migrateCatalogAssets: deep-scans recycle-bin snapshots and writes back in place', async () => {
  const bucket = createR2Stub();
  const c = catalogWithImages();
  const r = await migrateCatalogAssets(bucket, c);
  const t = r.catalog.trash[0];
  assert.match(t.data.logo, /^asset:catalog\/[0-9a-f]{16}\.png$/);
  assert.match(t.data.deep.list[0], /^asset:catalog\/[0-9a-f]{16}\.png$/);
  // No data:image string may remain anywhere in the migrated catalog.
  assert.ok(!JSON.stringify(r.catalog).includes('data:image'), 'no base64 images remain');
});

test('migrateCatalogAssets: already-migrated catalog is a no-op (idempotent)', async () => {
  const bucket = createR2Stub();
  const c = catalogWithImages();
  const first = await migrateCatalogAssets(bucket, c);
  const second = await migrateCatalogAssets(bucket, first.catalog);
  assert.equal(second.moved, 0);
  assert.equal(second.bytesMoved, 0);
  assert.equal(JSON.stringify(second.catalog), JSON.stringify(first.catalog));
});

// ── bucketUsage ───────────────────────────────────────────────────────────

test('bucketUsage: sums paginated list (limit 2, 5 objects → 3 pages)', async () => {
  const bucket = createR2Stub();
  for (let i = 0; i < 5; i++) await bucket.put(`catalog/k${i}`, new Uint8Array([i]), { httpMetadata: { contentType: 'image/png' } });
  await bucket.put('other/not-counted', new Uint8Array([1, 1, 1]), { httpMetadata: { contentType: 'image/png' } });
  // Force small pages by patching list.
  const origList = bucket.list.bind(bucket);
  bucket.list = (opts = {}) => origList({ limit: 2, ...opts });
  const u = await bucketUsage(bucket);
  assert.equal(u.objectCount, 5);
  assert.equal(u.payloadBytes, 5); // 1 byte each, prefix catalog/ only
});

// ── getAccountR2Usage ─────────────────────────────────────────────────────

function fakeCfFetch(routes) {
  const calls = [];
  const f = async (url, opts = {}) => {
    calls.push(url);
    for (const [suffix, status, doc] of routes) {
      if (String(url).endsWith(suffix)) {
        return new Response(JSON.stringify(doc), { status, headers: { 'content-type': 'application/json' } });
      }
    }
    throw new Error(`fakeCfFetch: unstubbed URL ${url}`);
  };
  return { f, calls };
}

test('getAccountR2Usage: sums per-bucket payloadSize across the account', async () => {
  const { f, calls } = fakeCfFetch([
    ['/r2/buckets', 200, { success: true, result: [{ name: 'proj-a' }, { name: 'proj b' }] }],
    ['/r2/buckets/proj-a/usage', 200, { success: true, result: { payloadSize: '1000000', objectCount: '10' } }],
    ['/r2/buckets/proj%20b/usage', 200, { success: true, result: { payloadSize: '2500000', objectCount: '3' } }],
  ]);
  const u = await getAccountR2Usage('tok', 'acct-1', f);
  assert.equal(u.buckets.length, 2);
  assert.equal(u.buckets[0].name, 'proj b'); // sorted descending
  assert.equal(u.buckets[0].payloadBytes, 2_500_000);
  assert.equal(u.totalBytes, 3_500_000);
  assert.equal(u.totalObjects, 13);
  assert.equal(calls.length, 3);
  assert.ok(String(calls[2]).includes('proj%20b'), 'bucket name is URL-encoded');
});

test('getAccountR2Usage: a dead bucket is skipped, the rest is kept', async () => {
  const { f } = fakeCfFetch([
    ['/r2/buckets', 200, { success: true, result: [{ name: 'a' }, { name: 'b' }] }],
    ['/r2/buckets/a/usage', 500, { success: false, errors: [] }],
    ['/r2/buckets/b/usage', 200, { success: true, result: { payloadSize: '42', objectCount: '1' } }],
  ]);
  const u = await getAccountR2Usage('tok', 'acct-1', f);
  assert.equal(u.buckets.length, 1);
  assert.equal(u.buckets[0].name, 'b');
  assert.equal(u.totalBytes, 42);
});

test('getAccountR2Usage: rejects with the Cloudflare error detail on 403', async () => {
  const { f } = fakeCfFetch([
    ['/r2/buckets', 403, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] }],
  ]);
  await assert.rejects(() => getAccountR2Usage('bad', 'acct-1', f), /10000 Authentication error/);
});

// ── Routes ────────────────────────────────────────────────────────────────

test('POST /api/admin/assets: 503 r2-not-configured when no bucket is bound', async () => {
  const res = await worker.fetch(req('/api/admin/assets', { method: 'POST', token: TOKEN, body: PNG_A.buffer, headers: { 'content-type': 'image/png' } }), envWithR2({ r2: false }));
  assert.equal(res.status, 503);
  const doc = await res.json();
  assert.equal(doc.error, 'r2-not-configured');
});

test('POST /api/admin/assets: 401 without a valid credential', async () => {
  const res = await worker.fetch(req('/api/admin/assets', { method: 'POST', token: null, body: PNG_A.buffer, headers: { 'content-type': 'image/png' } }), envWithR2());
  assert.equal(res.status, 401);
});

test('POST /api/admin/assets: 400 for a non-image content type', async () => {
  const res = await worker.fetch(req('/api/admin/assets', { method: 'POST', token: TOKEN, body: 'hello', headers: { 'content-type': 'text/plain' } }), envWithR2());
  assert.equal(res.status, 400);
  const doc = await res.json();
  assert.equal(doc.error, 'not-an-image');
});

test('POST /api/admin/assets: 413 over the 2 MB cap (content-length fast path)', async () => {
  const big = new Uint8Array(MAX_ASSET_BYTES + 1);
  const res = await worker.fetch(
    req('/api/admin/assets', { method: 'POST', token: TOKEN, body: big.buffer, headers: { 'content-type': 'image/png' } }),
    envWithR2()
  );
  assert.equal(res.status, 413);
  const doc = await res.json();
  assert.equal(doc.error, 'asset-too-large');
});

test('POST /api/admin/assets: stores the image and returns the catalog ref', async () => {
  const e = envWithR2();
  const res = await worker.fetch(req('/api/admin/assets', { method: 'POST', token: TOKEN, body: PNG_A.buffer, headers: { 'content-type': 'image/png' } }), e);
  assert.equal(res.status, 200);
  const doc = await res.json();
  assert.equal(doc.ok, true);
  assert.match(doc.ref, /^asset:catalog\/[0-9a-f]{16}\.png$/);
  assert.equal(doc.bytes, PNG_A.byteLength);
  const obj = await e.R2_ASSETS.get(doc.key);
  assert.ok(obj);
  assert.equal(obj.size, PNG_A.byteLength);
});

test('GET /api/assets/<key>: public, immutable-cached, CORS-open, correct type', async () => {
  const e = envWithR2();
  const putRes = await worker.fetch(req('/api/admin/assets', { method: 'POST', token: TOKEN, body: PNG_B.buffer, headers: { 'content-type': 'image/jpeg' } }), e);
  const { key } = await putRes.json();
  const res = await worker.fetch(req(`/api/assets/${key}`), e);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes], [...PNG_B]);
});

test('GET /api/assets/<key>: 404 for unknown key, 503 when R2 is unbound', async () => {
  const res = await worker.fetch(req('/api/assets/catalog/doesnotexist.png'), envWithR2());
  assert.equal(res.status, 404);
  const res2 = await worker.fetch(req('/api/assets/catalog/doesnotexist.png'), envWithR2({ r2: false }));
  assert.equal(res2.status, 503);
});

test('POST /api/admin/migrate-assets: slimmed catalog in, base64 out — and idempotent', async () => {
  const e = envWithR2();
  const catalog = catalogWithImages();
  const res = await worker.fetch(req('/api/admin/migrate-assets', { method: 'POST', token: TOKEN, body: catalog }), e);
  assert.equal(res.status, 200);
  const doc = await res.json();
  assert.equal(doc.ok, true);
  assert.equal(doc.moved, 2);
  assert.ok(doc.catalogBytes > doc.slimmedBytes, 'slimmed catalog must be smaller');
  assert.ok(!JSON.stringify(doc.catalog).includes('data:image'));
  assert.match(doc.catalog.universities[0].logo, /^asset:catalog\/[0-9a-f]{16}\.png$/);

  // Second run on the slimmed catalog: nothing left to move.
  const res2 = await worker.fetch(req('/api/admin/migrate-assets', { method: 'POST', token: TOKEN, body: doc.catalog }), e);
  const doc2 = await res2.json();
  assert.equal(doc2.moved, 0);
});

test('POST /api/admin/migrate-assets: 503 without R2, 400 for a malformed body', async () => {
  const res = await worker.fetch(req('/api/admin/migrate-assets', { method: 'POST', token: TOKEN, body: { universities: [] } }), envWithR2({ r2: false }));
  assert.equal(res.status, 503);
  const res2 = await worker.fetch(req('/api/admin/migrate-assets', { method: 'POST', token: TOKEN, body: 'not-json{' }), envWithR2());
  assert.equal(res2.status, 400);
  const doc2 = await res2.json();
  assert.equal(doc2.error, 'invalid-body');
});

// ── /api/admin/storage ────────────────────────────────────────────────────

test('GET /api/admin/storage: bucket usage + no account creds → account null', async () => {
  const e = envWithR2();
  await worker.fetch(req('/api/admin/assets', { method: 'POST', token: TOKEN, body: PNG_A.buffer, headers: { 'content-type': 'image/png' } }), e);
  const res = await worker.fetch(req('/api/admin/storage'), e);
  assert.equal(res.status, 401); // auth required
});

test('GET /api/admin/storage (authed): reports app bucket usage, 10 GB tier', async () => {
  const e = envWithR2();
  await worker.fetch(req('/api/admin/assets', { method: 'POST', token: TOKEN, body: PNG_A.buffer, headers: { 'content-type': 'image/png' } }), e);
  const res = await worker.fetch(req('/api/admin/storage', { token: TOKEN }), e);
  assert.equal(res.status, 200);
  const doc = await res.json();
  assert.equal(doc.ok, true);
  assert.equal(doc.bucket.configured, true);
  assert.equal(doc.bucket.usage.payloadBytes, PNG_A.byteLength);
  assert.equal(doc.bucket.usage.objectCount, 1);
  assert.equal(doc.bucket.freeTierBytes, 10 * 1024 * 1024 * 1024);
  assert.equal(doc.hasCreds, false);
  assert.equal(doc.account, null);
});

test('GET /api/admin/storage (unbound R2): bucket.configured false', async () => {
  const res = await worker.fetch(req('/api/admin/storage', { token: TOKEN }), envWithR2({ r2: false }));
  const doc = await res.json();
  assert.equal(doc.bucket.configured, false);
  assert.ok(!doc.bucket.usage);
});

function withFakeCfFetch(routes, fn) {
  const { f } = fakeCfFetch(routes);
  const orig = globalThis.fetch;
  globalThis.fetch = f;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = orig;
    });
}

test('POST /api/admin/storage: validates creds before storing them', async () => {
  const e = envWithR2();
  await withFakeCfFetch(
    [
      ['/r2/buckets', 200, { success: true, result: [{ name: 'b' }] }],
      ['/r2/buckets/b/usage', 200, { success: true, result: { payloadSize: '10', objectCount: '1' } }],
    ],
    async () => {
      const res = await worker.fetch(
        req('/api/admin/storage', { method: 'POST', token: TOKEN, body: { cf_token: 'cf-tok', cf_account_id: 'acct-1' } }),
        e
      );
      assert.equal(res.status, 200);
      const doc = await res.json();
      assert.equal(doc.ok, true);
      assert.equal(doc.hasCreds, true);
      // Stored in D1 (stub), and a GET now reports the account.
      const stored = e.CONFIG_DB._tables.admin_storage.get(1);
      assert.ok(stored);
      assert.equal(JSON.parse(stored.creds_json).cf_token, 'cf-tok');

      const res2 = await worker.fetch(req('/api/admin/storage', { token: TOKEN }), e);
      const doc2 = await res2.json();
      assert.equal(doc2.hasCreds, true);
      assert.equal(doc2.account.ok, true);
      assert.equal(doc2.account.totalBytes, 10);
      assert.deepEqual(doc2.account.buckets, [{ name: 'b', bytes: 10, objects: 1 }]);
    }
  );
});

test('POST /api/admin/storage: 401 creds-invalid when Cloudflare rejects the token', async () => {
  const e = envWithR2();
  await withFakeCfFetch(
    [['/r2/buckets', 403, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] }]],
    async () => {
      const res = await worker.fetch(
        req('/api/admin/storage', { method: 'POST', token: TOKEN, body: { cf_token: 'bad', cf_account_id: 'acct-1' } }),
        e
      );
      assert.equal(res.status, 401);
      const doc = await res.json();
      assert.equal(doc.error, 'creds-invalid');
      assert.ok(String(doc.message).includes('Authentication error'));
      assert.equal(e.CONFIG_DB._tables.admin_storage.size, 0, 'rejected creds are never stored');
    }
  );
});

test('POST /api/admin/storage: invalid body is 400; clear wipes the row', async () => {
  const e = envWithR2();
  const bad = await worker.fetch(req('/api/admin/storage', { method: 'POST', token: TOKEN, body: { cf_token: '' } }), e);
  assert.equal(bad.status, 400);

  // Store valid creds first (validating fetch), then clear.
  await withFakeCfFetch(
    [
      ['/r2/buckets', 200, { success: true, result: [] }],
    ],
    async () => {
      await worker.fetch(req('/api/admin/storage', { method: 'POST', token: TOKEN, body: { cf_token: 'cf-tok', cf_account_id: 'a1' } }), e);
      const clear = await worker.fetch(req('/api/admin/storage', { method: 'POST', token: TOKEN, body: { clear: true } }), e);
      assert.equal(clear.status, 200);
      const doc = await clear.json();
      assert.equal(doc.hasCreds, false);
      assert.equal(e.CONFIG_DB._tables.admin_storage.size, 0);
    }
  );
});
