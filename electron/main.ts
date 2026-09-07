import { app, BrowserWindow, ipcMain, nativeImage } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
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
// ─────────────────────────────────────────────────────────────────────────

// Packaged renders load the Vite build from `file://` (loadFile). Chromium
// treats `file://` as an opaque origin and can block ES-module scripts and
// local assets with a CORS error, which leaves a blank window on installed
// builds. This switch allows bundled `file://` files to load normally while
// keeping the rest of Chromium's security intact.
app.commandLine.appendSwitch('allow-file-access-from-files');

/**
 * True when the SUID/namespace sandbox cannot be used for this launch.
 * Only ever true for a path containing whitespace (see the header note); a
 * normal install (/opt/CGPA-Pilot, or an AppImage in a plain folder) keeps the
 * sandbox exactly as Chromium wants it.
 */
function sandboxWouldCrash(): boolean {
  if (process.platform !== 'linux') return false;
  const requested = process.argv.some((a) => a === '--no-sandbox' || a === '--disable-gpu-sandbox');
  if (requested) return false;
  return /\s/.test(process.execPath);
}

if (sandboxWouldCrash()) {
  app.commandLine.appendSwitch('no-sandbox');
  console.warn(
    `[cgpa-pilot] The app is running from a path containing spaces (${process.execPath}).\n` +
      '              Chromium cannot start its sandboxed zygote from such a path, so the\n' +
      '              renderer runs without the OS sandbox for this launch. Move the AppImage\n' +
      '              to a folder without spaces (e.g. ~/Applications) to get it back.'
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
 * which is what left the taskbar/dock showing a generic icon. `resources/icon.png`
 * is the `extraResources` copy (outside the archive, always readable).
 */
function windowIcon(): Electron.NativeImage | undefined {
  const files = [
    app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(app.getAppPath(), 'build', 'icons', '256x256.png'),
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
