// ─────────────────────────────────────────────────────────────────────────
// Renderer entry resolution + the launch-mode ladder (electron/rendererPath.ts,
// electron/launchMode.ts) — the two pieces that decide whether a packaged
// launch shows a UI. Both are pure so they can be tested without Electron.
//
// These tests exist because the same symptom shipped twice:
//
//   1.0.24  dist/** was asarUnpacked, but the app still called
//           loadFile('…/resources/app.asar/dist/index.html'). Node can read a
//           path through the archive's "unpacked" marker; Chromium's file://
//           loader cannot, and the window stayed blank (ERR_FAILED −2).
//   1.0.25  "fixed" by removing asarUnpack, so the bytes lived only in the
//           archive — same URL, same ERR_FAILED, then a segfault when the dead
//           renderer took the app down.
//
// The rule both violate: never load through the archive, and never retry by
// re-running a deterministic resolver from the start. The zygote/segfault case
// cannot be detected in advance at all, which is why the ladder (and its loop
// guard) is here rather than a heuristic.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  contentTypeFor,
  insideArchive,
  indexOfEntry,
  orderRendererCandidates,
  pickRendererEntry,
  RENDERER_HOST,
  RENDERER_SCHEME,
  rendererCandidatePaths,
  rendererRootDirs,
  rendererStartURL,
  resolveRendererFile,
} from '../electron/rendererPath.ts';
import {
  chooseLaunchMode,
  clampMode,
  escalate,
  LAUNCH_MODES,
  LAUNCH_MODE_ENV,
  LAUNCH_MODE_RESET_FLAG,
  launchFlags,
  markPainted,
  readLaunchState,
  relaunchArgs,
  writeLaunchState,
} from '../electron/launchMode.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

// ── rendererPath ──────────────────────────────────────────────────────────

test('insideArchive knows which paths only Node can read', () => {
  assert.equal(insideArchive('/opt/CGPA-Pilot/resources/app.asar/dist/index.html'), true);
  // Unpacked is a REAL sibling directory whose name happens to contain the
  // archive's — treating it as "inside" was the 1.0.24 mistake in reverse.
  assert.equal(insideArchive('/opt/CGPA-Pilot/resources/app.asar.unpacked/dist/index.html'), false);
  assert.equal(insideArchive('/home/dev/CGPA-pilot/dist/index.html'), false);
  assert.equal(insideArchive('C:\\Program Files\\CGPA-Pilot\\resources\\app.asar\\dist\\index.html'), true);
});

test('the candidate list puts the real unpacked renderer first', () => {
  const appDir = '/opt/CGPA-Pilot/resources/app.asar';
  const mainDir = '/opt/CGPA-Pilot/resources/app.asar/dist-electron';
  const list = rendererCandidatePaths(appDir, mainDir);
  assert.equal(list[0], path.resolve('/opt/CGPA-Pilot/resources/app.asar.unpacked/dist/index.html'));
  assert.ok(!insideArchive(list[0]), 'the first candidate must be loadable by Chromium');
  assert.ok(insideArchive(list[list.length - 1]), 'the archive path must be last');
});

test('ordering prefers existing real paths and never an archive path over them', () => {
  const real = '/tmp/CGPA-sim/resources/app.asar.unpacked/dist/index.html';
  const loose = '/tmp/CGPA-sim/resources/app.asar/dist-electron/../dist/index.html';
  const archive = '/tmp/CGPA-sim/resources/app.asar/dist/index.html';
  const present = new Set([real, archive]); // both "readable" via Node's shim
  const ordered = orderRendererCandidates([archive, loose, real], (f) => present.has(path.resolve(f)));
  assert.equal(ordered[0], path.resolve(real), 'the renderer that exists on disk wins');
  assert.ok(ordered.indexOf(path.resolve(archive)) > ordered.indexOf(path.resolve(real)));
  assert.equal(ordered.filter((f) => insideArchive(f)).length, 1);
  assert.equal(new Set(ordered).size, ordered.length, 'no duplicates');
});

test('a simulated install loads the unpacked file, not the archive path', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cgpa-asar-sim-'));
  try {
    // Mirror the packaged layout: an "archive" path that Node can read (a plain
    // directory here) plus the real unpacked sibling.
    mkdirSync(path.join(dir, 'resources', 'app.asar', 'dist'), { recursive: true });
    mkdirSync(path.join(dir, 'resources', 'app.asar.unpacked', 'dist'), { recursive: true });
    const html = '<!doctype html><html><body><div id="root"></div></body></html>';
    const archiveEntry = path.join(dir, 'resources', 'app.asar', 'dist', 'index.html');
    const unpackedEntry = path.join(dir, 'resources', 'app.asar.unpacked', 'dist', 'index.html');
    writeFileSync(archiveEntry, html);
    writeFileSync(unpackedEntry, html);

    const appDir = path.join(dir, 'resources', 'app.asar');
    const ordered = orderRendererCandidates(
      rendererCandidatePaths(appDir, path.join(appDir, 'dist-electron')),
      (f) => existsSync(f)
    );
    const chosen = pickRendererEntry(ordered, (f) => {
      try {
        return readFileSync(f, 'utf8').includes('<div id="root">');
      } catch {
        return false;
      }
    });
    assert.equal(chosen, unpackedEntry, 'must load the real file, never the archive path');
    assert.ok(!insideArchive(chosen));

    // And a retry has to step ONCE: re-resolving from 0 returns the same file and
    // the second attempt would fail exactly like the first.
    const after = pickRendererEntry(ordered, () => true, indexOfEntry(ordered, chosen) + 1);
    assert.ok(after && after !== chosen, 'a retry must try a different location');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the archive path is still a fallback when nothing else exists', () => {
  const appDir = '/nonexistent/CGPA/resources/app.asar';
  const ordered = orderRendererCandidates(rendererCandidatePaths(appDir, path.join(appDir, 'dist-electron')), () => false);
  assert.ok(ordered.length >= 2);
  assert.equal(ordered[ordered.length - 1], path.resolve(path.join(appDir, 'dist', 'index.html')));
  // Nothing exists → pickRendererEntry with a real predicate yields nothing, but
  // the caller still has an ordered list to report in the diagnostic page.
  assert.equal(pickRendererEntry(ordered, (f) => existsSync(f)), null);
});

test('dev checkout resolution finds the vite output directory', () => {
  const ordered = orderRendererCandidates(
    rendererCandidatePaths(root, path.join(root, 'dist-electron')),
    (f) => existsSync(f)
  );
  assert.ok(ordered.length >= 2);
  assert.equal(insideArchive(ordered[0]), false, 'a dev path is never inside an archive');
});

// ── launchMode ────────────────────────────────────────────────────────────

test('the ladder gets more conservative and then stops', () => {
  assert.equal(LAUNCH_MODES.length, 3);
  assert.deepEqual(LAUNCH_MODES[0].flags, [], 'the normal install keeps the sandbox');
  assert.deepEqual(LAUNCH_MODES[1].flags, ['no-sandbox']);
  assert.deepEqual(LAUNCH_MODES[2].flags, ['no-sandbox', 'no-zygote', 'disable-gpu']);
  for (const mode of LAUNCH_MODES) assert.ok(mode.note, 'each mode is explained to the user');

  const first = escalate(0, 'renderer exited (reason: crashed, code: 111)');
  assert.equal(first.next, 1);
  assert.equal(first.state.reason, 'renderer exited (reason: crashed, code: 111)');
  assert.equal(first.state.failures, 1);
  const second = escalate(1, 'no painted renderer within 12s', first.state);
  assert.equal(second.next, 2);
  assert.equal(second.state.failures, 2);
  // The last rung: no next mode, so nothing relaunches. Without this the app
  // would loop forever on a machine that cannot paint in any mode.
  const last = escalate(2, 'still nothing', second.state);
  assert.equal(last.next, null);
  assert.equal(last.terminal, true);
  assert.equal(last.state.failures, 3);
});

test('mode selection: reset flag, then the relaunch hand-off, then memory', () => {
  assert.equal(chooseLaunchMode({ argv: ['app'], env: {}, state: { mode: 2 } }), 2);
  assert.equal(chooseLaunchMode({ argv: ['app', LAUNCH_MODE_RESET_FLAG], env: { [LAUNCH_MODE_ENV]: '2' }, state: null }), 0);
  assert.equal(chooseLaunchMode({ argv: ['app'], env: { [LAUNCH_MODE_ENV]: '1' }, state: null }), 1);
  assert.equal(chooseLaunchMode({ argv: ['app'], env: { [LAUNCH_MODE_ENV]: '' }, state: { mode: 1 } }), 1);
  assert.equal(chooseLaunchMode({ argv: ['app'], env: {}, state: null }), 0);
  assert.equal(clampMode(99), LAUNCH_MODES.length - 1, 'a bogus remembered mode cannot index past the ladder');
  assert.equal(clampMode('nonsense'), 0);
  assert.equal(clampMode(undefined), 0);
});

test('flags already on the command line are not repeated', () => {
  assert.deepEqual(launchFlags(0), []);
  assert.deepEqual(launchFlags(1), ['no-sandbox']);
  assert.deepEqual(launchFlags(1, ['--no-sandbox']), [], 'a wrapper that already passes it must not double it');
  assert.deepEqual(launchFlags(2), ['no-sandbox', 'no-zygote', 'disable-gpu']);
  assert.deepEqual(launchFlags(77), ['no-sandbox', 'no-zygote', 'disable-gpu'], 'clamped, not undefined');
});

test('a painted launch is remembered, a normal one writes nothing', () => {
  assert.equal(markPainted(0, null), null, 'first launch in the default mode: no file churn');
  const saved = markPainted(1, { mode: 0, failures: 1, reason: 'boom' });
  assert.equal(saved.mode, 1);
  assert.equal(saved.failures, 0);
  assert.ok(saved.paintedAt, 'a timestamp proves which launch worked');
  assert.equal(saved.reason, undefined, 'the old failure is no longer the reason for anything');
});

test('the relaunch keeps the user arguments but not the mode switches', () => {
  const args = relaunchArgs(['/opt/cgpa-pilot', '--launch-mode-default', '--ozone-platform=x11', '/home/u/file.cgpa']);
  assert.deepEqual(args, ['--ozone-platform=x11', '/home/u/file.cgpa']);
});

test('state survives a round trip and tolerates a broken file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cgpa-launch-'));
  try {
    const file = path.join(dir, 'cgpa-pilot', 'launch-mode.json');
    assert.equal(readLaunchState(file), null, 'missing state means the normal mode');
    assert.equal(writeLaunchState(file, { mode: 2, reason: 'no painted renderer within 12s', at: 'now', failures: 2 }), true);
    assert.equal(readLaunchState(file).mode, 2);
    assert.match(readFileSync(file, 'utf8'), /no painted renderer/);
    writeFileSync(file, '{not json');
    assert.equal(readLaunchState(file), null, 'a half-written file must not brick the app');
    // Directory that cannot be created (a file where the parent should be) → false, no throw.
    const blocker = path.join(dir, 'blocker');
    writeFileSync(blocker, 'x');
    assert.equal(writeLaunchState(path.join(blocker, 'sub', 'launch-mode.json'), { mode: 1 }), false);
    // An out-of-range remembered mode is clamped on the way in, not trusted.
    writeFileSync(file, JSON.stringify({ mode: 42 }));
    assert.equal(chooseLaunchMode({ argv: [], env: {}, state: readLaunchState(file) }), LAUNCH_MODES.length - 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the hand-off agrees across a process boundary', () => {
  // What escalate() persists, the child must read the same way whether the state
  // file survived or not — that is the whole point of the env var.
  const dir = mkdtempSync(path.join(tmpdir(), 'cgpa-handoff-'));
  try {
    const file = path.join(dir, 'launch-mode.json');
    const step = escalate(0, 'Zygote could not fork: process_type renderer');
    writeLaunchState(file, step.state);
    const env = { [LAUNCH_MODE_ENV]: String(step.next) };
    assert.equal(chooseLaunchMode({ argv: [], env, state: readLaunchState(file) }), 1);
    assert.equal(chooseLaunchMode({ argv: [], env, state: null }), 1, 'crash before the write still lands on mode 1');
    assert.equal(chooseLaunchMode({ argv: [], env: {}, state: readLaunchState(file) }), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('main.ts wires the ladder to real Electron events (no dead code paths)', () => {
  const main = readFileSync(`${root}/electron/main.ts`, 'utf8');
  assert.match(main, /render-process-gone/, 'a crashed renderer is what triggers escalation');
  assert.match(main, /did-fail-load/, 'a failed load is what triggers a candidate retry');
  assert.match(main, /if \(await advanceLoadSteps\(win\)\) return; \/\/ a later strategy may still paint/, 'a failure tries the remaining strategies first');
  assert.match(main, /failLoad\(win, detail\);/, 'and only then reaches the page');
  assert.match(main, /escalateLaunchMode\(context\)/, 'the exhausted ladder escalates the launch mode');
  assert.match(main, /app\.relaunch/, 'recovery is a relaunch — a dead renderer cannot be revived');
  assert.match(main, /writeLaunchState\(launchModeFile\(\), step\.state\)/, 'the outcome is persisted before relaunching');
  assert.match(main, /process\.env\.CGPA_LAUNCH_MODE = String\(step\.next\)/, 'and handed to the child, which is the loop guard');
  assert.match(main, /if \(escalationsQueued > 0\) return false/, 'one relaunch per process, however many failures arrive');
  assert.match(main, /markRendererAlive/, 'the renderer proves life through app:version');
  assert.match(main, /registerRendererProtocol/, 'and the main process can serve the renderer itself');
  assert.doesNotMatch(main, /loadRenderer[\s\S]{0,400}loadLoaderError\(win, `Loading/, 'a rejected load must never skip the recovery machine');
  assert.match(main, /STARTUP_GRACE_MS/, 'silence counts as a failure, not as success');
  // A diagnostic page that itself looks like a painted UI would mask the bug.
  assert.match(main, /startsWith\('data:'\)/, 'the diagnostic page must never count as a paint');
});

// ── the main-process protocol route ───────────────────────────────────────
//
// `file://` is Chromium reading the disk from a sandboxed process; the custom
// scheme is the main process handing over bytes. The mapping below is the whole
// attack surface of that route, so it is tested as a pure function: what resolves,
// what must 404, and what must never escape its root.

const URLROOT = '/opt/CGPA-Pilot/resources';
const roots = [`${URLROOT}/app.asar.unpacked/dist`, `${URLROOT}/app.asar/dist`];
const has = (files) => (f) => files.includes(path.resolve(f));

test('the start URL is a real origin, not a path', () => {
  const url = new URL(rendererStartURL());
  assert.equal(url.protocol, `${RENDERER_SCHEME}:`);
  assert.equal(url.host, RENDERER_HOST);
  assert.equal(url.pathname, '/index.html');
  // Relative module/asset URLs have to resolve inside the same origin, which is
  // what `standard: true` buys us. Check the arithmetic the renderer will do.
  const asset = new URL('./assets/index-abc.js', url.href);
  assert.equal(asset.origin, url.origin, 'assets must stay same-origin (CSP default-src \'self\')');
  assert.equal(asset.pathname, '/assets/index-abc.js');
});

test('the roots the protocol reads from are ordered like the candidates', () => {
  const list = rendererRootDirs(`${URLROOT}/app.asar`, `${URLROOT}/app.asar/dist-electron`);
  assert.equal(list[0], path.resolve(`${URLROOT}/app.asar.unpacked/dist`));
  assert.ok(list.some((r) => insideArchive(r)), 'the archive stays reachable — Node can read it');
  assert.equal(new Set(list).size, list.length);
});

test('the protocol serves index.html and its assets, from the first root that has them', () => {
  const present = [
    path.resolve(`${URLROOT}/app.asar.unpacked/dist/index.html`),
    path.resolve(`${URLROOT}/app.asar/dist/index.html`),
    path.resolve(`${URLROOT}/app.asar/dist/assets/only-in-archive.js`),
  ];
  const read = has(present);
  assert.deepEqual(resolveRendererFile('/index.html', roots, read), {
    file: path.resolve(`${URLROOT}/app.asar.unpacked/dist/index.html`),
    status: 200,
    fallback: false,
  }, 'the real directory wins over the archive, as everywhere else');
  assert.equal(
    resolveRendererFile('/', roots, read).file,
    path.resolve(`${URLROOT}/app.asar.unpacked/dist/index.html`),
    'the bare origin path is the shell'
  );
  // An asset that only exists in the archive is still served — no filesystem
  // permission or sandbox policy involved, which is the point of the route.
  assert.equal(
    resolveRendererFile('/assets/only-in-archive.js', roots, read).file,
    path.resolve(`${URLROOT}/app.asar/dist/assets/only-in-archive.js`)
  );
  assert.equal(resolveRendererFile('/assets/missing.js', roots, read).status, 404);
  assert.equal(resolveRendererFile('/assets/missing.js', roots, read).fallback, false, 'a missing asset must not silently become HTML');
});

test('client-side routes get the shell; traversal and bad escapes do not', () => {
  const read = has([path.resolve(`${URLROOT}/app.asar.unpacked/dist/index.html`)]);
  const routed = resolveRendererFile('/institution/42/term-3', roots, read);
  assert.equal(routed.status, 200);
  assert.equal(routed.fallback, true, 'extension-less paths are routes, and routes render the app');

  for (const attack of [
    '/../package.json',
    '/../../etc/passwd',
    '/%2e%2e/%2e%2e/etc/passwd',
    '/..%2f..%2fetc/passwd',
    "\\..\\..\\windows\\win.ini",
    '/assets/../../secrets.env',
  ]) {
    const r = resolveRendererFile(attack, roots, (f) => f.endsWith('index.html') && !insideArchive(f));
    assert.ok(!r.file || path.resolve(r.file).startsWith(path.resolve(roots[0])), `${attack} escaped to ${r.file}`);
  }
  assert.equal(resolveRendererFile('%', roots, read).status, 404, 'a malformed escape is refused, not thrown');
});

test('content types are what a module-loading page needs', () => {
  assert.match(contentTypeFor('a/index.html'), /^text\/html/);
  assert.match(contentTypeFor('a/assets/x.js'), /text\/javascript/, 'ES modules are refused without a JS MIME type');
  assert.equal(contentTypeFor('a/x.mjs'), contentTypeFor('a/x.js'));
  assert.match(contentTypeFor('a/assets/x.css'), /^text\/css/);
  assert.match(contentTypeFor('a/manifest.webmanifest'), /manifest/);
  assert.equal(contentTypeFor('a/icon.png'), 'image/png');
  assert.equal(contentTypeFor('a/unknown.bin'), 'application/octet-stream');
});

test('the renderer treats the desktop scheme as an offline runtime, like file://', () => {
  // src/config/assets.ts decides which logo values are usable; if it only knows
  // `file:` then a `cgpa://` desktop would take a different (untested) code path.
  const assets = readFileSync(`${root}/src/config/assets.ts`, 'utf8');
  const offlineBody = assets.slice(assets.indexOf('export function isOfflineRuntime'), assets.indexOf('export function isOfflineRuntime') + 1200);
  assert.match(offlineBody, /['"]file:['"]/, 'file:// still counts');
  assert.match(offlineBody, new RegExp(`['"]${RENDERER_SCHEME}:['"]`), `${RENDERER_SCHEME}: must count too`);
});

test('the main process registers the scheme before ready and serves every asset index.html asks for', () => {
  const main = readFileSync(`${root}/electron/main.ts`, 'utf8');
  const register = main.indexOf('registerSchemesAsPrivileged');
  const ready = main.indexOf('app.whenReady().then('); // the real call, not the prose about it
  assert.ok(register > 0 && ready > 0 && register < ready, 'Electron requires privileged schemes before app ready');
  assert.match(main, /corsEnabled: true/, 'module scripts are fetched with CORS even from a privileged scheme');
  assert.match(main, /'access-control-allow-origin': '\*'/);

  const distIndex = path.join(root, 'dist', 'index.html');
  if (!existsSync(distIndex)) return undefined; // `dist/` only exists after a web build
  const read = (f) => existsSync(f);
  const distRoots = [path.join(root, 'dist')];
  const html = readFileSync(distIndex, 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^https?:|^data:/.test(u));
  assert.ok(refs.length >= 2, 'the built index should reference its assets: ' + refs.join(' '));
  for (const ref of refs) {
    const pathname = new URL(ref, 'http://x/').pathname;
    const r = resolveRendererFile(pathname, distRoots, read);
    assert.equal(r.status, 200, `${ref} is referenced by index.html but the protocol cannot serve it`);
    assert.ok(readFileSync(r.file).length > 0, `${ref} resolves to an empty file`);
  }
  return undefined;
});

test('the page CSP admits the desktop scheme, so a rescued launch cannot be blocked by it', () => {
  // The whole point of the fallback is that it works on a machine where the normal
  // route failed; if 'self' did not match `cgpa:` the fallback would trade a blank
  // window for a console full of refused subresources and nothing to learn from.
  const html = readFileSync(`${root}/index.html`, 'utf8');
  const meta = /http-equiv="Content-Security-Policy"\s*content="([^"]+)"/.exec(html);
  assert.ok(meta, 'index.html must ship a CSP meta');
  for (const clause of meta[1].split(';')) {
    const directive = clause.trim().split(/\s+/)[0];
    if (!["default-src", "script-src", "style-src", "img-src", "font-src", "connect-src"].includes(directive)) continue;
    assert.ok(clause.includes("'self'"), `${directive} must keep 'self'`);
    assert.ok(clause.includes(`${RENDERER_SCHEME}:`), `${directive} must also allow ${RENDERER_SCHEME}: (the desktop route)`);
  }
});
