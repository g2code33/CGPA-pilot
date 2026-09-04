// ─────────────────────────────────────────────────────────────────────────
// Runtime catalog — the single in-memory holder of the configuration the
// student app is CURRENTLY running under.
//
// Population order (see services/configSync.ts, main.tsx):
//   1. boot: latest locally cached published config (IndexedDB → bundled seed)
//   2. boot: if the backend has a newer published version → the synced copy
//   3. admin "preview on this device" actions (same-origin, same browser)
//
// The committed build seed is only the bootstrap/fallback layer — never the
// normal persistence mechanism. Student academic data NEVER lives here; this
// is exclusively the published, non-personal catalog.
// ─────────────────────────────────────────────────────────────────────────

import type { AppAppearance, CurriculumVersion, University } from './types';
import { SEED_CURRICULA, SEED_UNIVERSITIES } from './seed';

/** Where the currently-running catalog came from. */
export type ConfigSource = 'seed' | 'backend' | 'local' | 'legacy';

/** The configuration document the app runs under (non-personal only). */
export interface CachedConfig {
  universities: University[];
  curricula: CurriculumVersion[];
  appearance?: AppAppearance;
  /** Published-config version from the backend (null = seed / local preview). */
  version: number | null;
  /** Backend updatedAt timestamp of the synced version, if any. */
  updatedAt: string | null;
  /** When this device last received this payload (ISO). */
  cachedAt: string;
  source: ConfigSource;
}

const EPOCH = new Date(0).toISOString();

let current: CachedConfig | null = null;

/** The bundled (committed seed) catalog — bootstrap / emergency fallback. */
export function seedRuntimeCatalog(): CachedConfig {
  return {
    universities: SEED_UNIVERSITIES,
    curricula: SEED_CURRICULA,
    appearance: undefined,
    version: null,
    updatedAt: null,
    cachedAt: EPOCH,
    source: 'seed',
  };
}

/** Replace the running catalog (used by boot, sync, and admin previews). */
export function setRuntimeCatalog(config: CachedConfig): void {
  current = config;
}

/**
 * The running catalog. On the first call (defensive — e.g. a test or a code
 * path that ran before boot finished) it falls back to the bundled seed so
 * the app is never without a valid configuration.
 */
export function getRuntimeCatalog(): CachedConfig {
  if (!current) current = seedRuntimeCatalog();
  return current;
}

/** True when the runtime catalog was already explicitly set (by boot/sync). */
export function isRuntimeCatalogSet(): boolean {
  return current !== null;
}
