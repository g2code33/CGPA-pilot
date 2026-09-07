import { app, BrowserWindow, ipcMain, nativeImage } from 'electron';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { autoUpdater } from 'electron-updater';

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
// 2. `dist/**` was listed in asarUnpack. Unpacked files are *removed* from
//    app.asar and only an "unpacked" marker stays in the header: Node's fs shim
//    follows that marker, Chromium's file:// loader does not, so
//    loadFile('…/resources/app.asar/dist/index.html') rejected with ERR_FAILED
//    and the window was blank. asarUnpack is gone (nothing here needs it) and
//    the entry point is now resolved from the paths that actually exist, with a
//    readable diagnostic page as the last resort instead of an empty rectangle.
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

const isDev = !!process.env.VITE_DEV_SERVER_URL;
let mainWindow: BrowserWindow | null = null;

/** Where the built renderer can be, most-likely location first. */
function rendererEntryCandidates(): string[] {
  const rel = path.join('dist', 'index.html');
  const appAsar = app.getAppPath(); // …/resources/app.asar (or the loose app dir in dev)
  const list = [
    // Normal packaged layout: everything lives inside app.asar.
    path.join(__dirname, '..', rel),
    path.join(appAsar, rel),
    // Belt and braces: if a build ever ships with dist/** unpacked again
    // (asarUnpack), the bytes live in the sibling directory, not the archive.
    path.join(path.dirname(appAsar), 'app.asar.unpacked', rel),
  ];
  return [...new Set(list)];
}

/** The first candidate that can actually be read, or null. */
function resolveRendererEntry(): string | null {
  if (isDev) return null;
  for (const file of rendererEntryCandidates()) {
    try {
      if (existsSync(file) && readFileSync(file).length > 0) return file;
    } catch {
      /* try the next candidate */
    }
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

/** Write only when the content differs, so every launch is not a disk churn. */
function writeIfChanged(file: string, bytes: Buffer | string, mode = 0o644): boolean {
  try {
    const next = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes;
    if (existsSync(file)) {
      const current = readFileSync(file);
      if (current.length === next.length && current.equals(next)) return false;
    }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, next, { mode });
    return true;
  } catch {
    return false;
  }
}

function installUserLauncherIcon(execName: string): void {
  if (process.platform !== 'linux') return;
  const icon = brandIconFile();
  if (!existsSync(icon)) return;
  const home = app.getPath('home');
  for (const size of HICOLOR_SIZES) {
    const dir = path.join(home, '.local', 'share', 'icons', 'hicolor', `${size}x${size}`, 'apps');
    const link = path.join(dir, `${execName}.png`);
    let target: string | null = null;
    try {
      target = readlinkSync(link); // throws when it is a plain file (older build) → rewrite below
    } catch {
      target = null;
    }
    if (target === icon) continue; // already ours, nothing to do
    try {
      mkdirSync(dir, { recursive: true });
      try {
        unlinkSync(link);
      } catch {
        /* nothing there yet */
      }
      try {
        symlinkSync(icon, link);
      } catch {
        // No symlink permission (some mounts) → write the bytes instead.
        writeFileSync(link, readFileSync(icon));
      }
    } catch {
      /* best effort — the window icon is already applied */
    }
  }
  // Rehash the caches so the menu shows the new logo without a logout. Both are
  // optional and exist only on desktop systems; failures are irrelevant.
  spawnSync('gtk-update-icon-cache', ['-q', '-t', '-f', path.join(home, '.local', 'share', 'icons', 'hicolor')]);
  spawnSync('update-desktop-database', [path.join(home, '.local', 'share', 'applications')]);
}

/**
 * Mirror the packaged .desktop entry into ~/.local/share/applications with the
 * admin's product name, so Activities/GNOME (and any hand-written launcher)
 * label the app the way the administrator named it while keeping the working
 * Exec/Icon of the installed entry. Skipped when no system entry exists — an
 * invented Exec would outlive uninstalls and break the launcher.
 */
function installUserDesktopEntry(execName: string, productName: string | undefined): void {
  if (process.platform !== 'linux') return;
  const system = path.join('/usr/share/applications', `${execName}.desktop`);
  if (!existsSync(system)) return;
  let text: string;
  try {
    text = readFileSync(system, 'utf8');
  } catch {
    return;
  }
  const name = (productName ?? '').trim();
  const lines = text.split(/\r?\n/).map((line) => {
    if (name && /^Name=/.test(line)) return `Name=${name}`;
    if (/^Icon=/.test(line)) return `Icon=${execName}`;
    if (/^StartupWMClass=/.test(line)) return `StartupWMClass=${execName}`;
    return line;
  });
  const userDir = path.join(app.getPath('home'), '.local', 'share', 'applications');
  writeIfChanged(path.join(userDir, `${execName}.desktop`), lines.join('\n'));
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
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>CGPA Pilot — could not start</title></head>
<body style="margin:0;padding:40px;background:#0f172a;color:#e2e8f0;font:15px/1.65 system-ui,sans-serif">
  <div style="max-width:680px">
    <h1 style="font-size:22px;margin:0 0 6px">CGPA Pilot could not load its interface</h1>
    <p style="color:#94a3b8;margin:0 0 22px">${escapeHtml(reason)}</p>
    <p style="color:#94a3b8;margin:0 0 8px">Searched for <code>dist/index.html</code> in:</p>
    <ul style="margin:0 0 22px;padding-left:20px;color:#cbd5e1">${rendererEntryCandidates()
      .map((f) => `<li><code>${escapeHtml(f)}</code></li>`)
      .join('')}</ul>
    <p style="background:#1e293b;border-left:4px solid #4f46e5;padding:14px 16px;border-radius:8px">
      The usual cause is a half-installed or hand-edited package. Reinstall the current build
      (that also removes pre-1.0.25 files left in <code>/opt/CGPA Pilot</code>):
    </p>
    <pre style="background:#020617;padding:14px 16px;border-radius:8px;overflow:auto;color:#a5b4fc">sudo apt install ./${escapeHtml(deb)}</pre>
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

/** Load the packaged renderer, falling back between asar/unpacked layouts. */
async function loadRenderer(win: BrowserWindow) {
  const entry = resolveRendererEntry();
  if (entry == null) {
    loadLoaderError(win, 'No readable dist/index.html inside the application package.');
    return;
  }
  try {
    await win.loadFile(entry);
  } catch (e) {
    if (win.isDestroyed()) return;
    loadLoaderError(win, `Loading ${entry} failed: ${(e as Error).message}`);
  }
}

/** Turns "a blank window" into a console record, so field reports are actionable. */
function wireRendererDiagnostics(win: BrowserWindow) {
  let loaded = false;
  let retried = false;
  win.webContents.on('did-finish-load', () => {
    loaded = true;
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorText, validatedURL) => {
    if (loaded || errorCode === -3 /* ERR_ABORTED — a superseded load */) return;
    const detail = `${errorText || 'ERR_FAILED'} (${errorCode}) while loading ${validatedURL}`;
    console.error('[cgpa-pilot] renderer load failed:', detail);
    // A file:// failure can mean "the archive has the entry but the bytes were
    // unpacked next to it" — retry once against the candidate that really
    // reads, and only then give up with the diagnostic page.
    const entry = resolveRendererEntry();
    if (!retried && entry != null && pathToFileURL(entry).href !== validatedURL) {
      retried = true;
      void win.loadFile(entry).catch(() => loadLoaderError(win, detail));
      return;
    }
    if (!validatedURL.startsWith('data:')) loadLoaderError(win, detail);
  });
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
ipcMain.handle('app:version', () => app.getVersion());

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
