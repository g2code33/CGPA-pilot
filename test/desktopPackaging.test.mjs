// ─────────────────────────────────────────────────────────────────────────
// Desktop packaging guards (v1.0.25).
//
// Each assertion here blocks a regression that made the Linux .deb unusable:
//
//   • a space in productName      → /opt/CGPA Pilot → Chromium cannot exec its
//                                   own zygote → "LaunchProcess: failed to
//                                   execvp: /opt/CGPA" + FATAL/SIGTRAP.
//   • dist/** in asarUnpack       → the renderer bytes leave app.asar, the
//                                   file:// loader follows only the marker →
//                                   ERR_FAILED → blank window.
//   • a single icon.png for Linux → lands in hicolor/1024x1024, which is not a
//                                   directory hicolor's index.theme declares →
//                                   no logo in the menu/dock.
//   • StartupWMClass ≠ exec name  → the DE cannot match the window to the
//                                   .desktop file → generic icon while running.
//   • macros in the deb scripts   → an undefined ${macro} aborts electron-builder.
//
// The config lives in package.json ("build"), read the same way electron-builder
// does — plus the two .deb hook scripts and the icon set they install.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));
const build = pkg.build;
const linux = build.linux;
const HICOLOR = [16, 24, 32, 48, 64, 96, 128, 256, 512];

/** The macros electron-builder's FpmTarget passes to the linux hook scripts. */
const DEB_SCRIPT_MACROS = new Set([
  'executable',
  'sanitizedProductName',
  'productFilename',
  ...Object.keys(linux),
]);

test('productName is space-free (Linux installs to /opt/<productName>)', () => {
  assert.ok(build.productName, 'build.productName must be set');
  assert.doesNotMatch(
    build.productName,
    /\s/,
    'A space in productName puts a space in the Linux install path, and ' +
      "Chromium's zygote cannot exec such a path (the app dies before the window opens)."
  );
});

test('the renderer is never asar-unpacked', () => {
  const unpack = build.asarUnpack ?? [];
  for (const pattern of unpack) {
    assert.doesNotMatch(
      String(pattern),
      /(^|[/*])dist(\/|$)/,
      `asarUnpack entry "${pattern}" removes dist/ from app.asar; loadFile() then fails with ERR_FAILED`
    );
  }
  assert.ok(build.files.includes('dist/**/*'), 'dist/**/* must ship inside the asar');
});

test('packaged files stay lean (no build/ or icon sources in the app)', () => {
  for (const pattern of build.files) {
    assert.doesNotMatch(String(pattern), /^build(\/|$)/, `${pattern}: build/ is a packaging-time folder`);
  }
});

test('the Linux icon set is one PNG per hicolor size', () => {
  assert.equal(typeof linux.icon, 'string', 'linux.icon must point at the icons directory');
  const dir = fileURLToPath(new URL(`../${linux.icon}`, import.meta.url));
  assert.ok(existsSync(dir), `${linux.icon} must exist — a lone icon.png only fills hicolor/1024x1024`);
  const names = readdirSync(dir);
  for (const size of HICOLOR) {
    assert.ok(names.includes(`${size}x${size}.png`), `${linux.icon}/${size}x${size}.png is missing`);
  }
  // Icons are square and carry transparency, or every launcher shows a white tile.
  for (const name of names.filter((n) => n.endsWith('.png'))) {
    const bytes = readFileSync(`${dir}/${name}`);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    const colorType = bytes[25];
    assert.equal(width, height, `${name} must be square`);
    assert.equal(colorType, 6, `${name} must be RGBA (colour type 6) so corners are transparent`);
    assert.ok(HICOLOR.includes(width), `${name}: only hicolor sizes are looked up, got ${width}`);
  }
});

test('desktop entry binds the window to the launcher icon', () => {
  assert.equal(linux.desktop.StartupWMClass, linux.executableName, 'must equal the executable name (WM_CLASS)');
  // The path must stay space-free, so the pretty name lives in the launcher
  // labels instead (menu entry on Linux, shortcut name on Windows).
  assert.match(linux.desktop.Name, /\s/, 'desktop.Name is what the menu shows');
  assert.match(build.nsis.shortcutName, /\s/, 'the Windows shortcut keeps the spaced brand name');
  // electron-builder writes Icon=<executableName>, which is why the icons above
  // are installed as <executableName>.png.
  assert.equal(linux.executableName, pkg.name, 'icon lookups follow the executable name');
});

test('the .deb hook scripts only use macros electron-builder defines', () => {
  for (const key of ['afterInstall', 'afterRemove']) {
    const rel = build.deb[key];
    assert.ok(rel, `deb.${key} must be set`);
    const src = readFileSync(`${root}/${rel}`, 'utf8');
    for (const [, macro] of src.matchAll(/\$\{([a-zA-Z]+)\}/g)) {
      assert.ok(DEB_SCRIPT_MACROS.has(macro), `${rel}: macro \${${macro}} is not defined → electron-builder aborts`);
    }
    assert.match(src, /exit 0/, `${rel} must end with a zero status or dpkg marks the install failed`);
  }
});

test('the launcher never re-execs the app on a crash', () => {
  const src = readFileSync(`${root}/${build.deb.afterInstall}`, 'utf8');
  // The old script ran the binary, and on ANY non-zero exit re-ran it with
  // --no-sandbox — so a crash looked like a successful start and the sandbox
  // state became unknowable from the log.
  assert.doesNotMatch(src, /if\s+"\$REAL"/, 'do not retry the launch on failure');
  assert.match(src, /exec "\$REAL" \$EXTRA "\$@"/, 'launcher must exec exactly once');
  assert.doesNotMatch(src, /--no-sandbox "\$@"/, 'the flag must be decided before exec, never tacked onto a retry');
});

test('the sandbox helper is setuid only when user namespaces are unavailable', () => {
  const src = readFileSync(`${root}/${build.deb.afterInstall}`, 'utf8');
  assert.match(src, /unshare --user true/, 'must probe for unprivileged user namespaces');
  assert.match(src, /chmod 0755/, 'must NOT leave the helper setuid when userns work');
  assert.match(src, /chmod 4755/, 'must setuid the helper where Electron needs it');
});

test('the 1.0.24 space-in-path install directory is cleaned up on upgrade', () => {
  const src = readFileSync(`${root}/${build.deb.afterInstall}`, 'utf8');
  assert.match(src, /\/opt\/CGPA Pilot/, 'stale /opt/CGPA Pilot must be removed by the post-install hook');
});

test('the window icon is read from bytes, not from an asar path', () => {
  const main = readFileSync(`${root}/electron/main.ts`, 'utf8');
  assert.match(main, /createFromBuffer/, 'nativeImage.createFromPath cannot read inside app.asar');
  assert.match(main, /app\.asar\.unpacked/, 'the loader must cope with an unpacked layout as a fallback');
});
