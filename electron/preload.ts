import { contextBridge, ipcRenderer } from 'electron';

export type UpdaterStatus =
  | { status: 'checking' }
  | { status: 'available'; version?: string; releaseNotes?: unknown }
  | { status: 'unavailable'; dev?: boolean }
  | { status: 'downloading'; percent: number }
  | { status: 'downloaded'; version?: string }
  | { status: 'error'; message: string };

const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  checkForUpdates: (): Promise<UpdaterStatus> =>
    ipcRenderer.invoke('updater:check'),
  downloadUpdate: (): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke('updater:download'),
  installUpdate: (): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke('updater:install'),
  /**
   * Hand the administrator's app logo to the OS shell: window/taskbar icon now,
   * per-user launcher icon for the desktop environment. `logo` is a data: URL or
   * any http(s) image URL; `name` is the admin's product name for the menu.
   */
  setBrandIcon: (
    logo: string,
    name?: string
  ): Promise<{ ok: boolean; changed?: boolean; message?: string }> =>
    ipcRenderer.invoke('branding:set-icon', logo, name),
  onUpdaterStatus: (callback: (status: UpdaterStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: UpdaterStatus) =>
      callback(status);
    ipcRenderer.on('updater:status', listener);
    return () => ipcRenderer.removeListener('updater:status', listener);
  },
};

contextBridge.exposeInMainWorld('cgpaPilot', api);

export type CgpaPilotApi = typeof api;
