// ─────────────────────────────────────────────────────────────────────────
// Curriculum configuration cache (offline support) — v2
//
// ⚠️ PRIVACY BOUNDARY — read carefully:
// This module is the ONLY place in the application allowed to use persistent
// browser storage, and it may ONLY store PUBLISHED, NON-PERSONAL curriculum
// configuration (universities / programmes / curricula / courses / grading
// rules / branding). It must NEVER store or receive student academic data
// (CGPA, GPA, grades, targets, scenarios, entries). The smoke test enforces
// that no other module touches storage APIs.
//
// v2 storage layout (offline-first, backend-synced):
//   • IndexedDB (db "cgpa-pilot-config", store "payloads", key "current"):
//     the full configuration PAYLOAD — durable, high-capacity, the real
//     offline store for the (potentially multi-MB) academic catalog.
//   • localStorage key "cgpa-pilot.config.meta.v2" (small, SYNCHRONOUS):
//     version metadata only — { version, updatedAt, source, cachedAt } — so
//     the sync client can cheaply compare versions before any download.
//   • legacy key "cgpa-pilot.config.v1" (v1 payload in localStorage):
//     read once on upgrade and migrated into IndexedDB, then dropped.
//
// Fallback chain when reading: IndexedDB → legacy v1 → bundled seed.
// The committed build seed is only the bootstrap/emergency layer.
//
// Student calculations never make network requests; configuration refresh
// lives in services/configSync.ts, which calls THIS module to persist what
// it downloaded.
// ─────────────────────────────────────────────────────────────────────────

import type { AppAppearance, CurriculumVersion, StudentSettings, University } from '../config/types';
import type { CachedConfig, ConfigSource } from '../config/runtime';
import { BUNDLED_CURRICULA, UNIVERSITIES } from '../config/context';
import { SEED_APPEARANCE } from '../config/seed';

const IDB_NAME = 'cgpa-pilot-config';
const IDB_VERSION = 1;
const IDB_STORE = 'payloads';
const IDB_KEY = 'current';

const META_KEY = 'cgpa-pilot.config.meta.v2';
const LEGACY_PAYLOAD_KEY = 'cgpa-pilot.config.v1';

export interface ConfigMeta {
  version: number | null;
  updatedAt: string | null;
  cachedAt: string;
  source: ConfigSource;
}

interface StoredPayload {
  universities: University[];
  curricula: CurriculumVersion[];
  appearance?: AppAppearance;
  settings?: StudentSettings;
  version: number | null;
  updatedAt: string | null;
  source: ConfigSource;
  cachedAt: string;
}

// ── Environment guards ────────────────────────────────────────────────────

function windowRef(): Window | null {
  try {
    return typeof window !== 'undefined' ? (window as Window) : null;
  } catch {
    return null;
  }
}

function localStorageRef(): Storage | null {
  const w = windowRef();
  if (!w) return null;
  try {
    return 'localStorage' in w ? w.localStorage : null;
  } catch {
    return null;
  }
}

function indexedDBRef(): IDBFactory | null {
  try {
    return typeof indexedDB !== 'undefined' ? indexedDB : null;
  } catch {
    return null;
  }
}

// ── Bundled (seed) fallback ───────────────────────────────────────────────

/** The offline/fallback configuration shipped inside the app bundle. */
export function bundledConfig(): CachedConfig {
  return {
    universities: UNIVERSITIES,
    curricula: BUNDLED_CURRICULA,
    // Admin-set branding baked in at BUILD time (scripts/refresh-seed.mjs +
    // the fresh-seed Vite plugin): the offline fallback carries the latest
    // published logo/wordmark/icons, never a stale default image.
    appearance: SEED_APPEARANCE,
    version: null,
    updatedAt: null,
    cachedAt: new Date(0).toISOString(),
    source: 'seed',
  };
}

// ── Shape validation (never trust a malformed cache) ──────────────────────

function isValidPayload(p: unknown): p is StoredPayload {
  if (!p || typeof p !== 'object') return false;
  const c = p as StoredPayload;
  return (
    Array.isArray(c.universities) &&
    c.universities.length > 0 &&
    Array.isArray(c.curricula) &&
    typeof c.cachedAt === 'string'
  );
}

// ── Synchronous meta (cheap version comparison before any download) ──────

export function readConfigMetaSync(): ConfigMeta {
  const ls = localStorageRef();
  if (ls) {
    try {
      const raw = ls.getItem(META_KEY);
      if (raw) {
        const m = JSON.parse(raw) as ConfigMeta;
        if (m && (typeof m.version === 'number' || m.version === null) && typeof m.cachedAt === 'string') {
          return m;
        }
      }
    } catch {
      /* corrupt meta → fall through */
    }
  }
  // No v2 meta: derive from whatever legacy payload may exist.
  if (ls) {
    try {
      if (ls.getItem(LEGACY_PAYLOAD_KEY)) {
        return { version: null, updatedAt: null, cachedAt: new Date(0).toISOString(), source: 'legacy' };
      }
    } catch {
      /* ignore */
    }
  }
  return { version: null, updatedAt: null, cachedAt: new Date(0).toISOString(), source: 'seed' };
}

// ── IndexedDB access (payload store) ─────────────────────────────────────

function openIdb(): Promise<IDBDatabase | null> {
  const idb = indexedDBRef();
  if (!idb) return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest | null = null;
    try {
      request = idb.open(IDB_NAME, IDB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request!.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function idbGet(): Promise<StoredPayload | null> {
  const db = await openIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: StoredPayload | null) => {
      if (done) return;
      done = true;
      try {
        db.close();
      } catch {
        /* ignore */
      }
      resolve(v);
    };
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => {
        const v = req.result as StoredPayload | undefined;
        finish(v && isValidPayload(v) ? v : null);
      };
      req.onerror = () => finish(null);
    } catch {
      finish(null);
    }
  });
}

async function idbPut(payload: StoredPayload): Promise<boolean> {
  const db = await openIdb();
  if (!db) return false;
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try {
        db.close();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put({ ...payload }, IDB_KEY);
      tx.oncomplete = () => finish(true);
      tx.onerror = () => finish(false);
      tx.onabort = () => finish(false);
    } catch {
      finish(false);
    }
  });
}

async function idbDelete(key?: string): Promise<void> {
  const db = await openIdb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      if (key) tx.objectStore(IDB_STORE).delete(key);
      else tx.objectStore(IDB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    } finally {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
  });
}

// ── Read / write API ──────────────────────────────────────────────────────

function legacyPayload(): StoredPayload | null {
  const ls = localStorageRef();
  if (!ls) return null;
  try {
    const raw = ls.getItem(LEGACY_PAYLOAD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPayload;
    if (
      parsed &&
      Array.isArray(parsed.universities) &&
      parsed.universities.length > 0 &&
      Array.isArray(parsed.curricula) &&
      typeof parsed.cachedAt === 'string'
    ) {
      return {
        ...parsed,
        version: null,
        updatedAt: null,
        source: 'legacy',
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Load the latest valid locally-stored configuration (async — IndexedDB is
 * the primary payload store). Falls back: legacy v1 localStorage payload →
 * bundled seed. A one-shot migration moves a legacy payload into IndexedDB.
 */
export async function readCachedConfigAsync(): Promise<CachedConfig> {
  const fromIdb = await idbGet();
  if (fromIdb) return fromIdb;
  const legacy = legacyPayload();
  if (legacy) {
    void idbPut(legacy); // migrate the v1 payload forward (best effort)
    return legacy;
  }
  return bundledConfig();
}

export interface WriteOptions {
  version: number | null;
  updatedAt?: string | null;
  source?: 'backend' | 'local';
}

/**
 * Persist a locally-valid configuration (payload → IndexedDB, then version
 * meta → localStorage). The meta is only written once the payload is durably
 * stored, so a device with unavailable IndexedDB keeps reporting version
 * "null" and re-syncs on the next boot instead of believing it is current.
 */
export async function writeCachedConfig(
  config: {
    universities: University[];
    curricula: CurriculumVersion[];
    appearance?: AppAppearance;
    settings?: StudentSettings;
  },
  opts: WriteOptions
): Promise<void> {
  const cachedAt = new Date().toISOString();
  const payload: StoredPayload = {
    universities: config.universities,
    curricula: config.curricula,
    appearance: config.appearance,
    settings: config.settings,
    version: opts.version,
    updatedAt: opts.updatedAt ?? null,
    source: opts.source ?? 'local',
    cachedAt,
  };
  const stored = await idbPut(payload);
  const ls = localStorageRef();
  if (stored && ls) {
    const meta: ConfigMeta = {
      version: opts.version,
      updatedAt: opts.updatedAt ?? null,
      cachedAt,
      source: payload.source,
    };
    try {
      ls.setItem(META_KEY, JSON.stringify(meta));
      ls.removeItem(LEGACY_PAYLOAD_KEY); // superseded by the v2 store
    } catch {
      /* storage full/unavailable — meta is best-effort */
    }
  }
}

/** Clear the local configuration cache (payload + meta + legacy). */
export function clearCachedConfig(): void {
  const ls = localStorageRef();
  if (ls) {
    try {
      ls.removeItem(META_KEY);
      ls.removeItem(LEGACY_PAYLOAD_KEY);
    } catch {
      /* ignore */
    }
  }
  void idbDelete();
}

/**
 * Reset the transient device state for the "Refresh / Clear session" and
 * "Restart to update" controls.
 *
 * Student work is IN-MEMORY ONLY (see store.tsx — deliberately no
 * localStorage/sessionStorage/IndexedDB), so the store 'reset' dispatch + the
 * full page reload that follow this call ARE the complete clear. This
 * deliberately does NOT delete:
 *   • the offline curriculum config (localStorage meta + IndexedDB payload),
 *   • the service-worker app-shell caches, or
 *   • admin console data on this browser.
 *
 * Wiping any of those (as this used to) threw the app back to the bundled
 * fallback seed — stale logos/icons until a re-sync landed, often only after
 * several manual refreshes — and destroyed the offline shell, so the clear
 * was slow. Nothing is cleared here anymore; all storage touches in the app
 * still live in this module.
 */
export function wipeDeviceStorage(): void {
  // Intentionally a no-op: there is no student-owned persistent storage to
  // reset (student state is in-memory and the caller's reload drops it), and
  // the config cache / app shell / admin data must survive a clear so the app
  // can never fall back to a stale bundled seed.
}
