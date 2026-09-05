import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AdminCatalog } from './adminStorage';
import {
  readAdminCatalog,
  writeAdminCatalog,
  readAdminAuth,
  updateAdminAuth,
  logoutKeepCredential,
  hashPasscode,
  readAdminSyncMeta,
  markCatalogDirty,
} from './adminStorage';
import { seedCatalog } from './adminConfigService';
import { verifyPasscode } from './passcodeCrypto';
import {
  changePasscode as apiChangePasscode,
  getBackendStatus,
  loginPasscode as apiLoginPasscode,
  publishCatalog,
  pullBackendCatalog,
  setupPasscode as apiSetupPasscode,
  type AuthState,
  type AuthResult,
  type BackendStatus,
  type PasscodeChangeResult,
  type PublishResult,
  type PullResult,
} from './adminApi';

type Syncing = 'idle' | 'checking' | 'publishing' | 'pulling';

/** Outcome of an interactive login attempt (online or offline). */
export interface LoginOutcome {
  ok: boolean;
  /** How the admin was verified. */
  mode?: 'online' | 'offline';
  error?: string;
}

interface AdminStore {
  catalog: AdminCatalog;
  authed: boolean;
  /** apply a catalog transform and persist it (local autosave) */
  apply: (fn: (c: AdminCatalog) => AdminCatalog) => void;
  setCatalog: (c: AdminCatalog) => void;
  /**
   * Sign in with the ONE admin passcode. Tries the backend first (the
   * authoritative check); when offline, verifies against the credential
   * synced to this device (or the legacy v1 digest on pre-existing devices).
   */
  login: (pass: string) => Promise<LoginOutcome>;
  /** First-time setup: create the single passcode (operator token required). */
  setup: (operatorToken: string, passcode: string) => Promise<AuthResult>;
  /** Change the single passcode (online only). */
  setPasscode: (current: string, next: string) => Promise<PasscodeChangeResult>;
  logout: () => void;
  // ── Backend (source of truth) ──────────────────────────────────────────
  backend: BackendStatus;
  syncing: Syncing;
  /** (Re)check the backend; auto-adopts a newer backend catalog. */
  checkBackend: () => Promise<BackendStatus>;
  /** Save this catalog + publish the student configuration to the backend. */
  publish: (note?: string) => Promise<PublishResult>;
  /** Load the authoritative catalog from the backend (replaces local). */
  pull: () => Promise<PullResult & { applied: boolean }>;
}

const AdminContext = createContext<AdminStore | null>(null);

const BACKEND_UNKNOWN: BackendStatus = {
  state: 'unknown',
  adminVersion: null,
  publishedVersion: null,
  updatedAt: null,
};

export function AdminProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalogState] = useState<AdminCatalog>(() =>
    readAdminCatalog(seedCatalog())
  );
  const [authed, setAuthed] = useState<boolean>(() => {
    const auth = readAdminAuth();
    return !!auth.offlineSession;
  });
  const [backend, setBackend] = useState<BackendStatus>(BACKEND_UNKNOWN);
  const [syncing, setSyncing] = useState<Syncing>('idle');

  // Keep the latest catalog available to async actions without stale closure
  // issues (publish must send what is on screen, not a snapshot).
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;

  useEffect(() => {
    writeAdminCatalog(catalog);
  }, [catalog]);

  const checkBackend = useCallback(async (): Promise<BackendStatus> => {
    setSyncing('checking');
    const st = await getBackendStatus();
    // Backend is authoritative: when it holds a catalog that is newer than
    // what this device last synced from it (or one this device has never
    // synced from at all), adopt it as the local working catalog.
    if (st.state === 'connected' && st.adminVersion != null) {
      const meta = readAdminSyncMeta();
      if (meta.adminVersion == null || st.adminVersion > meta.adminVersion) {
        if (meta.dirty) {
          // This device holds unpublished edits (an uploaded logo, text
          // changes, …). Silently adopting the backend would discard them —
          // surface the conflict and let the admin choose instead.
          setBackend({
            ...st,
            message: `The backend catalog is v${st.adminVersion}, but THIS browser has unpublished changes — use “Save & Publish” to keep and ship them, or load the backend version to discard them.`,
          });
          setSyncing('idle');
          return st;
        }
        const r = await pullBackendCatalog();
        if (r.ok && r.catalog) {
          writeAdminCatalog(r.catalog);
          setCatalogState(r.catalog);
          setBackend({
            ...st,
            message: `Loaded the latest catalog (v${st.adminVersion}) from the backend.`,
          });
          setSyncing('idle');
          return st;
        }
      }
    }
    setBackend(st);
    setSyncing('idle');
    return st;
  }, []);

  const publish = useCallback(async (note?: string): Promise<PublishResult> => {
    setSyncing('publishing');
    const r = await publishCatalog(catalogRef.current, { note });
    if (r.ok) {
      setBackend((b) => ({
        ...b,
        adminVersion: r.adminVersion ?? b.adminVersion,
        publishedVersion: r.publishedVersion ?? b.publishedVersion,
        updatedAt: r.updatedAt ?? b.updatedAt,
        message: `Published — catalog v${r.adminVersion} / student config v${r.publishedVersion} is now on the backend.`,
      }));
    }
    setSyncing('idle');
    return r;
  }, []);

  const pull = useCallback(async (): Promise<PullResult & { applied: boolean }> => {
    setSyncing('pulling');
    const r = await pullBackendCatalog();
    let applied = false;
    if (r.ok && r.catalog) {
      writeAdminCatalog(r.catalog);
      setCatalogState(r.catalog);
      applied = true;
    }
    setSyncing('idle');
    return { ...r, applied };
  }, []);

  // On login: check the backend (and adopt a newer catalog when present).
  useEffect(() => {
    if (authed) void checkBackend();
  }, [authed, checkBackend]);

  const value = useMemo<AdminStore>(
    () => ({
      catalog,
      authed,
      apply: (fn) => {
        markCatalogDirty();
        setCatalogState((c) => fn(c));
      },
      setCatalog: (c) => setCatalogState(c),
      async login(pass) {
        if (!pass || pass.trim().length === 0) {
          return { ok: false, error: 'Enter the admin passcode.' };
        }
        // 1) Authoritative check against the backend (the single passcode).
        const online = await apiLoginPasscode(pass);
        if (online.ok) {
          setCatalogState(readAdminCatalog(seedCatalog()));
          setAuthed(true);
          return { ok: true, mode: 'online' };
        }
        // Online and the passcode was WRONG → fail. Never fall back to a
        // possibly-stale local credential when the backend is reachable.
        if (online.error === 'invalid-passcode') {
          return { ok: false, error: online.message ?? 'Incorrect passcode.' };
        }
        // The backend says no passcode exists yet → setup is required.
        if (online.error === 'no-credential') {
          return { ok: false, error: 'The admin passcode has not been set yet — use First-time setup below.' };
        }
        // 2) Offline (unreachable / not configured): verify locally against
        //    the credential synced from the backend…
        const auth = readAdminAuth();
        if (auth.credential) {
          const ok = await verifyPasscode(pass, auth.credential);
          if (ok) {
            updateAdminAuth({ offlineSession: true });
            setCatalogState(readAdminCatalog(seedCatalog()));
            setAuthed(true);
            return { ok: true, mode: 'offline' };
          }
          return { ok: false, error: 'Incorrect passcode (verified offline against this device’s saved credential).' };
        }
        // …or the legacy per-device digest on a pre-existing v1 device.
        if (auth.legacyPassHash) {
          const hash = await hashPasscode(pass);
          if (hash === auth.legacyPassHash) {
            updateAdminAuth({ offlineSession: true });
            setCatalogState(readAdminCatalog(seedCatalog()));
            setAuthed(true);
            return { ok: true, mode: 'offline' };
          }
          return { ok: false, error: 'Incorrect passcode.' };
        }
        if (online.error === 'not-configured') {
          return { ok: false, error: 'The backend is not configured yet. See docs/DEPLOYMENT.md, then come back to set up the passcode.' };
        }
        return { ok: false, error: 'Offline, and this device has no saved passcode credential yet. Connect to the internet to sign in (or set up the passcode).' };
      },
      async setup(operatorToken, passcode) {
        const r = await apiSetupPasscode(operatorToken, passcode);
        if (r.ok) {
          setCatalogState(readAdminCatalog(seedCatalog()));
          setAuthed(true);
        }
        return r;
      },
      async setPasscode(current, next) {
        return apiChangePasscode(current, next);
      },
      logout() {
        logoutKeepCredential();
        setAuthed(false);
      },
      backend,
      syncing,
      checkBackend,
      publish,
      pull,
    }),
    [catalog, authed, backend, syncing, checkBackend, publish, pull]
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminStore {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin must be used within AdminProvider');
  return ctx;
}

// Re-export for the Login view's status probe.
export type { AuthState };
