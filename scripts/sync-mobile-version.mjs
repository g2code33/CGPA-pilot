// ─────────────────────────────────────────────────────────────────────────
// VERSION SYNC — one version, written into every manifest that must agree.
//
// `package.json` is the canonical version. Android's `versionCode`/`versionName`
// and iOS's `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` are separate fields that
// nothing linked, so they drifted into a real production fault: the shipped APK
// carried `versionName "1.0.24" / versionCode 24` while the app was at 1.0.28, and
// a stale `versionCode` is not cosmetic — Android refuses to install an update whose
// versionCode is not HIGHER, so a user keeps the old build (or gets "app not
// installed"). iOS sat on `MARKETING_VERSION = 1.0`, which is what TestFlight and
// the App Store show and what makes a resubmission possible at all.
//
// The service worker's cache name is derived here too: `cgpa-pilot-v<version>` means
// an installed PWA re-caches on release instead of serving the previous build's
// assets forever, which is the same class of bug on the web half.
//
//   node scripts/sync-mobile-version.mjs            # write
//   node scripts/sync-mobile-version.mjs --check    # CI gate: exit 1 on drift
//   node scripts/sync-mobile-version.mjs --json     # what it decided
// ─────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle');
const IOS_PROJECT = path.join(ROOT, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
const SW = path.join(ROOT, 'public', 'sw.js');
/** Android: 8 digits max, and the fields below must not be able to collide. */
const MAJOR_BASE = 10000;
const MINOR_BASE = 100;

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);

/**
 * `1.0.28` -> `10028`; `1.2.0-beta.3` -> `10200` with the pre-release noted.
 * A pre-release keeps the code of its release so a beta and its RC cannot install
 * over each other by accident; Android then treats "same code" as a reinstall of
 * the same version, which is the safe outcome (it never silently downgrades).
 */
export function versionCodeFrom(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version).trim());
  if (!m) throw new Error(`version "${version}" is not X.Y.Z — Android needs a numeric code, so keep semver`);
  const [, major, minor, patch] = m.map(Number);
  if (!Number.isFinite(minor) || minor >= MINOR_BASE || patch >= MINOR_BASE) {
    throw new Error(
      `version "${version}" overflows the versionCode scheme (minor/patch must stay below ${MINOR_BASE})`
    );
  }
  return {
    code: major * MAJOR_BASE + minor * MINOR_BASE + patch,
    prerelease: /[-+]/.test(String(version)),
    major,
    minor,
    patch,
  };
}

/**
 * Every file rewrite as {file, text, changed, what…}; pure, so a test can assert the
 * whole decision without touching the repo.
 *
 * One entry PER FILE, with the edits applied in sequence to the working text. That
 * is not a style choice: applying each edit to the original text and then writing
 * each result means the last write for a file wins and silently reverts the others —
 * which is exactly what this script's first version did, and `--check` on the very
 * next run caught the file still stale after being "written".
 */
export function planVersionWrites({ version, gradle, ios, sw }) {
  const { code } = versionCodeFrom(version);
  const plan = [];

  const applyFile = (entry, edits) => {
    if (!entry) return;
    let text = entry.text;
    const applied = [];
    const errors = [];
    for (const { re, to, what, expectAll } of edits) {
      if (!re.test(text)) {
        errors.push(`${what}: no match for ${re} — refusing to guess where it belongs`);
        continue;
      }
      const next = expectAll ? text.replace(re, to) : text.replace(re, to);
      if (next !== text) applied.push(`${what} → ${to.trim()}`);
      text = next;
    }
    plan.push({ file: entry.file, text, changed: text !== entry.text, applied, errors });
  };

  applyFile(gradle, [
    { re: /^\s*versionCode\s+\d+\s*$/m, to: `        versionCode ${code}`, what: 'Android versionCode' },
    { re: /^\s*versionName\s+"[^"]*"\s*$/m, to: `        versionName "${version}"`, what: 'Android versionName' },
  ]);
  applyFile(ios, [
    { re: /CURRENT_PROJECT_VERSION = [^;]+;/g, to: `CURRENT_PROJECT_VERSION = ${code};`, what: 'iOS build number', expectAll: true },
    { re: /MARKETING_VERSION = [^;]+;/g, to: `MARKETING_VERSION = ${version};`, what: 'iOS marketing version', expectAll: true },
  ]);
  applyFile(sw, [
    { re: /const CACHE = '[^']*'/, to: `const CACHE = 'cgpa-pilot-v${version}'`, what: 'service-worker cache name' },
  ]);

  return { code, plan };
}

function readOrNull(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

function main() {
  const check = flag('check');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  let built;
  try {
    built = planVersionWrites({
      version: pkg.version,
      gradle: readOrNull(ANDROID_GRADLE) === null ? null : { file: ANDROID_GRADLE, text: readOrNull(ANDROID_GRADLE) },
      ios: readOrNull(IOS_PROJECT) === null ? null : { file: IOS_PROJECT, text: readOrNull(IOS_PROJECT) },
      sw: readOrNull(SW) === null ? null : { file: SW, text: readOrNull(SW) },
    });
  } catch (e) {
    console.error(`[version-sync] ${e.message}`);
    process.exit(1);
    return;
  }
  const errors = built.plan.flatMap((p) => p.errors.map((e) => `${path.relative(ROOT, p.file)}: ${e}`));
  const stale = built.plan.filter((p) => p.changed).flatMap((p) => p.applied);
  const missing = [];
  for (const [name, file] of [
    ['android build.gradle', ANDROID_GRADLE],
    ['ios project.pbxproj', IOS_PROJECT],
  ]) {
    if (!existsSync(file)) missing.push(name);
  }
  for (const e of errors) {
    console.error(`[version-sync] ${e}`);
    // A file whose shape we cannot recognise is left completely alone: writing a
    // half-applied version is worse than an old one, because it can move
    // versionCode without moving versionName.
  }
  if (errors.length) {
    process.exit(1);
    return;
  }
  if (!check) {
    for (const item of built.plan) if (item.changed) writeFileSync(item.file, item.text);
  }
  const summary = {
    version: pkg.version,
    versionCode: built.code,
    stale: check ? stale : [],
    written: check ? 0 : built.plan.filter((p) => p.changed).length,
    errors,
    skipped: missing,
  };
  if (flag('json')) console.log(JSON.stringify(summary, null, 2));
  else if (check) {
    if (stale.length) {
      console.error(`[version-sync] ${pkg.version} is not what the native manifests say:`);
      for (const s of stale) console.error(`  - ${s}`);
      console.error('[version-sync] fix with: npm run mobile:version');
    } else console.log(`[version-sync] android, ios and sw.js agree on ${pkg.version} (versionCode ${built.code}).`);
  } else if (stale.length) {
    console.log(`[version-sync] wrote ${pkg.version} (versionCode ${built.code}) into: ${stale.map((s) => s.split(' →')[0]).join(', ')}`);
  } else console.log(`[version-sync] already in sync at ${pkg.version}.`);
  if (check && (stale.length || errors.length)) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
