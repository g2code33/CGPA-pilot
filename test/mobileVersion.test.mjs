// One version everywhere it is declared.
//
// Android installs an update only if `versionCode` went UP, and the shipped APK was
// built with `versionCode 24 / versionName "1.0.24"` while the app was already at
// 1.0.28 — so a phone that had 1.0.24 installed could never be updated in place, and
// nobody noticed because the build succeeded. iOS was worse in a quieter way:
// `MARKETING_VERSION = 1.0`, never touched. These tests make the drift a test failure
// instead of a release that users cannot install.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { planVersionWrites, versionCodeFrom } from '../scripts/sync-mobile-version.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const pkg = JSON.parse(read('package.json'));
const gradle = read('android/app/build.gradle');
const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
const sw = read('public/sw.js');
const scripts = pkg.scripts;

test('versionCode is derived from the version, and cannot collide with itself', () => {
  assert.equal(versionCodeFrom('1.0.28').code, 10028);
  assert.equal(versionCodeFrom('1.0.9').code, 10009);
  assert.equal(versionCodeFrom('1.2.0').code, 10200);
  assert.equal(versionCodeFrom('2.10.99').code, 21099);
  assert.equal(versionCodeFrom('1.0.28').prerelease, false);
  assert.equal(versionCodeFrom('1.1.0-beta.3').code, 10100, 'a beta and its release share a code: same-version reinstall, never a silent downgrade');
  assert.equal(versionCodeFrom('1.1.0-beta.3').prerelease, true);
  assert.ok(versionCodeFrom('1.0.28').code < versionCodeFrom('1.0.29').code, 'the next patch must be installable over this one');
  assert.ok(versionCodeFrom('1.0.99').code < versionCodeFrom('1.1.0').code, 'and so must the next minor');
  assert.throws(() => versionCodeFrom('1.0.100'), /overflows/);
  assert.throws(() => versionCodeFrom('v1.0'), /X\.Y\.Z/);
  assert.throws(() => versionCodeFrom(''), /X\.Y\.Z/);
});

test('every declaration already equals package.json — the release is consistent', () => {
  const { plan } = planVersionWrites({
    version: pkg.version,
    gradle: { file: 'android/app/build.gradle', text: gradle },
    ios: { file: 'project.pbxproj', text: pbx },
    sw: { file: 'public/sw.js', text: sw },
  });
  const stale = plan.filter((p) => p.changed).flatMap((p) => p.applied);
  assert.deepEqual(stale, [], `package.json says ${pkg.version} but:\n${stale.join('\n')}`);
  assert.deepEqual(
    plan.map((p) => p.errors.length),
    [0, 0, 0],
    'every target was found and rewritten in place'
  );
});

test('the fields a store or a package manager reads, verbatim', () => {
  assert.match(gradle, new RegExp(`versionCode\\s+${versionCodeFrom(pkg.version).code}\\b`));
  assert.match(gradle, new RegExp(`versionName\\s+"${pkg.version.replace(/\./g, '\\.')}"`));
  assert.match(pbx, new RegExp(`MARKETING_VERSION = ${pkg.version.replace(/\./g, '\\.')};`, 'g'));
  // Both build configurations, or Release ships the old number.
  assert.equal((pbx.match(/MARKETING_VERSION = [^;]+;/g) ?? []).length, 2, 'Debug and Release must not diverge');
  assert.equal(new Set(pbx.match(/MARKETING_VERSION = [^;]+;/g) ?? []).size, 1, 'and must agree');
  assert.equal(new Set(pbx.match(/CURRENT_PROJECT_VERSION = [^;]+;/g) ?? []).size, 1);
  assert.match(sw, new RegExp(`const CACHE = 'cgpa-pilot-v${pkg.version.replace(/\./g, '\\.')}'`), 'an installed PWA re-caches on release');
});

test('the plan is applied per file, in sequence — not one write per edit', () => {
  // The first version of the script computed each edit from the ORIGINAL text and
  // wrote each result, so for a file with two fields the second write restored what
  // the first had changed. `--check` on the next run caught it still stale.
  const { plan } = planVersionWrites({
    version: '9.9.9',
    gradle: { file: 'g', text: '    defaultConfig {\n        versionCode 24\n        versionName "1.0.24"\n    }' },
    ios: null,
    sw: null,
  });
  assert.equal(plan.length, 1, 'one entry per file');
  const [entry] = plan;
  assert.match(entry.text, /versionCode 90909\s*\n\s*versionName "9\.9\.9"/, 'both fields survive');
  assert.equal(entry.changed, true);
  assert.deepEqual(entry.applied, ['Android versionCode → versionCode 90909', 'Android versionName → versionName "9.9.9"']);
  const again = planVersionWrites({ version: '9.9.9', gradle: { file: 'g', text: entry.text }, ios: null, sw: null });
  assert.equal(again.plan[0].changed, false, 'idempotent: running it twice changes nothing');
});

test('a target whose shape changed is refused, not guessed at', () => {
  const { plan } = planVersionWrites({
    version: '1.0.1',
    gradle: { file: 'g', text: 'android { buildTypes { } }' },
    ios: { file: 'p', text: 'nothing here' },
    sw: { file: 's', text: 'let x = 1;' },
  });
  assert.equal(plan.length, 3);
  for (const item of plan) {
    assert.equal(item.changed, false, 'nothing is written when the shape is unknown');
    assert.ok(item.errors.length > 0, `${item.file} should have reported why`);
  }
});

test('the gates are wired into the mobile scripts, so a release cannot skip them', () => {
  assert.equal(scripts['mobile:version'], 'node scripts/sync-mobile-version.mjs');
  assert.equal(scripts['mobile:version:check'], 'node scripts/sync-mobile-version.mjs --check');
  assert.equal(scripts['mobile:icons'], 'node scripts/mobile-icons.mjs');
  assert.match(scripts['check:mobile'], /sync-mobile-version\.mjs --check/);
  assert.match(scripts['check:mobile'], /mobile-icons\.mjs --check/);
  for (const key of ['mobile:sync', 'mobile:sync:ios', 'mobile:build']) {
    assert.match(scripts[key], /sync-mobile-version\.mjs/, `${key} must sync the version before it builds`);
  }
});

test('the committed repo passes the gate it will be checked against in CI', () => {
  const res = spawnSync(process.execPath, ['scripts/sync-mobile-version.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  assert.match(res.stdout, /android, ios and sw\.js agree on/);
});
