// ─────────────────────────────────────────────────────────────────────────
// electron/brandInstall.ts — the administrator's logo reaching the DESKTOP
// (menu entry, dash, Activities search), not just the HTML UI.
//
// This used to be taken on trust: it is a set of symlinks in the user's hicolor
// theme plus a re-labelled copy of the packaged .desktop file, and every part of it
// fails in ways only visible on someone else's machine (a plain file left behind by
// an older build, a mount that refuses symlinks, a size hicolor never declares).
// So it runs here, in a temp home, and the assertions are about what the desktop
// environment will actually find.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  desktopBasenames,
  desktopEntryPath,
  desktopEntryText,
  HICOLOR_SIZES,
  installBranding,
  installDesktopEntry,
  installLauncherIcon,
  launcherIconPaths,
  systemDesktopPaths,
  userDesktopPath,
} from '../electron/brandInstall.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const build = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')).build;
const EXEC_NAME = build.linux.executableName;

/** A real 1×1 PNG, so anything sniffing the bytes sees a valid icon. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const SYSTEM_ENTRY = [
  '[Desktop Entry]',
  'Type=Application',
  'Name=CGPA Pilot',
  'Name[de]=CGPA Pilot DE',
  'Comment=Grade planner',
  `Exec="/opt/CGPA-Pilot/${EXEC_NAME}" %U`,
  'Terminal=false',
  'Icon=cgpa-pilot',
  'StartupWMClass=cgpa-pilot',
  'Categories=Education;',
  '',
].join('\n');

/** A fake $HOME + a fake /usr/share/applications, with the brand logo persisted. */
function makeWorld(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cgpa-brand-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home');
  const systemApps = path.join(dir, 'usr-share-applications');
  const brand = path.join(dir, 'userData', 'brand');
  mkdirSync(path.join(home, '.local', 'share', 'applications'), { recursive: true });
  mkdirSync(systemApps, { recursive: true });
  mkdirSync(brand, { recursive: true });
  writeFileSync(path.join(systemApps, `${EXEC_NAME}.desktop`), SYSTEM_ENTRY);
  const iconFile = path.join(brand, 'icon.png');
  writeFileSync(iconFile, PNG_1PX);
  const calls = [];
  return {
    dir,
    home,
    systemApps,
    iconFile,
    calls,
    options: {
      home,
      iconFile,
      execName: EXEC_NAME,
      productName: null,
      systemApplicationsDir: systemApps,
      desktopAlias: 'CGPA-Pilot',
      platform: 'linux',
      run: (cmd, args) => calls.push([cmd].concat(args)),
    },
  };
}

test('the admin logo is what the desktop environment finds, at every size', (t) => {
  const world = makeWorld(t);
  const outcome = installLauncherIcon(world.options);
  assert.equal(outcome.skipped, undefined, JSON.stringify(outcome));
  const links = launcherIconPaths(world.options);
  assert.equal(links.length, HICOLOR_SIZES.length);
  assert.deepEqual(HICOLOR_SIZES, [16, 24, 32, 48, 64, 96, 128, 256, 512], 'only sizes hicolor declares');
  for (const link of links) {
    assert.ok(existsSync(link), `no icon at ${link} → the menu shows a generic tile`);
    assert.equal(lstatSync(link).isSymbolicLink(), true, 'a symlink keeps one copy of the logo');
    assert.equal(readlinkSync(link), world.iconFile);
    assert.deepEqual(readFileSync(link), PNG_1PX, 'the bytes the DE reads are the admin logo');
  }
  // The layout is part of the contract, not an implementation detail.
  assert.ok(links[0].endsWith(path.join('hicolor', '16x16', 'apps', `${EXEC_NAME}.png`)));
});

test('the launcher cache is refreshed only when something changed', (t) => {
  const world = makeWorld(t);
  installLauncherIcon(world.options);
  assert.equal(world.calls.length, 2, 'icon cache + desktop database, once');
  assert.match(world.calls[0][0], /gtk-update-icon-cache/);
  assert.ok(world.calls[1].join(' ').includes('applications'));
  world.calls.length = 0;
  const second = installLauncherIcon(world.options);
  assert.deepEqual(second.changed, [], 'nothing to do on the next launch');
  assert.equal(world.calls.length, 0, 'no pointless rehash on every start');
});

test('an older build that copied the file is upgraded to a symlink', (t) => {
  const world = makeWorld(t);
  const first = launcherIconPaths({ ...world.options, hicolorSizes: [16] })[0];
  mkdirSync(path.dirname(first), { recursive: true });
  writeFileSync(first, 'stale copy of the previous logo');
  installLauncherIcon(world.options);
  assert.equal(lstatSync(first).isSymbolicLink(), true, 'the stale copy must not survive');
  assert.deepEqual(readFileSync(first), PNG_1PX);
});

test('an unwritable icon directory cannot break the launch', (t) => {
  const world = makeWorld(t);
  const apps = path.join(world.home, '.local', 'share', 'icons', 'hicolor', '24x24', 'apps');
  mkdirSync(apps, { recursive: true });
  mkdirSync(path.join(apps, `${EXEC_NAME}.png`)); // a directory where a symlink belongs
  chmodSync(apps, 0o555); // no writes into this size's directory at all
  let outcome;
  try {
    outcome = installLauncherIcon(world.options); // must not throw
  } finally {
    // Restore before the temp dir is cleaned up, or the removal itself fails.
    chmodSync(apps, 0o755);
  }
  assert.equal(outcome.skipped, undefined, JSON.stringify(outcome));
  // One unusable size must not abort the loop for the rest — the menu still gets
  // the new logo instead of keeping the old one everywhere.
  const installed = launcherIconPaths(world.options).filter((f) => existsSync(f) && lstatSync(f).isSymbolicLink());
  assert.equal(installed.length, HICOLOR_SIZES.length - 1, `${installed.length} of ${HICOLOR_SIZES.length} installed`);
  assert.ok(!installed.some((f) => f.includes('24x24')), 'the blocked size is skipped, not half-written');
});

test('no brand logo yet → nothing is written (the packaged icon stays)', (t) => {
  const world = makeWorld(t);
  rmSync(world.iconFile);
  assert.equal(installLauncherIcon(world.options).skipped, 'no-brand-icon');
  assert.equal(existsSync(path.join(world.home, '.local', 'share', 'icons')), false);
});

test('the menu entry is re-labelled, and its Exec is never invented', (t) => {
  const world = makeWorld(t);
  world.options.productName = 'KNUST Grade Portal';
  const outcome = installDesktopEntry(world.options);
  assert.equal(outcome.skipped, undefined);
  const file = desktopEntryPath(world.options);
  const text = readFileSync(file, 'utf8');
  assert.match(text, /^Name=KNUST Grade Portal$/m, 'the administrator chose the name');
  assert.match(text, /^Icon=cgpa-pilot$/m, 'an icon NAME, so the hicolor lookup finds the logo');
  assert.match(text, /^StartupWMClass=cgpa-pilot$/m, 'must match the window class or the icon detaches');
  assert.match(text, new RegExp('^Exec="/opt/CGPA-Pilot/' + EXEC_NAME + '" %U$', 'm'), 'the packaged Exec stays verbatim');
  assert.match(text, /^Name\[de\]=CGPA Pilot DE$/m, 'localised names are left alone');

  // Idempotent: a second call must not rewrite the file.
  const stamp = new Date(1_700_000_000_000);
  utimesSync(file, stamp, stamp);
  const again = installDesktopEntry(world.options);
  assert.deepEqual(again.changed, [], 'writeIfChanged means no disk churn per launch');
  assert.equal(lstatSync(file).mtimeMs, stamp.getTime(), 'unchanged content, unchanged mtime');
});

test('no system entry → no user entry (a launcher that outlives the install is worse)', (t) => {
  const world = makeWorld(t);
  rmSync(path.join(world.systemApps, `${EXEC_NAME}.desktop`));
  const outcome = installDesktopEntry(world.options);
  assert.equal(outcome.skipped, 'no-system-entry');
  assert.equal(existsSync(desktopEntryPath(world.options)), false);
});

test('non-Linux platforms never run the POSIX launcher logic', (t) => {
  for (const platform of ['win32', 'darwin']) {
    const world = makeWorld(t);
    world.options.platform = platform;
    assert.equal(installLauncherIcon(world.options).skipped, 'not-linux');
    assert.equal(installDesktopEntry(world.options).skipped, 'not-linux');
    assert.equal(existsSync(path.join(world.home, '.local', 'share', 'icons', 'hicolor')), false);
  }
});

test('desktopEntryText keeps unknown keys and survives a blank name', () => {
  const text = desktopEntryText(SYSTEM_ENTRY, EXEC_NAME, '   ');
  assert.match(text, /^Name=CGPA Pilot$/m, 'a blank brand name must not blank out the label');
  assert.match(text, /^Comment=Grade planner$/m);
  assert.match(text, /^Categories=Education;$/m);
  // An entry with no Name= at all would be labelled by its filename, so the brand
  // name is inserted rather than silently dropped.
  assert.equal(desktopEntryText('[Desktop Entry]\nExec=x\n', EXEC_NAME, 'X'), '[Desktop Entry]\nName=X\nExec=x\n');
  assert.equal(desktopEntryText('[Desktop Entry]\n', EXEC_NAME, ''), '[Desktop Entry]\n', 'nothing to insert');
});

test('installBranding does both halves, which is what each launch calls', (t) => {
  const world = makeWorld(t);
  world.options.productName = 'Other Name';
  const result = installBranding(world.options);
  assert.equal(result.icon.skipped, undefined);
  assert.equal(result.entry.skipped, undefined);
  assert.ok(result.icon.changed.length > 0);
  assert.match(readFileSync(desktopEntryPath(world.options), 'utf8'), /^Name=Other Name$/m);
  // realpath of the symlink == the persisted brand file: proves the DE and the
  // app are reading the same bytes, which is the whole point of the symlinks.
  assert.equal(realpathSync(launcherIconPaths(world.options)[0]), realpathSync(world.iconFile));
});

test('an AppImage-style product-named entry is overridden in place, not duplicated', (t) => {
  const world = makeWorld(t);
  // No /usr/share/applications/cgpa-pilot.desktop, but a CGPA-Pilot.desktop.
  const productEntry = path.join(world.systemApps, 'CGPA-Pilot.desktop');
  rmSync(path.join(world.systemApps, `${EXEC_NAME}.desktop`));
  writeFileSync(productEntry, SYSTEM_ENTRY.replace('Name=CGPA Pilot', 'Name=CGPA Pilot'));
  world.options.productName = 'KNUST Grade Portal';
  const outcome = installDesktopEntry(world.options);
  assert.equal(outcome.skipped, undefined, 'the product-named entry is found');
  const target = userDesktopPath(world.options, productEntry);
  assert.equal(path.basename(target), 'CGPA-Pilot.desktop', 'same basename → shadows, never duplicates');
  assert.match(readFileSync(target, 'utf8'), /^Name=KNUST Grade Portal$/m);
  assert.equal(existsSync(desktopEntryPath(world.options)), false, 'no stray second launcher');
});

test('the installed layout matches what the packaging config produces', () => {
  // The symlinks and the .desktop override are keyed on the executable name, and
  // StartupWMClass must equal it — so a config change that renames one without the
  // other silently loses the logo. Assert the trio stays in step.
  assert.equal(EXEC_NAME, 'cgpa-pilot');
  assert.equal(build.linux.desktop.StartupWMClass, EXEC_NAME, 'window class must equal the executable name');
  // electron-builder's default is `Icon=<executableName>`, which is what our
  // hicolor symlinks are called; an override that disagreed would silently lose
  // the logo, so either leave it unset or set it to exactly that.
  assert.equal(build.linux.desktop.Icon ?? EXEC_NAME, EXEC_NAME, 'the entry must reference the themed icon name');
  // …and a .deb installs the entry as <executableName>.desktop while an AppImage
  // uses the product name, so both names have to be looked for.
  assert.equal(systemDesktopPaths({ execName: EXEC_NAME, desktopAlias: 'CGPA-Pilot' })[0], '/usr/share/applications/cgpa-pilot.desktop');
  assert.deepEqual(desktopBasenames({ execName: EXEC_NAME, desktopAlias: 'CGPA-Pilot' }), [EXEC_NAME, 'CGPA-Pilot']);
  assert.equal(build.linux.icon, 'build/icons', 'a directory, not one PNG (1024x1024 is not a hicolor size)');
  for (const size of HICOLOR_SIZES) {
    assert.ok(existsSync(path.join(root, 'build/icons', `${size}x${size}.png`)), `${size}x${size}.png must ship`);
  }
  assert.ok(existsSync(path.join(root, 'build/icon.png')), 'extraResources icon.png source');
  const main = readFileSync(`${root}/electron/main.ts`, 'utf8');
  assert.match(main, /installBranding|installLauncherIcon\(/, 'main process must actually call the installer');
  assert.match(main, /app\.whenReady\(\)[\s\S]{0,900}installUserLauncherIcon\(execName\)/, 'and re-assert it before the first window');
});
