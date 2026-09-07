// ─────────────────────────────────────────────────────────────────────────
// scripts/verify-branding.mjs — the diagnostic the app tells users to run is
// itself executed here, against fabricated install trees.
//
// The point is not coverage of a nice-to-have script: it is the only artifact that
// turns "the window is blank" / "the logo is still old" into a machine-readable
// answer, and it is worthless if it cries wolf or, worse, prints PASS over the
// exact layout that cannot load (a renderer inside app.asar). So both layouts are
// asserted, with every network endpoint pointed at a closed port so nothing this
// test does depends on the internet.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const script = path.join(root, 'scripts/verify-branding.mjs');
const HICOLOR = [16, 24, 32, 48, 64, 96, 128, 256, 512];
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

/** Offline flags: every HTTP target is a closed port on localhost. */
const OFFLINE = ['--api', 'http://127.0.0.1:9', '--origin', 'http://127.0.0.1:9', '--timeout', '1500'];

function fakeInstall(withUnpackedRenderer) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cgpa-verify-'));
  const app = path.join(dir, 'opt', 'CGPA-Pilot');
  const home = path.join(dir, 'home');
  const resources = path.join(app, 'resources');
  mkdirSync(resources, { recursive: true });
  mkdirSync(path.join(home, '.config', 'cgpa-pilot', 'brand'), { recursive: true });
  mkdirSync(path.join(home, '.local', 'share', 'applications'), { recursive: true });
  const brand = path.join(home, '.config', 'cgpa-pilot', 'brand', 'icon.png');
  writeFileSync(brand, PNG_1PX);
  writeFileSync(path.join(resources, 'app.asar'), 'ARCHIVE');

  const html = '<!doctype html><html><body><div id="root"></div></body></html>';
  if (withUnpackedRenderer) {
    const dist = path.join(resources, 'app.asar.unpacked', 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(path.join(dist, 'index.html'), html);
  }
  // The broken layout needs no simulation beyond the missing unpacked file: the
  // renderer bytes are inside app.asar, which is precisely what Chromium's
  // file:// loader cannot read. `html` stays unused there on purpose.

  for (const size of HICOLOR) {
    const apps = path.join(home, '.local', 'share', 'icons', 'hicolor', `${size}x${size}`, 'apps');
    mkdirSync(apps, { recursive: true });
    symlinkSync(brand, path.join(apps, 'cgpa-pilot.png'));
  }
  writeFileSync(
    path.join(home, '.local', 'share', 'applications', 'cgpa-pilot.desktop'),
    ['[Desktop Entry]', 'Name=KNUST Portal', 'Exec="/opt/CGPA-Pilot/cgpa-pilot" %U', 'Icon=cgpa-pilot', 'StartupWMClass=cgpa-pilot', ''].join('\n')
  );
  return { dir, app, home };
}

function run(args, env) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: env.home },
    timeout: 60000,
  });
}

test('a package with the renderer inside app.asar is reported as broken', (t) => {
  const world = fakeInstall(false);
  t.after(() => rmSync(world.dir, { recursive: true, force: true }));
  const res = run(['--install', world.app, ...OFFLINE], world);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /FAIL/);
  assert.match(res.stdout, /inside the archive/, 'names the actual defect: ' + res.stdout);
  assert.match(res.stdout, /asarUnpack/, 'and the fix: the package must ship dist unpacked');
});

test('a correct install passes, and every surface is accounted for', (t) => {
  const world = fakeInstall(true);
  t.after(() => rmSync(world.dir, { recursive: true, force: true }));
  const res = run(['--install', world.app, ...OFFLINE], world);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /renderer entry[\s\S]{0,120}a real file every loader can read/);
  assert.match(res.stdout, /hicolor icons — all 9 sizes point at/);
  assert.match(res.stdout, /desktop override[\s\S]{0,160}Name="KNUST Portal"/);
  assert.match(res.stdout, /PASS — every checked surface agrees/);
  // An offline box must not be told its deployment is broken.
  assert.match(res.stdout, /no HTTP endpoint answered from here/, 'network failures degrade to warnings offline');
  assert.doesNotMatch(res.stdout, /launch mode[\s\S]{0,80}FAIL/);
});

test('a stale copied hicolor icon is flagged, not waved through', (t) => {
  const world = fakeInstall(true);
  t.after(() => rmSync(world.dir, { recursive: true, force: true }));
  const link = path.join(world.home, '.local', 'share', 'icons', 'hicolor', '256x256', 'apps', 'cgpa-pilot.png');
  unlinkSync(link);
  writeFileSync(link, Buffer.from('the old logo, copied verbatim by an earlier build'));
  const res = run(['--install', world.app, ...OFFLINE], world);
  assert.match(
    res.stdout,
    /1\/9 sizes differ from the persisted brand logo/,
    'a menu icon that is not the admin logo must be named: ' + res.stdout
  );
  assert.match(res.stdout, /FAIL — 1 problem/, 'and it must be a failure, not a note');
});

test('a remembered escalation is shown so a blank window has an explanation', (t) => {
  const world = fakeInstall(true);
  t.after(() => rmSync(world.dir, { recursive: true, force: true }));
  writeFileSync(
    path.join(world.home, '.config', 'cgpa-pilot', 'launch-mode.json'),
    JSON.stringify({ mode: 2, failures: 3, reason: 'renderer exited (reason: crashed, code: 111)' })
  );
  const res = run(['--install', world.app, ...OFFLINE], world);
  assert.match(res.stdout, /launch mode — mode 2, failures 3/);
  assert.match(res.stdout, /--launch-mode-default/, 'the retry-from-the-top hatch is printed when it is needed');
});

test('the script itself is plain node — no dependencies, no build step', () => {
  const source = readFileSync(script, 'utf8');
  const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.ok(imports.length, 'the script should import its builtins');
  for (const specifier of imports) {
    assert.match(specifier, /^node:/, `verify-branding must only use builtins, got "${specifier}"`);
  }
  assert.doesNotMatch(source, /\brequire\(/, 'builtins only, and ESM throughout');
  const check = spawnSync(process.execPath, ['--check', script], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
});
