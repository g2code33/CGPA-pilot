// ─────────────────────────────────────────────────────────────────────────
// Admin branding → the icon the OS shows (v1.0.26).
//
// The complaint this guards: "the app logo must be the one admin set, but it is
// showing the old logo — on desktop and on the installed PWA". Three separate
// causes, all pinned here:
//
//   1. src/services/brandAssets.ts — since v1.0.20 the logo lives in R2 and the
//      catalog stores `asset:<key>`. safeLogoUrl() then REFUSES a remote URL in
//      an offline runtime (Electron file://, Capacitor), so the packaged desktop
//      app could never render it and fell back to the bundled icon. The fix
//      materializes the image into a data URL inside the offline cache; these
//      tests prove the result is what an offline runtime accepts.
//   2. src/config/branding.ts — identity surfaces (favicon, apple-touch-icon,
//      the desktop window/launcher icon) must follow the admin logo even before
//      materialization, because an icon slot has no broken-image failure mode.
//   3. The build-time refresh + Worker/PWA plumbing are covered by
//      desktopPackaging.test.mjs and workerConfig.test.mjs.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeFetch } from './helpers/fixtures.mjs';

const assets = await import('../src/config/assets.ts');
const branding = await import('../src/config/branding.ts');
const runtime = await import('../src/config/runtime.ts');
const brand = await import('../src/services/brandAssets.ts');

const LOGO_TEXT = 'PNG-BYTES-OF-ADMIN-LOGO';
const LOGO_B64 = Buffer.from(LOGO_TEXT, 'utf8').toString('base64');
const ASSET_LOGO = 'asset:catalog/0123456789abcdef.png';

/** Restore whatever the previous tests left on these globals. */
function withGlobals(extra, fn) {
  const names = ['window', 'document', 'location', 'fetch'];
  const saved = names.map((n) => [n, globalThis[n]]);
  Object.assign(globalThis, extra);
  return (async () => {
    try {
      return await fn();
    } finally {
      for (const [n, v] of saved) {
        if (v === undefined) delete globalThis[n];
        else globalThis[n] = v;
      }
    }
  })();
}

const offlineWindow = (bridge) => ({
  location: { protocol: 'file:', hostname: '' },
  cgpaPilot: bridge ?? {},
  addEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
});

// ── 1. materialization: remote reference → offline-usable data URL ─────────

test('imageValueToDataUrl turns an asset reference into an inline image', async () => {
  const fetchImpl = makeFakeFetch([{ path: '/api/assets/', body: LOGO_TEXT, contentType: 'image/png' }]);
  const dataUrl = await brand.imageValueToDataUrl(ASSET_LOGO, { fetchImpl });
  assert.equal(dataUrl, `data:image/png;base64,${LOGO_B64}`, 'the fetched bytes must survive base64 exactly');
  assert.equal(fetchImpl.calls.length, 1);
  assert.match(fetchImpl.calls[0].url, /\/api\/assets\/catalog\/0123456789abcdef\.png$/);
});

test('imageValueToDataUrl accepts a plain remote URL and keeps its served type', async () => {
  const cases = [
    ['image/jpeg', 'data:image/jpeg;base64,'],
    ['image/webp', 'data:image/webp;base64,'],
  ];
  for (const [type, expect] of cases) {
    const fetchImpl = makeFakeFetch([{ path: 'cdn.test', body: LOGO_TEXT, contentType: type }]);
    const url = await brand.imageValueToDataUrl(`https://cdn.test/logo.png`, { fetchImpl });
    assert.ok(String(url).startsWith(expect), `${type} must be honoured over the file extension`);
  }
});

test('imageValueToDataUrl is a no-op for data URLs and rejects unusable values', async () => {
  const inline = `data:image/png;base64,${LOGO_B64}`;
  const never = makeFakeFetch([]); // any request would throw
  assert.equal(await brand.imageValueToDataUrl(inline, { fetchImpl: never }), inline, 'already inline: no request');
  assert.equal(await brand.imageValueToDataUrl(undefined, { fetchImpl: never }), null);
  assert.equal(await brand.imageValueToDataUrl('./local.png', { fetchImpl: never }), null, 'relative paths are already local');
  // Oversize payloads are refused instead of bloating the offline cache.
  const big = makeFakeFetch([{ path: '/api/assets/', body: 'x'.repeat(5_000_000), contentType: 'image/png' }]);
  assert.equal(await brand.imageValueToDataUrl(ASSET_LOGO, { fetchImpl: big }), null);
  // A non-image content type (or none at all) is not an icon.
  const wrong = makeFakeFetch([{ path: '/api/assets/', body: LOGO_TEXT, contentType: 'application/json' }]);
  assert.equal(await brand.imageValueToDataUrl(ASSET_LOGO, { fetchImpl: wrong }), null);
  // Offline / blocked network must resolve to null, never throw.
  const down = makeFakeFetch([{ path: '/api/assets/', throw: 'network down' }]);
  assert.equal(await brand.imageValueToDataUrl(ASSET_LOGO, { fetchImpl: down }), null);
});

test('materializeBrandImages rewrites every image slot without touching the input', async () => {
  const source = {
    appName: 'Sky CGPA',
    logo: ASSET_LOGO,
    appImage: ASSET_LOGO, // same bytes → fetched once
    appIcon: { emoji: '🎓', image: ASSET_LOGO, size: 64 },
    icons: { cgpa: { emoji: '🧮', image: 'https://cdn.test/calc.png' }, empty: { emoji: '⭐' } },
  };
  const fetchImpl = makeFakeFetch([
    { path: '/api/assets/', body: LOGO_TEXT, contentType: 'image/png' },
    { path: 'cdn.test', body: 'CALC', contentType: 'image/png' },
  ]);
  const res = await brand.materializeBrandImages(source, { fetchImpl });
  assert.equal(res.changed, true);
  const a = res.appearance;
  assert.equal(a.logo, `data:image/png;base64,${LOGO_B64}`);
  assert.equal(a.appImage, a.logo);
  assert.equal(a.appIcon.image, a.logo, 'the app-icon slot carries the logo too');
  assert.equal(a.appIcon.size, 64, 'sizing/emoji metadata must survive the rewrite');
  assert.equal(a.icons.cgpa.image, `data:image/png;base64,${Buffer.from('CALC').toString('base64')}`);
  assert.equal(a.icons.empty.image, undefined, 'an emoji-only slot is left alone');
  assert.equal(source.logo, ASSET_LOGO, 'the running catalog object is never mutated');
  assert.equal(
    fetchImpl.calls.filter((c) => c.url.includes('/api/assets/')).length,
    1,
    'one logo reused across slots costs one request'
  );
});

test('materializeBrandImages keeps references when the network is unavailable', async () => {
  const down = makeFakeFetch([{ path: '/api/assets/', throw: 'offline' }]);
  const res = await brand.materializeBrandImages({ logo: ASSET_LOGO }, { fetchImpl: down });
  assert.equal(res.changed, false);
  assert.equal((res.appearance).logo, ASSET_LOGO, 'the reference is untouched');
  assert.equal(res.failed, 1);
});

test('materializeBrandImages bounds the work (a catalog cannot fan out forever)', async () => {
  const many = { icons: {} };
  for (let i = 0; i < brand.MAX_BRAND_IMAGES + 40; i++) {
    many.icons[`slot${i}`] = { emoji: 'x', image: `asset:catalog/${String(i).padStart(16, '0')}.png` };
  }
  const fetchImpl = makeFakeFetch([{ path: '/api/assets/', body: LOGO_TEXT, contentType: 'image/png' }]);
  const res = await brand.materializeBrandImages(many, { fetchImpl });
  assert.ok(res.changed);
  assert.ok(
    fetchImpl.calls.length <= brand.MAX_BRAND_IMAGES,
    `expected at most ${brand.MAX_BRAND_IMAGES} requests, got ${fetchImpl.calls.length}`
  );
});

// ── 2. what an OFFLINE runtime is allowed to render ────────────────────────

test('the packaged desktop app shows the admin logo once it is cached (regression)', () =>
  withGlobals({ window: offlineWindow() }, () => {
    const appearance = { logo: ASSET_LOGO };
    // Before materialization the offline runtime must NOT be handed a broken
    // image: this is the guard that made the old logo win on desktop.
    assert.equal(assets.isOfflineRuntime(), true);
    assert.equal(assets.safeLogoUrl(ASSET_LOGO), undefined);
    assert.equal(branding.appLogoImage(appearance), undefined);
    // After materialization it is a data URL — and safeLogoUrl accepts it.
    const cached = { logo: `data:image/png;base64,${LOGO_B64}` };
    assert.equal(branding.appLogoImage(cached), `data:image/png;base64,${LOGO_B64}`);
    assert.ok(brand.isInlineDataImage(cached.logo));
  }));

test('identity surfaces still follow the remote logo while offline', () =>
  withGlobals({ window: offlineWindow() }, () => {
    // A favicon / launcher icon cannot show a "broken image" box: the previous
    // value simply stays, so preferring the admin logo here is strictly better
    // than keeping the bundled artwork until the next sync.
    const url = branding.brandIdentityLogo({ logo: ASSET_LOGO });
    assert.ok(url && url.includes('/api/assets/catalog/0123456789abcdef.png'), String(url));
    assert.equal(branding.brandIdentityLogo(undefined), undefined);
    // data URLs keep winning when present (no needless request).
    assert.equal(
      branding.brandIdentityLogo({ logo: `data:image/png;base64,${LOGO_B64}` }),
      `data:image/png;base64,${LOGO_B64}`
    );
  }));

test('applyBrandIdentity is inert outside a browser and never throws', async () => {
  const saved = withGlobalsClear();
  try {
    branding.applyBrandIdentity(undefined);
    branding.applyBrandIdentity({ logo: `data:image/png;base64,${LOGO_B64}`, appName: 'Sky' });
    await brand.refreshBrandIdentity({ persist: false, fetchImpl: makeFakeFetch([]) });
  } finally {
    saved.restore();
  }
});

/** A DOM-less stand-in for a <link rel=icon> the branding code can write to. */
function makeLink(init = {}) {
  return {
    ...init,
    setAttribute(name, value) {
      this[name] = String(value);
    },
    removeAttribute(name) {
      delete this[name];
    },
  };
}

/** Run a block with NO window/document at all (the plain-node case). */
function withGlobalsClear() {
  const saved = { window: globalThis.window, document: globalThis.document };
  delete globalThis.window;
  delete globalThis.document;
  return {
    restore() {
      if (saved.window !== undefined) globalThis.window = saved.window;
      if (saved.document !== undefined) globalThis.document = saved.document;
    },
  };
}

test('a set bridge failure cannot break the app', () =>
  withGlobals(
    {
      window: offlineWindow({
        setBrandIcon: () => {
          throw new Error('old preload without the channel');
        },
      }),
      document: { querySelectorAll: () => [] },
    },
    () => {
      branding.applyBrandIdentity({ logo: `data:image/png;base64,${LOGO_B64}`, appName: 'Sky' });
    }
  ));

// ── 3. the boot/sync hook: cache + favicon + desktop shell ─────────────────

test('refreshBrandIdentity caches the materialized logo and hands it to the desktop shell', async () => {
  const icons = [makeLink({ href: 'icon-512.png', type: 'image/png' })];
  const bridgeCalls = [];
  const catalog = {
    universities: [],
    curricula: [],
    version: 7,
    updatedAt: null,
    cachedAt: new Date(0).toISOString(),
    source: 'backend',
    appearance: { appName: 'Sky CGPA', logo: ASSET_LOGO, appIcon: { emoji: '🎓' } },
  };
  runtime.setRuntimeCatalog(catalog);
  const fetchImpl = makeFakeFetch([{ path: '/api/assets/', body: LOGO_TEXT, contentType: 'image/png' }]);
  await withGlobals(
    {
      window: offlineWindow({
        setBrandIcon: (logo, name) => {
          bridgeCalls.push([logo, name]);
          return Promise.resolve({ ok: true });
        },
      }),
      document: { querySelectorAll: () => icons },
    },
    async () => {
      const done = await brand.refreshBrandIdentity({ fetchImpl, persist: false });
      assert.ok(done, 'the refreshed appearance is returned');
      // 1. the running catalog now carries an offline-usable data URL…
      assert.equal(runtime.getRuntimeCatalog().appearance?.logo, `data:image/png;base64,${LOGO_B64}`);
      // …so the very next render (and the next offline boot) shows the admin logo.
      assert.equal(branding.appLogoImage(runtime.getRuntimeCatalog().appearance), `data:image/png;base64,${LOGO_B64}`);
      // 2. the browser tab icon was swapped to the same bytes,
      assert.equal(icons[0].href, `data:image/png;base64,${LOGO_B64}`);
      assert.equal(icons[0].type, 'image/png');
      // 3. and the desktop shell got the logo twice: first the resolvable
      // remote URL (identity must follow immediately, the main process can
      // fetch https:// itself), then the offline-usable data URL.
      const dataUrl = `data:image/png;base64,${LOGO_B64}`;
      assert.equal(bridgeCalls.length, 2, JSON.stringify(bridgeCalls));
      assert.match(bridgeCalls[0][0], /\/api\/assets\/catalog\/0123456789abcdef\.png$/);
      assert.equal(bridgeCalls[1][0], dataUrl);
      assert.equal(bridgeCalls[0][1], 'Sky CGPA', 'the admin product name rides along for the launcher label');
      assert.equal(bridgeCalls[1][1], 'Sky CGPA');
      // Concurrent calls share one pass (no double download storm).
      const [a, b] = await Promise.all([
        brand.refreshBrandIdentity({ fetchImpl, persist: false }),
        brand.refreshBrandIdentity({ fetchImpl, persist: false }),
      ]);
      assert.equal(a, b);
    }
  );
  // An already-materialized cache needs no network at all.
  const never = makeFakeFetch([]);
  await withGlobals({ window: offlineWindow(), document: { querySelectorAll: () => [] } }, async () => {
    const before = fetchImpl.calls.length;
    const again = await brand.refreshBrandIdentity({ fetchImpl: never, persist: false });
    assert.equal(again?.logo, `data:image/png;base64,${LOGO_B64}`);
    assert.equal(before, fetchImpl.calls.length);
  });
});

test('an offline boot with a cached catalog applies branding without any request', async () => {
  runtime.setRuntimeCatalog({
    universities: [],
    curricula: [],
    version: 9,
    updatedAt: null,
    cachedAt: new Date(0).toISOString(),
    source: 'local',
    appearance: { appName: 'Sky CGPA', logo: `data:image/png;base64,${LOGO_B64}` },
  });
  const icons = [makeLink({ href: 'icon-512.png' })];
  await withGlobals(
    { window: offlineWindow(), document: { querySelectorAll: () => icons } },
    async () => {
      await brand.refreshBrandIdentity({ fetchImpl: makeFakeFetch([]), persist: false });
      assert.equal(icons[0].href, `data:image/png;base64,${LOGO_B64}`, 'the cached logo is applied as-is');
    }
  );
});

test('no appearance → the bundled identity stays and nothing is requested', async () => {
  runtime.setRuntimeCatalog({
    universities: [],
    curricula: [],
    version: null,
    updatedAt: null,
    cachedAt: new Date(0).toISOString(),
    source: 'seed',
    appearance: undefined,
  });
  const fetchImpl = makeFakeFetch([]);
  const icons = [makeLink({ href: 'icon-512.png' })];
  await withGlobals({ window: offlineWindow(), document: { querySelectorAll: () => icons } }, async () => {
    const res = await brand.refreshBrandIdentity({ fetchImpl, persist: false });
    assert.equal(res, undefined);
    assert.equal(fetchImpl.calls.length, 0);
    assert.equal(icons[0].href, 'icon-512.png', 'the static icon is left in place');
  });
});
