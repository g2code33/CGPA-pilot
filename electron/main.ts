import { app, BrowserWindow, ipcMain, nativeImage } from 'electron';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { autoUpdater } from 'electron-updater';
import { installDesktopEntry, installLauncherIcon, writeIfChanged, type BrandInstallOptions } from './brandInstall';
import {
  indexOfEntry,
  insideArchive,
  orderRendererCandidates,
  pickRendererEntry,
  rendererCandidatePaths,
} from './rendererPath';
import {
  chooseLaunchMode,
  clampMode,
  escalate,
  LAUNCH_MODES,
  launchFlags,
  markPainted,
  readLaunchState,
  relaunchArgs,
  STARTUP_GRACE_MS,
  writeLaunchState,
  type LaunchModeState,
} from './launchMode';

// ─────────────────────────────────────────────────────────────────────────
// WHY THIS FILE LOOKS SO DEFENSIVE (v1.0.25 Linux fixes)
//
// 1. A space in the executable path used to kill the app before a window ever
//    appeared: Chromium starts its zygote by re-executing the browser binary
//    through a whitespace-split command line, so "/opt/CGPA Pilot/cgpa-pilot"
//    became argv[0]="/opt/CGPA" —
//        LaunchProcess: failed to execvp: /opt/CGPA
//        FATAL:zygote_host_impl_linux.cc(207)] Check failed: . : Invalid argument (22)
//        Trace/breakpoint trap (core dumped)
//    The package now installs to the space-free /opt/CGPA-Pilot (see the
//    productName note in docs/DESKTOP-LINUX.md). An AppImage the user put in a
//    folder with a space still hits it, so there the sandbox is disabled for
//    that launch instead of crashing — an unsandboxed renderer beats an app
//    that never opens.
//
// 2. Blank window, twice, from one rule written down wrong: a `file://` load may
//    never be given a path that goes through app.asar. Chromium reads the REAL
//    filesystem there and cannot see inside the archive, while Node's patched fs
//    can — so `existsSync(…/app.asar/dist/index.html)` says yes and the load says
//        [cgpa-pilot] renderer load failed: ERR_FAILED (-2) while loading
//        file:///opt/CGPA-Pilot/resources/app.asar/dist/index.html
//    1.0.24 had dist unpacked but still loaded through the archive's marker;
//    1.0.25 "fixed" it by putting dist INSIDE the archive — same failure. The
//    actual fix is both halves together: `asarUnpack: ["dist/**/*"]` so real
//    files exist, and a candidate order that loads the real
//    `resources/app.asar.unpacked/dist/index.html` (electron/rendererPath.ts).
//
// 3. `autoInstallOnAppQuit` (electron-updater's default) installs a downloaded
//    update from the quit handler — on Linux that means apt/pkexec mid-exit, and
//    the log ends with "Update installer has already been triggered. Quitting
//    application.", which reads like a crash. Updates are now installed only when
//    the user asks for it, and a refused install is reported in the UI.
//
// 4. (v1.0.26) The .deb post-install hook used to leave chrome-sandbox at 0755
//    when `unshare --user` "worked" — probed AS ROOT, where it always does — so on
//    a machine with unprivileged user namespaces disabled the app aborted:
//        FATAL:setuid_sandbox_host.cc(163)] The SUID sandbox helper binary was
//        found, but is not configured correctly. … /opt/CGPA-Pilot/chrome-sandbox
//        is … not owned by root and has mode 4755.  Trace/breakpoint trap
//    The hook now always sets root:root 4755, and the check above is the safety
//    net for installs where that chmod could not happen (read-only /opt, a
//    hand-copied AppImage folder, an extract that dropped the setuid bit).
//
// 5. (v1.0.27) A renderer that cannot start at all — a kernel refusing the
//    sandbox it wants (`Zygote could not fork: process_type renderer`,
//    `write: Broken pipe`, then `Segmentation fault (core dumped)`) — used to
//    leave a dead or empty window with only a terminal traceback to explain it.
//    Now nothing paints without a plan B: the launch runs a short ladder of
//    progressively more conservative modes (electron/launchMode.ts), remembers
//    the one that worked in <userData>/launch-mode.json, and an unpainted launch
//    escalates instead of staying blank. `cgpa-pilot --launch-mode-default`
//    starts from the top again.
// ─────────────────────────────────────────────────────────────────────────

// Packaged renders load the Vite build from `file://` (loadFile). Chromium
// treats `file://` as an opaque origin and can block ES-module scripts and
// local assets with a CORS error, which leaves a blank window on installed
// builds. This switch allows bundled `file://` files to load normally while
// keeping the rest of Chromium's security intact.
app.commandLine.appendSwitch('allow-file-access-from-files');

/**
 * Why the renderer may have to run without the OS sandbox — and only for
 * installs that would otherwise NOT START AT ALL:
 *
 *  a) a whitespace in the executable path (see header note 1), or
 *  b) `chrome-sandbox` present but not usable (not root-owned / not setuid, or
 *     a read-only /opt that swallowed the post-install chmod) AND unprivileged
 *     user namespaces unavailable (Debian `unprivileged_userns_clone=0`,
 *     Ubuntu 24.04+ AppArmor restriction). Without either mechanism Chromium
 *     aborts: FATAL:setuid_sandbox_host.cc(163) "The SUID sandbox helper binary
 *     was found, but is not configured correctly."
 *
 * Case (b) is verified with the same probe electron-builder uses, run AS THE
 * USER (a root probe would always succeed and tell nothing), and cached for the
 * session. A correctly installed package never takes this path.
 */
function sandboxFallbackReason(): string | null {
  if (process.platform !== 'linux') return null;
  if (process.argv.some((a) => a === '--no-sandbox' || a === '--disable-gpu-sandbox')) return null;
  if (/\s/.test(process.execPath)) return `the install path contains a space (${process.execPath})`;

  const helper = path.join(path.dirname(process.execPath), 'chrome-sandbox');
  if (!existsSync(helper)) return null; // no helper at all → Chromium uses user namespaces
  try {
    const st = statSync(helper);
    if (st.uid === 0 && (st.mode & 0o4000) !== 0 && (st.mode & 0o0044) === 0o0044) return null;
  } catch {
    return null; // unreadable stat → leave Chromium's own behaviour alone
  }
  // The helper is unusable: only drop the sandbox if user namespaces cannot
  // replace it, so a working system keeps its sandbox.
  if (!unprivilegedUserNamespacesWork()) {
    return `the sandbox helper ${helper} is not root-owned mode 4755 and unprivileged user namespaces are unavailable`;
  }
  return null;
}

let usernsWorks: boolean | null = null;

/** `unshare --user true` as the current (unprivileged) user. util-linux only. */
function unprivilegedUserNamespacesWork(): boolean {
  if (usernsWorks != null) return usernsWorks;
  usernsWorks = false; // no probe available → assume the sandbox cannot be used
  try {
    if (!existsSync('/proc/self/ns/user')) return (usernsWorks = false);
    const res = spawnSync('unshare', ['--user', 'true'], { timeout: 5000, encoding: 'utf8' });
    if (res.error == null) usernsWorks = res.status === 0;
  } catch {
    /* keep the conservative default */
  }
  return usernsWorks;
}

const sandboxFallback = sandboxFallbackReason();
if (sandboxFallback) {
  app.commandLine.appendSwitch('no-sandbox');
  console.warn(
    `[cgpa-pilot] Running WITHOUT the Chromium OS sandbox for this launch: ${sandboxFallback}.\n` +
      '              To fix it (and get the sandbox back): sudo chmod 4755 and chown root:root on\n' +
      `              ${path.join(path.dirname(process.execPath), 'chrome-sandbox')}, or move the app\n` +
      '              to a path without spaces. The app would otherwise abort with\n' +
      '              "FATAL:setuid_sandbox_host.cc(163) … not configured correctly".'
  );
}

// ─────────────────────────────────────────────────────────────────────────
// LAUNCH MODES — a window that cannot paint must not need a bug report
//
// A Linux launch can fail for reasons invisible from outside and specific to the
// machine: a kernel that will not allow the sandbox Chromium wants (the zygote
// cannot fork, `write: Broken pipe`, a segfault where the window should be), or a
// GPU process taking the frame down with it. None of that can be detected before
// the launch — only that the launch did not paint. So the app walks a short ladder
// of progressively more conservative modes and REMEMBERS the one that worked in
// <userData>/launch-mode.json; the next start skips straight to it.
//
// The decision logic is pure and tested in electron/launchMode.ts; what follows is
// the Electron glue — push the switches, watch for a paint, relaunch on failure.
// `app:version` doubles as the liveness proof: the renderer calls it as soon as the
// UI mounts, so a mode is only judged dead when nothing came back at all. Support
// escape hatch: `cgpa-pilot --launch-mode-default` retries from the top.
// ─────────────────────────────────────────────────────────────────────────

const launchModeFile = () => path.join(app.getPath('userData'), 'launch-mode.json');
const launchModeState = (): LaunchModeState | null => readLaunchState(launchModeFile());

/** CLI reset > the relaunch hand-off in the environment > what worked last time. */
const launchMode = chooseLaunchMode({ argv: process.argv, env: process.env, state: launchModeState() });
/** Why we are in this mode — quoted on the diagnostic page and in the logs. */
const lastLaunchFailure = launchMode > 0 ? launchModeState()?.reason : undefined;

for (const flag of launchFlags(launchMode, process.argv)) app.commandLine.appendSwitch(flag);
if (launchMode > 0) {
  const entry = LAUNCH_MODES[launchMode];
  console.warn(
    `[cgpa-pilot] launch mode "${entry.name}" (${entry.note})` +
      (lastLaunchFailure ? `\n              previous launch failed: ${lastLaunchFailure}` : '') +
      `\n              flags: ${entry.flags.map((f) => '--' + f).join(' ') || 'none'}` +
      '\n              remembered in <userData>/launch-mode.json — to start over:' +
      ' `cgpa-pilot --launch-mode-default`'
  );
}

/**
 * Leave the mode that did not paint. A renderer failure usually takes the process
 * down with it, so recovery is a *relaunch* in the next mode — and since a hard
 * crash can happen before the state file is written, the new mode is also handed
 * to the child through the environment. False means "nothing left to try": the
 * caller shows the diagnostic page instead of exiting into silence, which is also
 * what closes the relaunch loop.
 */
/** How many relaunches this process has queued — never more than one. */
let escalationsQueued = 0;

function escalateLaunchMode(reason: string): boolean {
  // Several failures can arrive at once (did-fail-load, then the watchdog, then
  // render-process-gone). `app.relaunch()` queues a child per call, so the second
  // one would start the app twice; the process is already leaving either way.
  if (escalationsQueued > 0) return false;
  escalationsQueued += 1;
  const step = escalate(launchMode, reason, launchModeState());
  writeLaunchState(launchModeFile(), step.state);
  const failed = LAUNCH_MODES[clampMode(launchMode)].name;
  if (step.next === null) {
    console.error(
      '[cgpa-pilot] every launch mode failed (last: ' + reason + ').\n' +
        '              Retry from the top with: cgpa-pilot --launch-mode-default\n' +
        '              (or delete <userData>/launch-mode.json)'
    );
    return false;
  }
  const entry = LAUNCH_MODES[step.next];
  process.env.CGPA_LAUNCH_MODE = String(step.next); // loop guard for the child
  console.error(
    '[cgpa-pilot] launch mode "' + failed + '" did not paint (' + reason + ').\n' +
      '              Relaunching once in mode "' + entry.name + '" (' + entry.note + ').'
  );
  app.relaunch({ args: relaunchArgs(process.argv) });
  app.exit(0);
  return true;
}

const isDev = !!process.env.VITE_DEV_SERVER_URL;
let mainWindow: BrowserWindow | null = null;

let loaderError: string | null = null;

/**
 * Where the packaged renderer is, best candidate first.
 *
 * The rule that matters: a `file://` load must never be handed a path that goes
 * through `app.asar`. Node can read there (Electron patches `fs`) but Chromium's
 * loader cannot, and that mismatch is what produced two blank windows — see note
 * 2 in the header. The whole `dist` tree is therefore asarUnpacked, the real
 * `app.asar.unpacked/dist/index.html` is preferred, and the archive path stays
 * last. The ordering itself is pure (electron/rendererPath.ts) and tested.
 */
function rendererEntryCandidates(): string[] {
  return orderRendererCandidates(rendererCandidatePaths(app.getAppPath(), __dirname), (file) => {
    try {
      return statSync(file).size > 0;
    } catch {
      return false;
    }
  });
}

/** Which of the candidates this process is on — a retry advances it. */
let rendererEntryIndex = 0;

/** The live window's "this launch painted" hook, owned by the diagnostics wiring. */
let markRendererAlive: (() => void) | null = null;

/**
 * Resolve the renderer entry to load. `fromIndex` exists because
 * `rendererEntryCandidates()` is deterministic: a retry that started from 0 would
 * hand back the exact path that just failed.
 */
function resolveRendererEntry(fromIndex = 0): string | null {
  const ordered = rendererEntryCandidates();
  const found = pickRendererEntry(
    ordered,
    (file) => {
      try {
        return readFileSync(file).includes('<div id="root">');
      } catch {
        return false;
      }
    },
    fromIndex,
  );
  if (found) {
    rendererEntryIndex = Math.max(0, indexOfEntry(ordered, found));
    return found;
  }
  // Nothing carried the marker: load the first candidate anyway rather than
  // guarantee a white screen, but say why.
  if (ordered.length > fromIndex) {
    rendererEntryIndex = fromIndex;
    loaderError = 'dist/index.html at ' + ordered[fromIndex] + ' has no #root element';
    return ordered[fromIndex];
  }
  loaderError = 'no packaged renderer found — looked for dist/index.html in:\n' + ordered.join('\n');
  return null;
}

/** The next candidate worth loading after the current one, or null. */
function nextCandidateEntry(): { file: string; index: number } | null {
  const ordered = rendererEntryCandidates();
  for (let i = rendererEntryIndex + 1; i < ordered.length; i++) {
    if (existsSync(ordered[i])) return { file: ordered[i], index: i };
  }
  return null;
}

/**
 * The window icon. Read from bytes rather than a path: nativeImage's path
 * variant is not asar-aware, so `…/app.asar/…` silently yields an empty image —
 * which is what left the taskbar/dock showing a generic icon. Order matters:
 * the administrator's own logo (persisted under userData/brand) wins over the
 * `resources/icon.png` copy baked into the package, so a branding change shows
 * up on the very next launch instead of showing the shipped default.
 */
function windowIcon(): Electron.NativeImage | undefined {
  const files = [
    brandIconFile(),
    app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(app.getAppPath(), 'build', 'icons', '256x256.png'),
    path.join(app.getAppPath(), 'dist', 'icon-512.png'),
  ];
  for (const file of files) {
    try {
      if (!file || !existsSync(file)) continue;
      const image = nativeImage.createFromBuffer(readFileSync(file));
      if (!image.isEmpty()) return image;
    } catch {
      /* next candidate */
    }
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────
// ADMIN BRANDING → the real app icon (window, taskbar, applications menu)
//
// `appearance.logo` is what the administrator sets in Icons & branding. Until
// now it only reached the HTML UI: the installed icon (taskbar tile, GNOME
// dash/Activities search, Windows taskbar) came from the packaged files, so a
// rebrand kept showing the old logo forever. The renderer hands the logo here
// after every config sync; we persist it next to the user's data and:
//   • set the live window icon (all platforms),
//   • on Linux, install it into the per-user icon theme and mirror the
//     .desktop entry into ~/.local/share — user files take precedence over
//     /usr/share, so the menu/dock logo follows the admin without touching
//     root-owned files or needing a rebuild.
// The installer's own icon (Windows .exe resource, .deb payload) still comes
// from build/icons, refreshed from the published branding at build time —
// see scripts/refresh-brand-icons.mjs.
// ─────────────────────────────────────────────────────────────────────────

/** hicolor sizes the desktop environment looks up (index.theme declares them). */
const HICOLOR_SIZES = [16, 24, 32, 48, 64, 96, 128, 256, 512];

function brandDir(): string {
  return path.join(app.getPath('userData'), 'brand');
}

function brandIconFile(): string {
  return path.join(brandDir(), 'icon.png');
}

/** `data:image/…;base64,…` or an http(s) asset URL → image bytes. */
async function readBrandImageBytes(source: string): Promise<Buffer | null> {
  const value = (source ?? '').trim();
  if (!value) return null;
  try {
    if (value.startsWith('data:')) {
      const comma = value.indexOf(',');
      if (comma === -1 || !/^data:image\//i.test(value)) return null;
      const body = value.slice(comma + 1);
      const bytes = value.includes(';base64') ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8');
      return bytes.length ? bytes : null;
    }
    if (/^https?:\/\//i.test(value)) {
      const res = await fetch(value);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length ? buf : null;
    }
  } catch {
    /* offline / unreachable — keep whatever icon is already installed */
  }
  return null;
}

/**
 * The launcher icon and the menu entry, from the persisted brand logo. Both no-op
 * when nothing changed, and both are re-asserted on every start — see
 * electron/brandInstall.ts for why user files are the only ones worth writing.
 */
function brandInstallOptions(execName: string, productName?: string | null): BrandInstallOptions {
  return {
    home: app.getPath('home'),
    iconFile: brandIconFile(),
    execName,
    productName: productName ?? null,
    // An AppImage's launcher entry carries the product name instead of the
    // executable name; the override must reuse whichever file exists.
    desktopAlias: app.name ? path.basename(app.name).replace(/\s+/g, '-') : null,
  };
}

function installUserLauncherIcon(execName: string): void {
  installLauncherIcon(brandInstallOptions(execName));
}

function installUserDesktopEntry(execName: string, productName: string | undefined): void {
  installDesktopEntry(brandInstallOptions(execName, productName));
}

/** Remember the admin's product name for the window/menu titles. */
function brandNameFile(): string {
  return path.join(brandDir(), 'name.txt');
}

function savedBrandName(): string | undefined {
  try {
    const v = readFileSync(brandNameFile(), 'utf8').trim();
    return v || undefined;
  } catch {
    return undefined;
  }
}


function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

/** Shown instead of a blank window when no renderer entry point can be read. */
function loadLoaderError(win: BrowserWindow, reason: string) {
  if (win.isDestroyed()) return;
  const deb = `cgpa-pilot-${app.getVersion()}-amd64.deb`;
  const tried = rendererEntryCandidates()[Math.max(0, rendererEntryIndex)] ?? '';
  const archiveWarning = insideArchive(tried)
    ? ' The path tried is inside the asar archive, which Chromium cannot read —' +
      ' this build must ship dist unpacked (asarUnpack).'
    : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>CGPA Pilot — could not start</title></head>
<body style="margin:0;padding:40px;background:#0f172a;color:#e2e8f0;font:15px/1.65 system-ui,sans-serif">
  <div style="max-width:680px">
    <h1 style="font-size:22px;margin:0 0 6px">CGPA Pilot could not load its interface</h1>
    <p style="color:#94a3b8;margin:0 0 22px">${escapeHtml(reason)}</p>
    <p style="color:#94a3b8;margin:0 0 8px">Searched for <code>dist/index.html</code> in (real paths first):</p>
    <ul style="margin:0 0 22px;padding-left:20px;color:#cbd5e1">${rendererEntryCandidates()
      .map((f) => `<li><code>${escapeHtml(f)}</code></li>`)
      .join('')}</ul>
    <p style="background:#1e293b;border-left:4px solid #4f46e5;padding:14px 16px;border-radius:8px">
      The usual cause is a half-installed or hand-edited package. Reinstall the current build
      (that also removes pre-1.0.25 files left in <code>/opt/CGPA Pilot</code>):
    </p>
    <pre style="background:#020617;padding:14px 16px;border-radius:8px;overflow:auto;color:#a5b4fc">sudo apt install ./${escapeHtml(deb)}</pre>
    <p style="color:#64748b;font-size:13px;margin-top:18px">launch mode:
      <code>${escapeHtml(LAUNCH_MODES[clampMode(launchMode)].name)}</code>${escapeHtml(
        lastLaunchFailure ? ' — ' + lastLaunchFailure : ' — no previous failure recorded'
      )}${escapeHtml(archiveWarning)}</p>
  </div>
</body></html>`;
  void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(() => {
    /* nothing else to try — the window at least stays open */
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 380,
    minHeight: 560,
    title: 'CGPA Pilot',
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    icon: windowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  wireRendererDiagnostics(mainWindow);

  if (isDev) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL as string);
  } else {
    void loadRenderer(mainWindow);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** Load the packaged renderer, preferring real paths over archive paths. */
async function loadRenderer(win: BrowserWindow) {
  const entry = resolveRendererEntry();
  if (entry == null) {
    loadLoaderError(win, loaderError ?? 'No readable dist/index.html inside the application package.');
    return;
  }
  try {
    await win.loadFile(entry);
  } catch (e) {
    if (win.isDestroyed()) return;
    loadLoaderError(win, `Loading ${entry} failed: ${(e as Error).message}`);
  }
}

/**
 * Turns "a blank window" into a record AND into a recovery action. A main-frame
 * load failure or a dead renderer first steps through the other renderer
 * locations, then walks the launch ladder (see LAUNCH MODES above) — instead of
 * leaving the user alone with a dark rectangle.
 */
function wireRendererDiagnostics(win: BrowserWindow) {
  let painted = false;
  let retrying = false;

  const recordPaint = () => {
    if (painted) return;
    painted = true;
    // Whatever mode demonstrably painted becomes the remembered one. On a normal
    // launch the file already says that, so nothing is written.
    const next = markPainted(launchMode, launchModeState());
    if (next) writeLaunchState(launchModeFile(), next);
  };

  // Only a real document counts: the diagnostic page finishes loading too, and
  // treating that as success would hide the failure forever.
  const paintedUrl = () => !win.webContents.getURL().startsWith('data:');
  win.webContents.on('did-finish-load', () => {
    if (paintedUrl()) recordPaint();
  });
  win.webContents.on('dom-ready', () => {
    if (paintedUrl()) recordPaint();
  });
  // Handed to `noteRendererAlive()` so a call from the renderer can mark the
  // paint — the typed BrowserWindow event list has no room for a custom channel.
  markRendererAlive = recordPaint;
  win.on('closed', () => {
    if (markRendererAlive === recordPaint) markRendererAlive = null;
  });

  const recover = (detail: string) => {
    escalateLaunchMode(detail); // exits the process when a next mode exists
    loadLoaderError(win, `${detail}\n\nEvery renderer location was tried and every launch mode failed.`);
  };

  const fail = (detail: string) => {
    if (painted || retrying) return;
    const next = nextCandidateEntry();
    if (next) {
      retrying = true;
      rendererEntryIndex = next.index;
      console.error(`[cgpa-pilot] renderer did not start (${detail}); trying ${next.file}`);
      void win
        .loadFile(next.file)
        .catch(() => undefined)
        .finally(() => {
          retrying = false;
        });
      return;
    }
    console.error('[cgpa-pilot] renderer did not start:', detail);
    recover(detail);
  };

  win.webContents.on('did-fail-load', (_event, errorCode, errorText, validatedURL) => {
    if (painted || errorCode === -3 /* ERR_ABORTED — a superseded load */) return;
    if (String(validatedURL).startsWith('data:')) return; // the diagnostic page itself
    fail(`${errorText || 'ERR_FAILED'} (${errorCode}) while loading ${validatedURL}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    fail(`renderer exited (reason: ${details.reason}, code: ${details.exitCode ?? 'n/a'})`);
  });
  win.on('unresponsive', () => {
    // A hung window is reported, never relaunched: restarting something that may
    // answer a second later would be worse than the hang.
    console.warn('[cgpa-pilot] window reported unresponsive (no action taken)');
  });

  // Silence is a failure too: a renderer that dies quietly (a zygote that could
  // not fork, a GPU process taking the frame down) sends no event at all.
  setTimeout(() => {
    if (!painted) fail(`no painted renderer within ${STARTUP_GRACE_MS / 1000}s`);
  }, STARTUP_GRACE_MS);
}

/**
 * Mark the launch good from the renderer side (see LAUNCH MODES). Emitted on the
 * window so the handler that owns the "painted" bookkeeping records it: a mode
 * whose UI is demonstrably running is never escalated.
 */
function noteRendererAlive() {
  markRendererAlive?.();
}

// ─────────────────────────────────────────────────────────────────────────
// Auto-update (electron-updater reads latest.yml / latest-linux.yml published
// alongside the GitHub release)
// ─────────────────────────────────────────────────────────────────────────
function sendToRenderer(channel: string, payload: unknown) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

/** True once an update package is on disk and `quitAndInstall()` can run. */
let updateReady = false;

function wireUpdater() {
  autoUpdater.autoDownload = false;
  // Installing on quit runs apt/pkexec from a quit handler — the app then exits
  // with only "Update installer has already been triggered. Quitting
  // application." in the log, which reads like a crash. Install when asked.
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    sendToRenderer('updater:status', { status: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    sendToRenderer('updater:status', {
      status: 'available',
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });
  autoUpdater.on('update-not-available', () => {
    updateReady = false;
    sendToRenderer('updater:status', { status: 'unavailable' });
  });
  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer('updater:status', {
      status: 'downloading',
      percent: Math.round(progress.percent),
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = true;
    sendToRenderer('updater:status', {
      status: 'downloaded',
      version: info.version,
    });
  });
  autoUpdater.on('error', (err) => {
    sendToRenderer('updater:status', {
      status: 'error',
      message: err == null ? 'unknown error' : (err as Error).message,
    });
  });
}

function checkForUpdates() {
  // Updates are only meaningful for packaged builds.
  if (isDev || app.isPackaged === false) return;
  try {
    void autoUpdater.checkForUpdates();
  } catch {
    /* offline / no feed yet — ignore */
  }
}

app.whenReady().then(() => {
  // Re-assert the administrator's branding on the desktop entry before any
  // window exists. Both calls no-op when nothing changed, and they are what
  // makes the logo/name survive an app upgrade — the upgrade rewrites
  // /usr/share/applications and /usr/share/icons from the package, which would
  // otherwise reset the menu entry to whatever artwork was baked into the build
  // until the next config sync.
  if (process.platform === 'linux') {
    const execName = path.basename(process.execPath).replace(/\.exe$/i, '');
    installUserLauncherIcon(execName);
    installUserDesktopEntry(execName, savedBrandName());
  }
  wireUpdater();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Give the window a moment to load before the first update check.
  setTimeout(checkForUpdates, 8000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─────────────────────────────────────────────────────────────────────────
// IPC
// ─────────────────────────────────────────────────────────────────────────
/**
 * The renderer's first call, and the proof of life for the launch ladder: if the
 * UI got far enough to ask, this launch is good.
 */
ipcMain.handle('app:version', () => {
  noteRendererAlive();
  return app.getVersion();
});

/** Support/diagnostics surface — how the app is launching, and why. */
ipcMain.handle('app:launch-info', () => ({
  mode: launchMode,
  name: LAUNCH_MODES[clampMode(launchMode)].name,
  note: LAUNCH_MODES[clampMode(launchMode)].note,
  flags: launchFlags(launchMode, []).map((f) => `--${f}`),
  previousFailure: lastLaunchFailure ?? null,
  sandboxFallback: sandboxFallback ?? null,
  rendererEntry: rendererEntryCandidates()[rendererEntryIndex] ?? null,
  loaderError,
  stateFile: launchModeFile(),
}));

/**
 * branding:setIcon — the renderer hands us the admin's app logo (a data: URL or
 * an asset URL, from the published catalog) after every config sync. We persist
 * it, re-icon the live windows immediately, and (Linux) refresh the per-user
 * launcher icon, so the installed icon follows the branding instead of staying
 * frozen at whatever logo was baked into the build.
 */
ipcMain.handle('branding:set-icon', async (_event, logo: unknown, productName?: unknown) => {
  if (typeof logo !== 'string' || !logo) {
    return { ok: false, message: 'no logo supplied' };
  }
  try {
    const bytes = await readBrandImageBytes(logo);
    if (bytes == null || bytes.length === 0) return { ok: false, message: 'logo could not be read' };
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) return { ok: false, message: 'logo is not an image this platform can decode' };

    const execName = path.basename(process.execPath).replace(/\.exe$/i, '');
    mkdirSync(brandDir(), { recursive: true });
    // Re-encode to PNG for the files we hand to the desktop environment: an
    // admin may upload a JPEG/WebP, and hicolor/.desktop entries promise a PNG.
    const png = image.toPNG();
    const changed = writeIfChanged(brandIconFile(), png.length ? png : bytes);
    const name = typeof productName === 'string' ? productName.trim().slice(0, 120) : '';
    if (name) writeIfChanged(brandNameFile(), name);
    // A format the DE cannot use is worse than the packaged icon, so the live
    // windows are re-iconned from the decoded image either way.
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.setIcon(image);
    }
    if (changed || name) {
      installUserLauncherIcon(execName);
      installUserDesktopEntry(execName, name || undefined);
    }
    return { ok: true, changed };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
});

ipcMain.handle('updater:check', async () => {
  if (isDev || app.isPackaged === false) {
    return { status: 'unavailable', dev: true };
  }
  try {
    await autoUpdater.checkForUpdates();
    return { status: 'checking' };
  } catch (e) {
    return { status: 'error', message: (e as Error).message };
  }
});

ipcMain.handle('updater:download', async () => {
  try {
    await autoUpdater.downloadUpdate();
    updateReady = true;
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
});

ipcMain.handle('updater:install', async () => {
  if (isDev || app.isPackaged === false) {
    return { ok: false, message: 'Updates are only available in an installed build.' };
  }
  if (!updateReady) {
    // "Restart now" may be pressed straight after a launch where the update was
    // already downloaded (or before the download finished) — fetch it now.
    try {
      await autoUpdater.downloadUpdate();
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
    if (!updateReady) {
      return { ok: false, message: 'The update is still downloading — try again in a moment.' };
    }
  }
  try {
    // Silent + relaunch: the installer is handed the new package and the app
    // comes back by itself instead of staying closed after the update.
    autoUpdater.quitAndInstall(true, true);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
});
