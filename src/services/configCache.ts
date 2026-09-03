// ─────────────────────────────────────────────────────────────────────────
// Curriculum configuration cache (offline support)
//
// ⚠️ PRIVACY BOUNDARY — read carefully:
// This module is the ONLY place in the application allowed to use persistent
// browser storage, and it may ONLY store PUBLISHED, NON-PERSONAL curriculum
// configuration (universities / programmes / curricula / courses / grading
// rules). It must NEVER store or receive student academic data (CGPA, GPA,
// grades, targets, scenarios, entries). The smoke test enforces that no
// other module touches storage APIs.
//
// Purpose: cache the latest valid published curriculum so the student app
// keeps working fully offline. Student calculations never make network
// requests; configuration refresh is independent and optional.
// ─────────────────────────────────────────────────────────────────────────

import type {
  AppAppearance,
  CurriculumVersion,
  University,
} from '../config/types';
import { BUNDLED_CURRICULA, UNIVERSITIES } from '../config/context';

const STORAGE_KEY = 'cgpa-pilot.config.v1';

interface CachedConfig {
  /** Non-personal university catalog (grading + classification rules). */
  universities: University[];
  /** Non-personal curriculum versions. */
  curricula: CurriculumVersion[];
  /** Optional non-personal branding/icons set by the administrator. */
  appearance?: AppAppearance;
  cachedAt: string; // ISO timestamp
  schemaVersion: 1;
}

function storageAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && 'localStorage' in window;
  } catch {
    return false;
  }
}

/** The offline/fallback configuration shipped inside the app bundle. */
export function bundledConfig(): CachedConfig {
  return {
    universities: UNIVERSITIES,
    curricula: BUNDLED_CURRICULA,
    cachedAt: new Date(0).toISOString(),
    schemaVersion: 1,
  };
}

function isValid(config: unknown): config is CachedConfig {
  if (!config || typeof config !== 'object') return false;
  const c = config as CachedConfig;
  return (
    c.schemaVersion === 1 &&
    Array.isArray(c.universities) &&
    c.universities.length > 0 &&
    Array.isArray(c.curricula) &&
    typeof c.cachedAt === 'string'
  );
}

export function readCachedConfig(): CachedConfig {
  if (!storageAvailable()) return bundledConfig();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return bundledConfig();
    const parsed = JSON.parse(raw);
    // Never trust a malformed/partial cache — fall back to the bundled copy.
    return isValid(parsed) ? parsed : bundledConfig();
  } catch {
    return bundledConfig();
  }
}

export function writeCachedConfig(config: CachedConfig): void {
  if (!storageAvailable()) return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...config, cachedAt: new Date().toISOString() })
    );
  } catch {
    /* storage full / unavailable — offline use simply falls back to bundle */
  }
}

export function clearCachedConfig(): void {
  if (!storageAvailable()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Seed the cache from the bundled configuration on first run. */
export function seedCacheIfEmpty(): CachedConfig {
  const cached = readCachedConfig();
  if (!storageAvailable()) return cached;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = bundledConfig();
      writeCachedConfig(seeded);
      return seeded;
    }
  } catch {
    /* ignore */
  }
  return cached;
}

// ── Branding / appearance (non-personal) ─────────────────────────────────
// The administrator can set a logo + icon overrides and "apply to this
// device", which stores them here so the offline student app reflects them.
// This module remains the only student storage boundary and stores no
// student data — only the admin's branding config.

/** Read the administrator-set appearance, if any. */
export function readCachedAppearance(): AppAppearance | undefined {
  return readCachedConfig().appearance;
}

/** Store (or clear) the administrator-set appearance for the student app. */
export function setCachedAppearance(appearance: AppAppearance | undefined): void {
  const cfg = readCachedConfig();
  writeCachedConfig({ ...cfg, appearance });
}

/**
 * Wipe this device's temporary browser storage and service-worker caches. Used
 * by the student "Refresh / Clear session" and "Restart to update" controls so
 * every storage touch stays inside this single boundary module.
 */
export function wipeDeviceStorage(): void {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  try {
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
  try {
    if (typeof caches !== 'undefined') {
      caches.keys().then((names) => {
        names.forEach((name) => void caches.delete(name));
      });
    }
  } catch {
    /* ignore */
  }
}
