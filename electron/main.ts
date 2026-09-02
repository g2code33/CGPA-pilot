import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { autoUpdater } from 'electron-updater';

const isDev = !!process.env.VITE_DEV_SERVER_URL;
let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 380,
    minHeight: 560,
    title: 'CGPA Pilot',
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---- Auto-update (electron-updater reads latest.yml / latest-linux.yml
// published alongside the GitHub release) ----
function sendToRenderer(channel: string, payload: unknown) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function wireUpdater() {
  autoUpdater.autoDownload = false;

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
    sendToRenderer('updater:status', { status: 'unavailable' });
  });
  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer('updater:status', {
      status: 'downloading',
      percent: Math.round(progress.percent),
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
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

// ---- IPC ----
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
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
});

ipcMain.handle('updater:install', () => {
  // quitAndInstall restarts the app with the new version.
  autoUpdater.quitAndInstall();
  return { ok: true };
});
