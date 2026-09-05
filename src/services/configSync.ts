// ─────────────────────────────────────────────────────────────────────────
// configSync — offline-first synchronization of the PUBLISHED configuration.
//
// Flow (see main.tsx):
//   boot: load the locally cached payload (IndexedDB → seed) → run the app
//         IMMEDIATELY from local data (offline-first; no network is ever
//         required for the app to work).
//   boot (online): GET /api/config/meta (tiny) — if the backend version is
//         NEWER than the local one, GET /api/config/latest, validate the
//         payload, write it to the local store, and run from it.
//   background: one deferred check after load + on the "online" event; when
//         a newer version is stored mid-session it flags "reload available"
//         (explicit user action — never an automatic mid-session reload).
//
// Fallback chain: backend → last locally cached config → committed seed.
// Student academic data is NEVER sent anywhere; this module only ever GETs
// public configuration and writes it through services/configCache.ts (the
// sole student storage boundary).
// ─────────────────────────────────────────────────────────────────────────

import type { CachedConfig } from '../config/runtime';
import { getRuntimeCatalog, setRuntimeCatalog } from '../config/runtime';
import { configApiBase } from '../config/apiBase';
import { applyBrandFavicon } from '../config/branding';
import type { AppAppearance } from '../config/types';
import { readCachedConfigAsync, writeCachedConfig } from './configCache';
import { validateDistributionDocument } from '../admin/catalogValidation';

export type SyncStatus =
  | 'synced' // downloaded + applied a newer version
  | 'up-to-date' // backend present, local version already current
  | 'no-published' // backend reachable but nothing published yet
  | 'offline' // network unavailable / failed
  | 'no-backend' // static host / no API reachable at this URL
  | 'invalid-remote' // backend served a payload that failed validation
  | 'pending'; // boot deadline expired mid-transfer; background will retry

export interface SyncOutcome {
  status: SyncStatus;
  /** Version now running locally (null = seed / local preview). */
  localVersion: number | null;
  serverVersion?: number | null;
  /** True when this call replaced the running configuration. */
  changed: boolean;
  message?: string;
}

export interface SyncDeps {
  /** Injectable fetch (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Total network budget for this pass (ms). Default: none (background). */
  deadlineMs?: number;
  /** Override the API base (tests / special builds). */
  baseOverride?: string;
  /** Override the online probe (tests). Default: navigator.onLine. */
  isOnline?: () => boolean;
}

interface MetaDoc {
  format?: string;
  version?: number;
  updatedAt?: string;
  error?: string;
}
interface LatestDoc {
  format?: string;
  version?: number;
  updatedAt?: string;
  payload?: unknown;
}

function baseFrom(deps: SyncDeps): string {
  if (typeof deps.baseOverride === 'string') return deps.baseOverride.replace(/\/+$/, '');
  return configApiBase();
}

function urlFor(base: string, path: string): string {
  if (!base) return path;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null; // non-JSON response (static host 404 pages, proxies…)
  }
}

function fileProtocol(): boolean {
  try {
    return typeof window !== 'undefined' && window.location?.protocol === 'file:';
  } catch {
    return false;
  }
}

/**
 * One synchronization pass. Compares the local version against the backend
 * and, only when the backend is strictly newer, downloads + validates +
 * stores the full payload. Never throws.
 */
export async function checkAndSync(
  local: CachedConfig,
  deps: SyncDeps = {}
): Promise<SyncOutcome> {
  const localVersion = local.version ?? 0;
  const base = baseFrom(deps);
  const f = deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);

  const offline = (extra?: Partial<SyncOutcome>): SyncOutcome => ({
    status: 'offline',
    localVersion: local.version,
    changed: false,
    ...extra,
  });

  if (!f) return offline({ message: 'No network available in this environment.' });
  if (fileProtocol()) {
    return { status: 'no-backend', localVersion: local.version, changed: false, message: 'Local (file://) build — uses the bundled configuration.' };
  }
  const online = deps.isOnline
    ? deps.isOnline()
    : (typeof navigator !== 'undefined' ? navigator.onLine : true);
  if (online === false) return offline();

  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  if (typeof deps.deadlineMs === 'number' && deps.deadlineMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, deps.deadlineMs);
  }

  const done = (o: SyncOutcome): SyncOutcome => {
    if (timer) clearTimeout(timer);
    return o;
  };

  try {
    // 1. Cheap version probe.
    const metaRes = await f(urlFor(base, '/api/config/meta'), {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    const meta = (await safeJson(metaRes)) as MetaDoc | null;
    if (!meta || meta.format !== 'cgpa-pilot-config-meta') {
      // Got an HTTP response but not our API (static host, proxy, dev server).
      return done({ status: 'no-backend', localVersion: local.version, changed: false });
    }
    if (metaRes.status === 404 || meta.error === 'no-config-published') {
      return done({
        status: 'no-published',
        localVersion: local.version,
        serverVersion: null,
        changed: false,
        message: 'No configuration published yet.',
      });
    }
    const serverVersion = typeof meta.version === 'number' ? meta.version : null;
    if (serverVersion === null) {
      return done({ status: 'invalid-remote', localVersion: local.version, changed: false, message: 'Backend responded without a valid version.' });
    }
    if (serverVersion <= localVersion) {
      return done({ status: 'up-to-date', localVersion: local.version, serverVersion, changed: false });
    }

    // 2. Backend is newer → download the full payload (only what's needed).
    const latestRes = await f(urlFor(base, '/api/config/latest'), {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!latestRes.ok) {
      if (timedOut) return done({ status: 'pending', localVersion: local.version, serverVersion, changed: false });
      return done(offline({ serverVersion }));
    }
    const latest = (await safeJson(latestRes)) as LatestDoc | null;
    if (timedOut) {
      return done({ status: 'pending', localVersion: local.version, serverVersion, changed: false, message: 'Update will finish downloading in the background.' });
    }
    if (!latest || latest.format !== 'cgpa-pilot-config' || !latest.payload) {
      return done({ status: 'invalid-remote', localVersion: local.version, serverVersion, changed: false, message: 'Backend payload was malformed.' });
    }
    const validation = validateDistributionDocument(latest.payload);
    if (!validation.ok) {
      return done({
        status: 'invalid-remote',
        localVersion: local.version,
        serverVersion,
        changed: false,
        message: `Rejected invalid configuration from backend: ${validation.issues[0]}`,
      });
    }

    // 3. Store it locally, then run from it.
    const payload = latest.payload as {
      universities: unknown[];
      curricula: unknown[];
      appearance?: unknown;
      settings?: unknown;
    };
    await writeCachedConfig(
      {
        universities: payload.universities as never,
        curricula: payload.curricula as never,
        appearance: payload.appearance as never,
        settings: payload.settings as never,
      },
      { version: latest.version ?? serverVersion, updatedAt: latest.updatedAt ?? meta.updatedAt ?? null, source: 'backend' }
    );
    setRuntimeCatalog({
      universities: payload.universities as never,
      curricula: payload.curricula as never,
      appearance: payload.appearance as never,
      settings: payload.settings as never,
      version: latest.version ?? serverVersion,
      updatedAt: latest.updatedAt ?? meta.updatedAt ?? null,
      cachedAt: new Date().toISOString(),
      source: 'backend',
    });
    markPendingUpdate(null); // we're current now
    // Keep the browser tab icon in step with a mid-session branding change
    // (the boot path in main.tsx already applies it before first paint).
    applyBrandFavicon(payload.appearance as AppAppearance | undefined);
    return done({
      status: 'synced',
      localVersion: latest.version ?? serverVersion,
      serverVersion,
      changed: true,
      message: `Configuration updated to v${latest.version ?? serverVersion}.`,
    });
  } catch {
    if (timedOut) {
      return done({ status: 'pending', localVersion: local.version, changed: false, message: 'Update will finish downloading in the background.' });
    }
    return done(offline());
  }
}

// ── Boot: local first, then (online) a bounded remote check ──────────────

const BOOT_DEADLINE_MS = 8000;

/**
 * Boot sequence: load the local cache (fast, offline-first), set the runtime
 * catalog, then — when online — attempt a bounded remote check so a fresh or
 * outdated device runs the latest published config on its very first paint
 * when the network is fast enough. Returns what the app should report.
 */
export async function bootStudentConfig(
  deps: SyncDeps & { bootDeadlineMs?: number } = {}
): Promise<SyncOutcome> {
  const local = await readCachedConfigAsync();
  setRuntimeCatalog(local);
  return checkAndSync(local, { ...deps, deadlineMs: deps.bootDeadlineMs ?? BOOT_DEADLINE_MS });
}

// ── Background sync + "reload available" flag ─────────────────────────────

interface PendingUpdate {
  version: number | null;
  updatedAt: string | null;
}
let pendingUpdate: PendingUpdate | null = null;

export type ConfigUpdateListener = (p: { version: number | null; updatedAt: string | null } | null) => void;
const updateListeners = new Set<ConfigUpdateListener>();

/** Flag a newer stored version so the UI can offer an explicit reload. */
function markPendingUpdate(p: PendingUpdate | null): void {
  pendingUpdate = p;
  updateListeners.forEach((l) => {
    try {
      l(p);
    } catch {
      /* listener errors must not break sync */
    }
  });
}

/** Subscribe to "a newer configuration was stored" events (returns cleanup). */
export function onConfigUpdate(l: ConfigUpdateListener): () => void {
  updateListeners.add(l);
  return () => {
    updateListeners.delete(l);
  };
}

/** The pending (stored but not yet active) update, if any. */
export function getPendingConfigUpdate(): PendingUpdate | null {
  return pendingUpdate;
}

/** Clear the pending flag (the UI calls this right before reloading). */
export function clearPendingConfigUpdate(): void {
  markPendingUpdate(null);
}

let backgroundStarted = false;

/**
 * Record the outcome of a post-render (background) sync: when a NEWER version
 * was stored mid-session, flag it so the UI can offer an explicit
 * "reload to apply" — the app keeps working on the version it started with
 * (student data is never at risk from an automatic reload).
 */
export function recordBackgroundSync(outcome: SyncOutcome): void {
  if (outcome.status === 'synced' && outcome.changed) {
    markPendingUpdate({ version: outcome.localVersion, updatedAt: null });
  }
}

/**
 * After first render: one deferred full check + a check whenever the device
 * comes back online. If a newer version is stored mid-session the UI shows
 * a "reload to apply" affordance — the app itself keeps working on the
 * version it started with (student data is never at risk from a reload).
 */
export function startBackgroundConfigSync(deps: SyncDeps = {}): () => void {
  if (backgroundStarted) return () => {};
  backgroundStarted = true;

  const run = async () => {
    const current = getRuntimeCatalog();
    const outcome = await checkAndSync(current, deps);
    recordBackgroundSync(outcome);
  };

  const timer = setTimeout(() => void run(), 10000);
  const onOnline = () => void run();
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline);
  return () => {
    clearTimeout(timer);
    if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
    backgroundStarted = false;
  };
}
