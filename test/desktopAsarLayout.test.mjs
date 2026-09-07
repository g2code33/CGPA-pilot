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
import * as nodeFsModule from 'node:fs';
import { fileURLToPath } from 'node:url';

import { insideArchive, orderRendererCandidates, pickRendererEntry, rendererCandidatePaths } from '../electron/rendererPath.ts';
import { collectTree, copyRendererTree, planRendererCopy } from '../electron/rendererExtract.ts';

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

// ── the archive-rescue fallback (electron/rendererExtract.ts) ──────────────
//
// When a package puts the renderer back inside app.asar, the loader cannot read it
// but Node can — so the last thing to try before a blank window is to copy the tree
// out and load the real copy. These run against a real archive, read through a shim
// that emulates Electron's patched fs (which is exactly what makes the bug invisible).

test('collectTree walks a renderer tree with bounds', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cgpa-tree-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const nodeFs = { ...requireFs(), existsSync: (f) => existsSync(f) };
  mkdirSync(path.join(dir, 'assets', 'deep'), { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), RENDERER);
  writeFileSync(path.join(dir, 'assets', 'main.js'), 'a'.repeat(100));
  writeFileSync(path.join(dir, 'assets', 'deep', 'x.js'), 'b');
  const tree = collectTree(dir, nodeFs);
  assert.deepEqual(tree.map((f) => f.relative).sort(), ['assets/deep/x.js', 'assets/main.js', 'index.html']);
  assert.equal(tree.find((f) => f.relative === 'assets/main.js').size, 100);
  assert.deepEqual(collectTree(dir, nodeFs, { maxFiles: 1 }), [], 'a tree too big to copy in full is refused, not half-copied');
  assert.equal(collectTree(dir, nodeFs, { maxBytes: 10 }).length, 0, 'over budget → nothing half-copied');
  assert.deepEqual(collectTree(dir, nodeFs, { maxDepth: 1 }), [], 'a directory it will not enter means an incomplete tree, so nothing at all');
  assert.deepEqual(collectTree(path.join(dir, 'nope'), nodeFs), [], 'a missing root is empty, not an exception');
});

test('the copy plan rewrites only what is not byte-identical', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cgpa-plan-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fs2 = requireFs();
  const src = path.join(dir, 'dist');
  const dst = path.join(dir, 'userData', 'renderer', 'dist');
  mkdirSync(path.join(src, 'assets'), { recursive: true });
  writeFileSync(path.join(src, 'index.html'), RENDERER);
  writeFileSync(path.join(src, 'assets', 'main.js'), 'a'.repeat(200));

  assert.equal(planRendererCopy(src, dst, fs2, fs2).copy.length, 2, 'first run copies everything');
  copyRendererTree(src, dst, fs2, fs2);
  const second = planRendererCopy(src, dst, fs2, fs2);
  assert.equal(second.copy.length, 0, 'a current copy is left alone');
  assert.equal(second.unchanged, 2);
  assert.equal(second.incomplete, false);

  // Same size, different bytes — the case a size-only check would miss forever.
  writeFileSync(path.join(dst, 'assets', 'main.js'), 'b'.repeat(200));
  const third = planRendererCopy(src, dst, fs2, fs2);
  assert.deepEqual(third.copy.map((c) => c.to), [path.join(dst, 'assets', 'main.js')], 'a stale copy is rewritten');
  assert.equal(third.unchanged, 1);

  // Nothing to copy and no entry point → the caller must not pretend it worked.
  const empty = path.join(dir, 'empty');
  mkdirSync(empty, { recursive: true });
  assert.equal(planRendererCopy(empty, path.join(dir, 'nowhere'), fs2, fs2).incomplete, true);
  assert.equal(copyRendererTree(empty, path.join(dir, 'nowhere'), fs2, fs2), null);
});

test('the rescue turns an archive-only renderer into a real loadable file', async (t) => {
  if (!asar) return t.skip('@electron/asar not installed');
  const { appAsar } = await packApp(t, { unpack: null }); // the 1.0.25 layout
  const fs2 = requireFs();
  const read = asarReadShim(appAsar);

  // Nothing outside the archive is loadable…
  const ordered = orderRendererCandidates(rendererCandidatePaths(appAsar, path.join(appAsar, 'dist-electron')), (f) => existsSync(f));
  assert.equal(pickRendererEntry(ordered, (f) => !insideArchive(f) && existsSync(f)), null);
  // …while an asar-aware reader (Node, in Electron) sees the file and its size.
  assert.ok(read.existsSync(path.join(appAsar, 'dist', 'index.html')), 'the bytes are reachable');

  const dst = path.join(path.dirname(appAsar), 'userData', 'renderer', 'dist');
  const out = copyRendererTree(path.join(appAsar, 'dist'), dst, read, fs2);
  assert.ok(out, 'the rescue produced a real tree');
  assert.equal(out.file, path.join(dst, 'index.html'));
  assert.equal(out.copied, 2, 'index.html and its asset are both written');
  assert.ok(!insideArchive(out.file) && existsSync(out.file), 'now it is a real file Chromium can open');
  assert.equal(readFileSync(out.file, 'utf8'), RENDERER);
  assert.equal(readFileSync(path.join(dst, 'assets', 'main.js'), 'utf8'), 'console.log("ui")');
  // And it would be chosen by the same resolver the app uses.
  const after = pickRendererEntry([out.file], (f) => {
    try {
      return fs2.readFileSync(f, 'utf8').includes('<div id="root">');
    } catch {
      return false;
    }
  });
  assert.equal(after, out.file);
  // A second launch copies nothing.
  assert.equal(copyRendererTree(path.join(appAsar, 'dist'), dst, read, fs2).copied, 0);
  assert.ok(!existsSync(path.join(dst, 'dist-electron')), 'only the renderer tree is rescued, never the main process');
  return undefined;
});

test('main.ts actually calls the rescue before it gives up', () => {
  const main = requireFs().readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
  assert.match(main, /rescueRendererFromArchive\(\)/, 'wired into the resolver');
  assert.match(main, /if \(insideArchive\(found\)\) return rescueRendererFromArchive\(\) \?\? found;/, 'an archive path is never accepted silently');
  assert.match(main, /Extracted \$\{out\.copied\} file\(s\)/, 'and it is logged loudly, with the real fix');
});

/** node:fs as one object, for the injected-fs APIs. */
function requireFs() {
  const fs = nodeFsModule;
  return {
    readdirSync: fs.readdirSync,
    statSync: fs.statSync,
    readFileSync: fs.readFileSync,
    existsSync: fs.existsSync,
    mkdirSync: fs.mkdirSync,
    writeFileSync: fs.writeFileSync,
  };
}

/**
 * Emulate Electron's patched fs over an archive: `…/app.asar/dist/index.html` is a
 * readable "file" to it, which is the illusion the real bug lives inside.
 */
function asarReadShim(archive) {
  const raw = asar.getRawHeader(archive).header;
  const header = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const relOf = (file) => path.relative(archive, file).split(path.sep).join('/');
  const nodeAt = (rel) =>
    rel.split('/').filter(Boolean).reduce((node, part) => (node && node.files ? node.files[part] : undefined), header);
  const readFileSync = (file) => asar.extractFile(archive, relOf(file));
  return {
    existsSync: (file) => nodeAt(relOf(file)) !== undefined,
    readdirSync: (dir) => {
      const node = nodeAt(relOf(dir));
      if (!node || !node.files) throw new Error(`ENOTDIR: ${dir}`);
      return Object.keys(node.files);
    },
    statSync: (file) => {
      const node = nodeAt(relOf(file));
      if (!node) throw new Error(`ENOENT: ${file}`);
      return node.files
        ? { isDirectory: () => true, size: 0 }
        : { isDirectory: () => false, size: node.size };
    },
    readFileSync: (file) => Buffer.from(readFileSync(file)),
  };
}
