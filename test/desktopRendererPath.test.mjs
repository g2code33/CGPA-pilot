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
  insideArchive,
  indexOfEntry,
  orderRendererCandidates,
  pickRendererEntry,
  rendererCandidatePaths,
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
  assert.match(main, /escalateLaunchMode\(detail\)/, 'exhausted candidates hand over to the ladder');
  assert.match(main, /app\.relaunch/, 'recovery is a relaunch — a dead renderer cannot be revived');
  assert.match(main, /writeLaunchState\(launchModeFile\(\), step\.state\)/, 'the outcome is persisted before relaunching');
  assert.match(main, /process\.env\.CGPA_LAUNCH_MODE = String\(step\.next\)/, 'and handed to the child, which is the loop guard');
  assert.match(main, /if \(escalationsQueued > 0\) return false/, 'one relaunch per process, however many failures arrive');
  assert.match(main, /markRendererAlive/, 'the renderer proves life through app:version');
  assert.match(main, /STARTUP_GRACE_MS/, 'silence counts as a failure, not as success');
  // A diagnostic page that itself looks like a painted UI would mask the bug.
  assert.match(main, /startsWith\('data:'\)/, 'the diagnostic page must never count as a paint');
});
