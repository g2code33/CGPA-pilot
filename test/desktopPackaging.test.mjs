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
  // Sandbox mode is decided BEFORE exec, in exactly one place per outcome.
  const launches = src.match(/exec "\$REAL[^\n]*/g) ?? [];
  assert.equal(launches.length, 2, `launcher must exec once per branch, got ${JSON.stringify(launches)}`);
  assert.ok(
    launches.some((l) => /--no-sandbox/.test(l)) && launches.some((l) => !/--no-sandbox/.test(l)),
    'one branch unsandboxed (fallback), one branch sandboxed (normal)'
  );
  assert.ok(
    !/exec "\$REAL" "\$@"[\s\S]*exec "\$REAL" "\$@"/.test(src),
    'no repeated exec of the same command — that is the retry loop that hid failures'
  );
});

test('the sandbox helper is ALWAYS root-owned mode 4755', () => {
  const src = readFileSync(`${root}/${build.deb.afterInstall}`, 'utf8');
  const helper = src.slice(src.indexOf('SANDBOX_HELPER='), src.indexOf('# ── 3.'));
  assert.match(helper, /chown root:root/, 'dpkg does not guarantee the owner');
  assert.match(helper, /chmod 4755/, 'dpkg does not guarantee the setuid bit');
  // v1.0.25 probed `unshare --user` as ROOT and, when it succeeded (it always
  // does for root), left the helper at 0755 — which aborts on every machine
  // where *unprivileged* userns is disabled:
  //   FATAL:setuid_sandbox_host.cc(163)] The SUID sandbox helper binary was
  //   found, but is not configured correctly … Trace/breakpoint trap
  assert.doesNotMatch(helper, /chmod 0755/, 'a 0755 helper is exactly the crash above');
  // A comment may mention the probe (to explain why it is wrong); the SCRIPT
  // must not run one: root always passes it, the user may not.
  assert.doesNotMatch(helper, /USERNS_OK/, 'no userns-conditional chmod — that is the 1.0.25 regression');
  assert.doesNotMatch(helper, /^\s*(if|while)\b.*unshare/m, 'the helper mode must not depend on a root-side probe');
  // And when it still cannot be fixed (read-only /opt), say so instead of
  // letting the user meet a bare "Trace/breakpoint trap".
  assert.match(helper, /4755 root/, 'must verify the result');
  assert.match(helper, /WARNING/, 'a misconfiguration must be reported by dpkg output');
});

test('the launcher keeps the sandbox whenever the system offers one', () => {
  const src = readFileSync(`${root}/${build.deb.afterInstall}`, 'utf8');
  const launcher = src.slice(src.indexOf("<<'LAUNCH'"), src.indexOf('\nLAUNCH\n'));
  // The user-side probe is legitimate here (the launcher runs as that user).
  assert.match(launcher, /unshare --user true/, 'must check user namespaces as the real user');
  assert.match(launcher, /4755 root/, 'must accept a correctly configured helper');
  assert.match(launcher, /timeout 5 unshare/, 'a hung probe must not stall every launch');
  assert.equal(
    (launcher.match(/exec "\$REAL"[^\n]*/g) ?? []).filter((l) => l.includes('--no-sandbox')).length,
    1,
    'exactly one unsandboxed exec'
  );
});

test('the main process repairs an unusable sandbox instead of aborting', () => {
  const main = readFileSync(`${root}/electron/main.ts`, 'utf8');
  assert.match(main, /setuid_sandbox_host/, 'the crash it prevents must be named in the source');
  assert.match(main, /chrome-sandbox/, 'it must inspect the helper next to the executable');
  assert.match(main, /spawnSync\('unshare', \['--user', 'true'\]/, 'probe user namespaces as the app user');
  assert.match(main, /appendSwitch\('no-sandbox'\)/, 'fall back only when neither mechanism works');
  // …and only where it is needed: a working install must keep its sandbox.
  assert.match(main, /st\.uid === 0 && \(st\.mode & 0o4000\)/, 'a root-owned setuid helper is fine');
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

// ── the icon the OPERATING SYSTEM shows (installer artwork) ───────────────
// Every path below is a place an installed app draws its own picture, so all of
// them must follow the administrator's logo — and none of them may be able to
// break a build.

test('the shipped installer artwork is regenerated from the published branding', () => {
  const script = `${root}/scripts/refresh-brand-icons.mjs`;
  assert.ok(existsSync(script), 'build-time brand icon refresh is missing');
  const web = pkg.scripts['build:web'];
  assert.match(web, /refresh-seed\.mjs && node scripts\/refresh-brand-icons\.mjs/, 'the seed must be refreshed first (the script reads its appearance block)');
  const src = readFileSync(script, 'utf8');
  // Branding is cosmetic: no rasterizer, no network or no admin logo must all
  // leave the committed artwork in place with a warning, never a failed build.
  assert.doesNotMatch(src, /process\.exit\(/, 'the script must never fail a build');
  assert.match(src, /catch \(e\) \{\n  \/\/ Branding must never break a build/, 'top-level failures warn');
  assert.match(src, /CGPA_BRAND_ICONS/, 'opt-out switch for reproducible/offline builds');
  // ImageMagick downgrades small PNGs to a palette unless forced; the Linux .ico
  // set and the masked Android layers then look banded (or get rejected).
  assert.match(src, /png:color-type=6/, 'RGBA must be forced');
  assert.match(src, /png:color-type=\$\{colorType\}/, 'opaque masters must be forced to RGB');
});

test('every icon path electron-builder and Capacitor read is covered by the refresh', () => {
  const src = readFileSync(`${root}/scripts/refresh-brand-icons.mjs`, 'utf8');
  const covered = [
    build.win.icon, // build/icons/256x256.png — the .exe/.ico source
    linux.icon, // build/icons — the hicolor set
    'public/icon-512.png', // PWA + app shell icon
    'ic_launcher_foreground.png', // Android adaptive layer
    'ic_launcher_round.png', // Android legacy round (displayed unmasked)
    'AppIcon.appiconset', // iOS single universal icon
    'mipmap-', // all five density buckets
    'Contents.json', // iOS: sizes come from the Xcode manifest
  ];
  for (const needle of covered) {
    assert.ok(src.includes(needle), `${needle} is an installed icon but the refresh never touches it`);
  }
  const extra = build.extraResources.find((r) => r.to === 'icon.png');
  assert.ok(extra && src.includes(`'icon.png'`), 'the extraResources copy must be refreshed too');
});

test('the web manifest and the PWA icon entry point stay wired to the admin logo', () => {
  const manifest = JSON.parse(readFileSync(`${root}/public/manifest.webmanifest`, 'utf8'));
  assert.ok(manifest.icons.length >= 2, 'a single icon entry is not enough for maskable + any');
  // /app-icon (Worker + Pages function) is what serves the admin logo, so it
  // must be listed FIRST — Chrome keeps the first icon that ties on size, and
  // icon-512.png is only the offline/hostless fallback.
  assert.equal(manifest.icons[0].src, '/app-icon', 'the manifest must prefer the dynamic admin icon');
  assert.ok(manifest.icons.some((i) => i.src === '/app-icon' && i.purpose === 'maskable'), 'maskable too');
  assert.ok(manifest.icons.some((i) => i.src === 'icon-512.png'), 'with a static fallback');
  assert.ok(manifest.icons.every((i) => /^\//.test(i.src) === false || i.src === '/app-icon'), 'relative paths only, apart from the proxied icon');

  for (const page of ['index.html', 'admin.html']) {
    const html = readFileSync(`${root}/${page}`, 'utf8');
    assert.match(html, /rel="apple-touch-icon"/, `${page} needs an apple-touch-icon for the home-screen/Start-menu tile`);
    assert.match(html, /rel="icon"/, `${page} must keep a favicon link the branding can swap`);
  }

  // Pages serves the static manifest, so /app-icon must not be immutable there:
  // its URL is stable, and an immutable response freezes the installed icon on
  // whatever logo existed at first install.
  const fn = readFileSync(`${root}/functions/app-icon.js`, 'utf8');
  assert.match(fn, /max-age=\$\{ICON_TTL_SECONDS\}/, 'the Pages proxy must use a short TTL');
  assert.doesNotMatch(fn, /cache-control[^\n]*immutable/i, 'an immutable copy pins the first logo forever');
  assert.match(fn, /max-age=\$\{ICON_TTL_SECONDS\}[\s\S]*Response\.redirect/, 'the fallback stays behind the short-TTL path');
});
