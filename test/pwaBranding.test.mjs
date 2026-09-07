// ─────────────────────────────────────────────────────────────────────────
// The PWA side of the admin logo: the Pages `/app-icon` proxy is EXECUTED here
// against a stubbed Worker, not merely pattern-matched.
//
// This is the path an *installed* PWA reads its icon from (the manifest's first
// entry), and it broke once already: the Worker answers with `cache-control:
// immutable`, so if the Pages proxy forwarded that, a rebranded logo would never
// reach a phone or a desktop PWA that had cached the first one. A regex over the
// source cannot prove the response headers are what the code actually produces, so
// the real function is imported and called.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { onRequest } from '../functions/app-icon.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const ADMIN_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

/** Replace global fetch for one test; returns what the function asked for. */
function stubFetch(t, impl) {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), init });
    return impl(String(url), init);
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return seen;
}

function context(url = 'https://cgpa-pilot.pages.dev/app-icon') {
  return { request: new Request(url), next: async () => new Response('none') };
}

test('the proxy serves the admin logo with a short TTL, never immutable', async (t) => {
  stubFetch(t, () => {
    // Exactly what the Worker sends: immutable, because on its own origin the
    // URL is content-hashed (?v=<sha>) and safe to cache forever.
    return new Response(ADMIN_PNG, {
      status: 200,
      headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable' },
    });
  });
  const res = await onRequest(context());
  assert.equal(res.status, 200);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), ADMIN_PNG, 'the bytes must pass through intact');
  const cache = res.headers.get('cache-control') ?? '';
  assert.doesNotMatch(cache, /immutable/, 'an immutable copy freezes the installed PWA icon on the first logo');
  assert.match(cache, /max-age=\d+/, 'a real TTL so a rebrand propagates');
  assert.ok(Number(cache.match(/max-age=(\d+)/)[1]) <= 3600, `${cache} is too long to be a branding update`);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('access-control-allow-origin'), '*', 'a PWA on another origin must still read it');
});

test('the proxy asks the Worker to skip its caches', async (t) => {
  const seen = stubFetch(t, () => new Response(ADMIN_PNG, { status: 200, headers: { 'content-type': 'image/png' } }));
  await onRequest(context());
  assert.equal(seen.length, 1, 'one upstream fetch, no retries to hide behind');
  assert.match(seen[0].url, /\/app-icon$/, 'it must fetch the icon endpoint: ' + seen[0].url);
  assert.equal(seen[0].init?.headers?.['cache-control'], 'no-cache');
  assert.equal(seen[0].init?.cf?.cacheTtl, 0, "Cloudflare's edge cache must not hold the old logo");
});

test('the upstream content type is forwarded, so WebP/JPEG logos stay valid', async (t) => {
  for (const type of ['image/webp', 'image/jpeg', 'image/svg+xml']) {
    stubFetch(t, () => new Response(Buffer.from('bytes'), { status: 200, headers: { 'content-type': type } }));
    const res = await onRequest(context());
    assert.equal(res.headers.get('content-type'), type);
  }
  // A non-image body served as 200 (an error page, a JSON 200) must NOT be
  // presented as the icon — it would be cached and shown broken for the TTL.
  for (const type of ['text/html', 'application/json']) {
    stubFetch(t, () => new Response('<html>nope</html>', { status: 200, headers: { 'content-type': type } }));
    const bad = await onRequest(context());
    assert.equal(bad.status, 302, `${type} served as an icon must fall back to the bundled asset`);
  }
  // An asset stored without metadata is octet-stream, and is still a real logo.
  stubFetch(t, () => new Response(ADMIN_PNG, { status: 200, headers: { 'content-type': 'application/octet-stream' } }));
  const blobby = await onRequest(context());
  assert.equal(blobby.status, 200);
  assert.equal(blobby.headers.get('content-type'), 'image/png', 'declared as a PNG so the install accepts it');
  assert.deepEqual(Buffer.from(await blobby.arrayBuffer()), ADMIN_PNG);
});

test('an unreachable or 404-ing Worker falls back to the bundled icon, not an error', async (t) => {
  stubFetch(t, () => {
    throw new Error('worker down');
  });
  const offline = await onRequest(context('https://cgpa-pilot.pages.dev/app-icon?v=1'));
  assert.equal(offline.status, 302, 'a redirect is fine; a 500 makes the install show no icon at all');
  assert.equal(new URL(offline.headers.get('location')).pathname, '/icon-512.png');
  assert.ok(!offline.headers.get('location').includes('app.asar'), 'the fallback is a real static asset');

  stubFetch(t, () => new Response('no logo', { status: 404 }));
  const missing = await onRequest(context());
  assert.equal(missing.status, 302);
  assert.equal(new URL(missing.headers.get('location')).pathname, '/icon-512.png');
});

test('the icon endpoint exists in the three places a client may ask for it', () => {
  // Pages proxy (installed PWA), Worker route (API origin), and the static
  // manifest must all name the SAME path — a typo in one is invisible until the
  // icon is wrong on someone's home screen.
  const fn = readFileSync(`${root}/functions/app-icon.js`, 'utf8');
  const worker = readFileSync(`${root}/worker/src/index.ts`, 'utf8');
  const manifest = JSON.parse(readFileSync(`${root}/public/manifest.webmanifest`, 'utf8'));
  assert.match(fn, /\/app-icon/, 'the proxy fetches the worker endpoint');
  assert.match(worker, /['"]\/app-icon['"]|\/app-icon/, 'the worker routes it');
  assert.equal(manifest.icons[0].src.replace(/^\//, ''), 'app-icon', 'the manifest prefers it');
  assert.ok(existsSync(`${root}/public/icon-512.png`), 'and the static fallback exists');
  // Every entry has to be a size the platform accepts, with a purpose set.
  for (const icon of manifest.icons) {
    assert.match(icon.sizes, /^\d+x\d+$/, `bad sizes for ${icon.src}: ${icon.sizes}`);
    assert.ok(icon.purpose === 'any' || icon.purpose === 'maskable' || icon.purpose === 'any maskable');
  }
  const any = manifest.icons.filter((i) => i.purpose.includes('any'));
  const maskable = manifest.icons.filter((i) => i.purpose.includes('maskable'));
  assert.ok(any.length && any.some((i) => i.src === '/app-icon'), 'any-purpose icon is the admin logo');
  assert.ok(maskable.length && maskable.some((i) => i.src === '/app-icon'), 'maskable icon is too');
});

test('the worker and the static manifest offer the same icon set', () => {
  // The Worker generates its manifest dynamically (hashed icon URL). If the two
  // ever disagree on which sizes exist, an install from one origin loses icons.
  const worker = readFileSync(`${root}/worker/src/index.ts`, 'utf8');
  const manifest = JSON.parse(readFileSync(`${root}/public/manifest.webmanifest`, 'utf8'));
  const staticSizes = new Set(manifest.icons.map((i) => i.sizes));
  assert.ok(staticSizes.has('512x512'), 'the 512 tile is what Android/laptops use');
  const workerText = worker.replace(/\\`/g, '`');
  for (const size of staticSizes) {
    if (size === '512x512') continue;
    assert.ok(
      workerText.includes(size) || /sizes: *\$|`${size}`/.test(workerText) || /\\d\{3\}x/.test(workerText),
      `the worker never mentions ${size}`
    );
  }
  assert.match(workerText, /app-icon\?v=/, 'the worker cache-busts its own icon URL');
});

test('both entries keep the hooks the branding rewrites', () => {
  // applyBrandIdentity swaps the href of these tags at runtime; if an entry stops
  // declaring them (or renames the rel), the tab/home-screen icon silently goes
  // back to the shipped artwork.
  const branding = readFileSync(`${root}/src/config/branding.ts`, 'utf8');
  const selector = branding.match(/querySelectorAll<HTMLLinkElement>\(\s*\n?\s*"([^"]+)"/);
  assert.ok(selector, 'branding.ts must select the icon links to rewrite');
  const rels = selector[1]
    .split(',')
    .map((part) => part.trim().match(/rel='([^']+)'/)?.[1])
    .filter(Boolean);
  assert.deepEqual(rels, ['icon', 'shortcut icon', 'apple-touch-icon']);
  for (const page of ['index.html', 'admin.html']) {
    const html = readFileSync(path.join(root, page), 'utf8');
    for (const rel of rels.filter((r) => r !== 'shortcut icon')) {
      assert.match(html, new RegExp(`rel="${rel}"`), `${page} must declare a link[rel="${rel}"] for the branding to swap`);
      assert.match(
        html,
        new RegExp(`rel="${rel}"[^>]*href="[^"]*"`),
        `${page}: the link needs an href the app can replace`
      );
    }
  }
});
