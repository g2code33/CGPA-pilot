// ─────────────────────────────────────────────────────────────────────────
// The packaging contract, checked against a REAL asar archive.
//
// `asarUnpack` in package.json and the candidate ordering in electron/main.ts only
// matter together, and neither can be verified by reading a config file: what has
// to be true is that after electron-builder packs the app, the path the loader
// prefers is a real file with the renderer in it, while the path that *looks*
// right through Node (inside the archive) is the one Chromium cannot open.
//
// So this test packs a fixture app the way the build does, with @electron/asar, and
// runs the shipped resolver against the result. If the archive layout or the
// ordering ever drifts apart again, this fails — which is exactly the bug that
// shipped twice (1.0.24, 1.0.25) and produced "blank window, Segmentation fault".
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { insideArchive, orderRendererCandidates, pickRendererEntry, rendererCandidatePaths } from '../electron/rendererPath.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const build = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')).build;
const require = createRequire(import.meta.url);

/** electron-builder ships @electron/asar; without it there is nothing to pack. */
let asar = null;
try {
  asar = require('@electron/asar');
} catch {
  asar = null;
}

const RENDERER = '<!doctype html><html><head><title>t</title></head><body><div id="root"></div><script src="assets/main.js"></script></body></html>';

// Packing note — the glob dialect. `@electron/asar`'s own `unpack` option matches
// against the absolute source path, so the fixture passes a "two-stars / dist /
// two-stars" glob. electron-builder does NOT use that option: it decides per file
// with a minimatch against the archive-relative path (AsarPackager
// .createPackageFromFiles → unpackPattern(file)) and copies the matches into
// `app.asar.unpacked/<pathInArchive>` itself. The `asarUnpack` entry in
// package.json is that second form, and the 1.0.24 .deb proved it works — that build
// did ship `app.asar.unpacked/dist`; the bug was loading through the marker instead.
// Both routes end in the same on-disk shape, which is what this test checks. (And
// yes: a glob containing "star star slash" must not be written inside a /* */
// comment — that is a real way to break a file, so comments here use //.)

async function packApp(t, { unpack }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cgpa-asar-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const app = path.join(dir, 'resources', 'app');
  mkdirSync(path.join(app, 'dist', 'assets'), { recursive: true });
  mkdirSync(path.join(app, 'dist-electron'), { recursive: true });
  writeFileSync(path.join(app, 'dist', 'index.html'), RENDERER);
  writeFileSync(path.join(app, 'dist', 'assets', 'main.js'), 'console.log("ui")');
  writeFileSync(path.join(app, 'dist-electron', 'main.js'), 'module.exports=1');
  writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'cgpa-pilot', version: '0' }));
  const archive = path.join(dir, 'resources', 'app.asar');
  const options = unpack ? { unpack: '**/dist/**' } : {};
  await asar.createPackageWithOptions(app, archive, options);
  // electron-builder unpacks into a sibling of the archive, and Node keeps
  // reading through the marker — the trap in both broken releases.
  return { dir, resources: path.join(dir, 'resources'), appAsar: archive, appDir: app };
}

/** What Chromium's file:// loader can do: real files only. */
const chromiumReadable = (file) => !insideArchive(file) && existsSync(file);

test('the config half: dist is unpacked, and the archive is still on', (t) => {
  if (!asar) return t.skip('@electron/asar not installed');
  assert.equal(build.asar, true, 'asar keeps the JS payload out of loose files');
  const patterns = (build.asarUnpack ?? []).map((p) => String(p).split(path.sep).join('/'));
  assert.ok(
    patterns.includes('dist/**/*'),
    `asarUnpack must list the renderer tree in the form electron-builder matches ` +
      `per file against archive-relative paths (got ${JSON.stringify(patterns)})`
  );
  // A file listed in both files[] and asarUnpack[] is written twice on purpose:
  // once into the archive header (as a marker) and once as a real file.
  assert.ok(build.files.includes('dist/**/*'));
  return undefined;
});

test('a packed app leaves the renderer as a real file the loader can read', async (t) => {
  if (!asar) return t.skip('@electron/asar not installed');
  const { resources, appAsar } = await packApp(t, { unpack: 'dist/**/*' });

  const realEntry = path.join(resources, 'app.asar.unpacked', 'dist', 'index.html');
  assert.ok(existsSync(realEntry), 'electron-builder must leave the renderer unpacked');
  assert.equal(readFileSync(realEntry, 'utf8'), RENDERER, 'with the bytes intact');
  assert.ok(!existsSync(path.join(resources, 'app.asar.unpacked', 'dist-electron', 'main.js')), 'only dist is unpacked — the main process stays archived');

  // Node can read the "same" path through the archive. That is why the bug was
  // invisible in every dev check: the archive is not empty, it is unreadable
  // only to Chromium.
  const viaArchive = await asar.extractFile(appAsar, path.join('dist', 'index.html'));
  assert.equal(viaArchive.toString('utf8'), RENDERER, 'the marker still answers a Node read');
  const raw = asar.getRawHeader(appAsar).header;
  const header = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const dist = header.files.dist;
  assert.ok(
    dist.unpacked === true || dist.files['index.html'].unpacked === true,
    'inside the archive the renderer is only a pointer — which is exactly what a file:// load cannot follow'
  );

  // …and the shipped ordering must pick the real file, not the readable-looking one.
  const ordered = orderRendererCandidates(
    rendererCandidatePaths(appAsar, path.join(appAsar, 'dist-electron')),
    (f) => existsSync(f)
  );
  const chosen = pickRendererEntry(ordered, (f) => {
    try {
      return readFileSync(f, 'utf8').includes('<div id="root">');
    } catch {
      return false;
    }
  });
  assert.equal(chosen, realEntry);
  assert.equal(insideArchive(chosen), false, 'the entry handed to loadFile must be a real path');
  // A Chromium-style reader finds it too — the important property, since that is
  // the reader that actually has to paint.
  assert.ok(chromiumReadable(chosen));
  assert.equal(
    ordered.filter((f) => chromiumReadable(f))[0],
    chosen,
    'the first candidate a real loader can open must be the one the resolver chose'
  );
  return undefined;
});

test('without asarUnpack the resolver finds nothing real, so the app escalates', async (t) => {
  if (!asar) return t.skip('@electron/asar not installed');
  const { appAsar } = await packApp(t, { unpack: null }); // the 1.0.25 layout — everything in the archive
  const ordered = orderRendererCandidates(
    rendererCandidatePaths(appAsar, path.join(appAsar, 'dist-electron')),
    (f) => existsSync(f)
  );
  // Nothing on disk: every candidate is inside the archive or missing. A build
  // like this is what produced ERR_FAILED, and it must be detectable as such
  // rather than loading a path that only Node can see.
  assert.equal(ordered.length >= 1, true);
  for (const f of ordered) {
    assert.equal(chromiumReadable(f), false, `${f} looks loadable but is not`);
  }
  assert.equal(pickRendererEntry(ordered, chromiumReadable), null, 'no candidate a real loader can open → the launcher reports it and tries the next launch mode');
  // The trap only exists for an asar-aware reader (Electron patches fs), which is
  // exactly why this shipped twice: through the archive the file IS there.
  const listed = await asar.listPackage(appAsar);
  assert.ok(listed.includes(path.sep + path.join('dist', 'index.html')) || listed.some((f) => f.endsWith(path.join('dist', 'index.html'))), `asar-aware readers see dist/index.html in the archive: ${listed.join(' ')}`);
  return undefined;
});

test('the dev layout resolves to the loose dist directory', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cgpa-dev-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'dist-electron'), { recursive: true });
  mkdirSync(path.join(dir, 'dist'), { recursive: true });
  writeFileSync(path.join(dir, 'dist', 'index.html'), RENDERER);
  const mainDir = path.join(dir, 'dist-electron');
  const ordered = orderRendererCandidates(rendererCandidatePaths(dir, mainDir), (f) => existsSync(f));
  const chosen = pickRendererEntry(ordered, (f) => {
    try {
      return readFileSync(f, 'utf8').includes('<div id="root">');
    } catch {
      return false;
    }
  });
  assert.equal(chosen, path.join(dir, 'dist', 'index.html'));
  assert.ok(chromiumReadable(chosen), 'npm run dev:desktop must not depend on asar at all');
});
