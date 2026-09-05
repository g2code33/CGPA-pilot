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
    Capacitor?: {
      isNativePlatform?: () => boolean;
    };
  }
  interface ImportMetaEnv {
    readonly PROD: boolean;
    readonly DEV: boolean;
    /** This build's app version (package.json "version", injected at build). */
    readonly VITE_APP_VERSION: string;
    /**
     * Optional base URL of the configuration API (full URL). Unset =
     * same-origin /api (the Cloudflare Worker hosts the app and the API).
     */
    readonly VITE_CONFIG_API_BASE?: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

export {};
