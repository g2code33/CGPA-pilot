// Self-contained declaration of the bridge exposed by electron/preload.ts.
// Kept independent of the Electron sources so the web TS project never
// pulls Node/Electron typings into the renderer build.

export interface UpdaterStatus {
  status:
    | 'checking'
    | 'available'
    | 'unavailable'
    | 'downloading'
    | 'downloaded'
    | 'error';
  version?: string;
  releaseNotes?: unknown;
  percent?: number;
  message?: string;
  dev?: boolean;
}

export interface CgpaPilotApi {
  getVersion: () => Promise<string>;
  checkForUpdates: () => Promise<UpdaterStatus>;
  downloadUpdate: () => Promise<{ ok: boolean; message?: string }>;
  installUpdate: () => Promise<{ ok: boolean }>;
  onUpdaterStatus: (
    callback: (status: UpdaterStatus) => void
  ) => () => void;
}

declare global {
  interface Window {
    cgpaPilot?: CgpaPilotApi;
  }
  interface ImportMetaEnv {
    readonly PROD: boolean;
    readonly DEV: boolean;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

export {};
