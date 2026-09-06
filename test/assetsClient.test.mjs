// ─────────────────────────────────────────────────────────────────────────
// v1.0.20 — client-side asset plumbing:
//
//   src/config/assets.ts     resolveAssetUrl (the single render chokepoint)
//   src/admin/assetUpload.ts  R2 upload with graceful data-URL fallback
//   src/admin/adminApi.ts     upload / migrate / storage-report / creds calls
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeLocalStorage, makeFakeFetch, makeValidCatalog } from './helpers/fixtures.mjs';

const ls = makeLocalStorage();
globalThis.window = { localStorage: ls };

// Node has no FileReader (the fallback path uses it) — minimal polyfill.
class FileReaderPolyfill {
  readAsDataURL(file) {
    file
      .arrayBuffer()
      .then((buf) => {
        this.result = `data:${file.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`;
        if (typeof this.onload === 'function') this.onload();
      })
      .catch((e) => {
        if (typeof this.onerror === 'function') this.onerror(e);
      });
  }
}
globalThis.FileReader = FileReaderPolyfill;

const assets = await import('../src/config/assets.ts');
const assetUpload = await import('../src/admin/assetUpload.ts');
const fileImage = await import('../src/admin/fileImage.ts');
const adminApi = await import('../src/admin/adminApi.ts');
const storage = await import('../src/admin/adminStorage.ts');

function freshState(token = 'tok-123') {
  ls.clear();
  if (token !== null) storage.writeApiToken(token);
}

// ── resolveAssetUrl: the single render chokepoint ─────────────────────────

test('isAssetRef / assetKeyOf / assetRef: the asset:<key> shape', () => {
  assert.equal(assets.isAssetRef('asset:catalog/ab12.png'), true);
  assert.equal(assets.isAssetRef('data:image/png;base64,AAAA'), false);
  assert.equal(assets.isAssetRef('https://x/y.png'), false);
  assert.equal(assets.isAssetRef('asset:'), false);
  assert.equal(assets.isAssetRef(undefined), false);
  assert.equal(assets.assetKeyOf('asset:catalog/ab12.png'), 'catalog/ab12.png');
  assert.equal(assets.assetKeyOf('data:image/png;base64,AAAA'), null);
  assert.equal(assets.assetRef('catalog/ab12.png'), 'asset:catalog/ab12.png');
});

test('resolveAssetUrl: data URLs, https URLs and undefined pass through', () => {
  const dataUrl = 'data:image/png;base64,AAAA';
  assert.equal(assets.resolveAssetUrl(dataUrl), dataUrl);
  assert.equal(assets.resolveAssetUrl('https://example.com/logo.png'), 'https://example.com/logo.png');
  assert.equal(assets.resolveAssetUrl('./icon-512.png'), './icon-512.png');
  assert.equal(assets.resolveAssetUrl(undefined), undefined);
  assert.equal(assets.resolveAssetUrl(''), undefined);
});

test('resolveAssetUrl: asset refs become the Worker asset endpoint', () => {
  // No VITE_CONFIG_API_BASE in tests → same-origin root-relative URL.
  assert.equal(assets.resolveAssetUrl('asset:catalog/ab12.png'), '/api/assets/catalog/ab12.png');
});

// ── uploadImageForCatalog: R2 first, data-URL fallback ────────────────────

const PNG_BYTES = new Uint8Array([1, 2, 3, 4, 5]);

test('uploadImageForCatalog: R2 configured → stores the asset ref', async () => {
  freshState();
  const f = makeFakeFetch([
    { path: '/api/admin/assets', body: { ok: true, ref: 'asset:catalog/zz.png', key: 'catalog/zz.png', bytes: 5, storedBytes: 5 } },
  ]);
  const file = new File([PNG_BYTES], 'logo.png', { type: 'image/png' });
  const r = await assetUpload.uploadImageForCatalog(file, { fetchImpl: f, baseOverride: '' });
  assert.equal(r.ok, true);
  assert.equal(r.image.value, 'asset:catalog/zz.png');
  assert.equal(r.image.isDataUrl, false);
  assert.equal(r.image.bytes, 5);
  assert.equal(r.image.r2NotConfigured, undefined);
  // Sent as a raw image body with the file's content type + auth header.
  const call = f.calls[0];
  assert.equal(call.opts.headers['content-type'], 'image/png');
  assert.equal(call.opts.headers.authorization, 'Bearer tok-123');
  assert.ok(call.opts.body instanceof File);
});

test('uploadImageForCatalog: 503 r2-not-configured → silent data-URL fallback', async () => {
  freshState();
  const f = makeFakeFetch([
    { path: '/api/admin/assets', status: 503, body: { ok: false, error: 'r2-not-configured', message: 'R2_ASSETS is not bound' } },
  ]);
  const file = new File([PNG_BYTES], 'logo.png', { type: 'image/png' });
  const r = await assetUpload.uploadImageForCatalog(file, { fetchImpl: f, baseOverride: '' });
  assert.equal(r.ok, true);
  assert.ok(r.image.value.startsWith('data:image/png;base64,'));
  assert.equal(r.image.isDataUrl, true);
  assert.equal(r.image.bytes, 5);
  assert.equal(r.image.r2NotConfigured, true);
});

test('uploadImageForCatalog: backend unreachable → data-URL fallback (offline-safe)', async () => {
  freshState();
  const f = makeFakeFetch([]); // every URL throws → unreachable
  const file = new File([PNG_BYTES], 'logo.png', { type: 'image/png' });
  const r = await assetUpload.uploadImageForCatalog(file, { fetchImpl: f, baseOverride: '' });
  assert.equal(r.ok, true);
  assert.equal(r.image.isDataUrl, true);
  assert.equal(r.image.r2NotConfigured, false); // we don't KNOW it's unconfigured
});

test('uploadImageForCatalog: not signed in → error (no silent fallback)', async () => {
  freshState(null);
  const f = makeFakeFetch([
    { path: '/api/admin/assets', body: { ok: true, ref: 'asset:x', key: 'x', bytes: 5 } },
  ]);
  const file = new File([PNG_BYTES], 'logo.png', { type: 'image/png' });
  const r = await assetUpload.uploadImageForCatalog(file, { fetchImpl: f, baseOverride: '' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unauthorized');
});

test('prepareImageForCatalog: small image passes through (no DOM decode needed)', async () => {
  const small = new File([PNG_BYTES], 'logo.png', { type: 'image/png' });
  const r = await fileImage.prepareImageForCatalog(small);
  assert.equal(r.file, small);
  assert.equal(r.resized, false);
  assert.equal(r.originalBytes, small.size);
});

test('prepareImageForCatalog: oversized image is a typed too-large error outside the browser', async () => {
  const big = new File([new Uint8Array(3 * 1024 * 1024)], 'big.png', { type: 'image/png' });
  await assert.rejects(() => fileImage.prepareImageForCatalog(big), (e) => {
    assert.equal(e instanceof fileImage.ImageFileError, true);
    assert.equal(e.code, 'too-large');
    return true;
  });
});

test('uploadImageForCatalog: wrong file type / oversize are refused before any network call', async () => {
  freshState();
  const f = makeFakeFetch([
    { path: '/api/admin/assets', body: { ok: true, ref: 'asset:x', key: 'x', bytes: 5 } },
  ]);
  const text = new File(['hello'], 'notes.txt', { type: 'text/plain' });
  const r1 = await assetUpload.uploadImageForCatalog(text, { fetchImpl: f, baseOverride: '' });
  assert.equal(r1.ok, false);
  assert.equal(r1.error, 'not-an-image');

  const big = new File([new Uint8Array(3 * 1024 * 1024)], 'big.png', { type: 'image/png' });
  const r2 = await assetUpload.uploadImageForCatalog(big, { fetchImpl: f, baseOverride: '' });
  assert.equal(r2.ok, false);
  assert.equal(r2.error, 'too-large');
  assert.equal(f.calls.length, 0, 'no upload attempted for rejected files');
});

// ── adminApi: the four new backend calls ──────────────────────────────────

test('uploadAdminAsset: 413 → asset-too-large; 401 → unauthorized', async () => {
  freshState();
  const f = makeFakeFetch([
    { path: '/api/admin/assets', status: 413, body: { ok: false, error: 'asset-too-large', message: 'over 2 MB' } },
  ]);
  const file = new File([PNG_BYTES], 'logo.png', { type: 'image/png' });
  const r = await adminApi.uploadAdminAsset(file, { fetchImpl: f, baseOverride: '' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'asset-too-large');

  const f2 = makeFakeFetch([
    { path: '/api/admin/assets', status: 401, body: { ok: false, error: 'invalid-token' } },
  ]);
  const r2 = await adminApi.uploadAdminAsset(file, { fetchImpl: f2, baseOverride: '' });
  assert.equal(r2.ok, false);
  assert.equal(r2.error, 'unauthorized');
});

test('migrateCatalogToAssets: sends the working catalog, returns the slimmed one', async () => {
  freshState();
  const catalog = makeValidCatalog();
  const slim = JSON.parse(JSON.stringify(catalog));
  const f = makeFakeFetch([
    {
      path: '/api/admin/migrate-assets',
      body: { ok: true, moved: 2, bytesMoved: 900, catalogBytes: 4_000_000, slimmedBytes: 120_000, catalog: slim },
    },
  ]);
  const r = await adminApi.migrateCatalogToAssets(catalog, { fetchImpl: f, baseOverride: '' });
  assert.equal(r.ok, true);
  assert.equal(r.moved, 2);
  assert.equal(r.catalogBytes, 4_000_000);
  assert.equal(r.slimmedBytes, 120_000);
  assert.deepEqual(r.catalog, slim);
  // The working catalog travelled as the JSON body (unsaved edits preserved).
  const body = JSON.parse(f.calls[0].opts.body);
  assert.equal(body.universities[0].id, 'uni-1');
});

test('migrateCatalogToAssets: 503 → r2-not-configured (setup hint for the UI)', async () => {
  freshState();
  const f = makeFakeFetch([
    { path: '/api/admin/migrate-assets', status: 503, body: { ok: false, error: 'r2-not-configured', message: 'no bucket' } },
  ]);
  const r = await adminApi.migrateCatalogToAssets(makeValidCatalog(), { fetchImpl: f, baseOverride: '' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'r2-not-configured');
});

test('getStorageReport: returns the report doc; 401 → unauthorized', async () => {
  freshState();
  const report = {
    ok: true,
    bucket: { configured: true, usage: { payloadBytes: 100, objectCount: 2 }, freeTierBytes: 10 * 1024 ** 3 },
    account: { ok: true, totalBytes: 300, buckets: [{ name: 'b', bytes: 300, objects: 2 }] },
    hasCreds: true,
  };
  const f = makeFakeFetch([{ path: '/api/admin/storage', body: report }]);
  const r = await adminApi.getStorageReport({ fetchImpl: f, baseOverride: '' });
  assert.deepEqual(r, report);

  const f2 = makeFakeFetch([{ path: '/api/admin/storage', status: 401, body: { ok: false, error: 'invalid-token' } }]);
  const r2 = await adminApi.getStorageReport({ fetchImpl: f2, baseOverride: '' });
  assert.equal(r2.ok, false);
  assert.equal(r2.error, 'unauthorized');
});

test('saveStorageCreds: ok path + creds-invalid (Cloudflare rejected the token)', async () => {
  freshState();
  const f = makeFakeFetch([
    { path: '/api/admin/storage', body: { ok: true, hasCreds: true } },
  ]);
  const r = await adminApi.saveStorageCreds('cf-token', 'acct-1', { fetchImpl: f, baseOverride: '' });
  assert.equal(r.ok, true);
  const sent = JSON.parse(f.calls[0].opts.body);
  assert.deepEqual(sent, { cf_token: 'cf-token', cf_account_id: 'acct-1' });

  const f2 = makeFakeFetch([
    { path: '/api/admin/storage', status: 401, body: { ok: false, error: 'creds-invalid', message: '10000 Authentication error' } },
  ]);
  const r2 = await adminApi.saveStorageCreds('bad', 'acct-1', { fetchImpl: f2, baseOverride: '' });
  assert.equal(r2.ok, false);
  assert.equal(r2.error, 'creds-invalid');
  assert.match(r2.message, /Authentication error/);
});

test('clearStorageCreds: posts { clear: true }', async () => {
  freshState();
  const f = makeFakeFetch([{ path: '/api/admin/storage', body: { ok: true, hasCreds: false } }]);
  const r = await adminApi.clearStorageCreds({ fetchImpl: f, baseOverride: '' });
  assert.equal(r.ok, true);
  assert.deepEqual(JSON.parse(f.calls[0].opts.body), { clear: true });
});
