// ─────────────────────────────────────────────────────────────────────────
// adminStorage — the ONLY other persistent-storage boundary besides the
// student curriculum cache. It stores ADMIN data only:
//   • the managed configuration catalog (universities/curricula — non-personal)
//   • the admin session (server-signed token + synced passcode CREDENTIAL
//     PARAMS for offline sign-in) — NEVER the plaintext passcode
//   • the optional operator API token (advanced: first-time setup / automation)
// It NEVER stores or uploads student academic data. The admin area is a
// separate application/entry; the student app cannot read admin secrets.
// ─────────────────────────────────────────────────────────────────────────

import type { AdminAuthData, AdminAuthV2, AdminBackup } from './catalogTypes';

const CFG_KEY = 'cgpa-pilot.admin.config.v1';
const AUTH_V1_KEY = 'cgpa-pilot.admin.auth.v1'; // legacy per-device (retired)
const AUTH_V2_KEY = 'cgpa-pilot.admin.auth.v2';
const SYNC_KEY = 'cgpa-pilot.admin.sync.v1';
const TOKEN_KEY = 'cgpa-pilot.admin.token.v1';

/**
 * Last-known backend versions for this device (written after a successful
 * publish or pull). Compared against the backend on boot to decide whether
 * the device should adopt the backend catalog (backend is authoritative).
 */
export interface AdminSyncMeta {
  adminVersion: number | null;
  publishedVersion: number | null;
  lastSyncAt: string | null;
}

// Pure catalog types live in ./catalogTypes (importable by the Worker and
// the shared validation layer without DOM/storage). Re-exported here so all
// existing imports keep working.
export type {
  AdminAuthData,
  AdminAuthV2,
  AdminBackup,
  AdminCatalog,
  TrashEntry,
  TrashKind,
} from './catalogTypes';
import type { AdminCatalog, TrashEntry } from './catalogTypes';

/** Accessor that treats older catalogs without a trash array as empty. */
export function trashOf(catalog: AdminCatalog): TrashEntry[] {
  return catalog.trash ?? [];
}

function storageAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && 'localStorage' in window;
  } catch {
    return false;
  }
}

export function readAdminCatalog(seed: AdminCatalog): AdminCatalog {
  if (!storageAvailable()) return seed;
  try {
    const raw = window.localStorage.getItem(CFG_KEY);
    if (!raw) return seed;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      Array.isArray(parsed.universities) &&
      Array.isArray(parsed.curricula)
    ) {
      // Normalise for older saved catalogs that predate trash/appearance.
      if (!Array.isArray(parsed.trash)) parsed.trash = [];
      return parsed as AdminCatalog;
    }
    return seed;
  } catch {
    return seed;
  }
}

export function writeAdminCatalog(catalog: AdminCatalog): void {
  if (!storageAvailable()) return;
  try {
    window.localStorage.setItem(CFG_KEY, JSON.stringify(catalog));
  } catch {
    /* storage unavailable */
  }
}

// ── Admin auth (v2 — the single admin identity) ───────────────────────────

const EMPTY_AUTH: AdminAuthV2 = {
  v: 2,
  sessionToken: null,
  sessionExpiry: null,
  offlineSession: false,
  credential: null,
  legacyPassHash: null,
};

function normalizeV2(raw: unknown): AdminAuthV2 | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const cred = o.credential;
  return {
    v: 2,
    sessionToken: typeof o.sessionToken === 'string' ? o.sessionToken : null,
    sessionExpiry: typeof o.sessionExpiry === 'string' ? o.sessionExpiry : null,
    offlineSession: o.offlineSession === true,
    credential:
      cred &&
      typeof cred === 'object' &&
      typeof (cred as { salt?: unknown }).salt === 'string' &&
      typeof (cred as { hash?: unknown }).hash === 'string'
        ? (cred as AdminAuthV2['credential'])
        : null,
    legacyPassHash: typeof o.legacyPassHash === 'string' ? o.legacyPassHash : null,
  };
}

/**
 * Read the admin auth state (v2). Migrates a legacy v1 record on first read:
 * the old per-device SHA-256 digest is carried into `legacyPassHash` (used
 * ONLY for offline sign-in on that pre-existing device, until a successful
 * online sign-in retires it) and the v1 key is removed.
 */
export function readAdminAuth(): AdminAuthV2 {
  if (!storageAvailable()) return { ...EMPTY_AUTH };
  try {
    const raw = window.localStorage.getItem(AUTH_V2_KEY);
    if (raw) {
      const v2 = normalizeV2(JSON.parse(raw));
      if (v2) return v2;
    }
    const legacy = window.localStorage.getItem(AUTH_V1_KEY);
    if (legacy) {
      const v1 = JSON.parse(legacy) as Partial<AdminAuthData>;
      const migrated: AdminAuthV2 = {
        ...EMPTY_AUTH,
        offlineSession: v1.session === true,
        legacyPassHash: typeof v1.passHash === 'string' ? v1.passHash : null,
      };
      window.localStorage.setItem(AUTH_V2_KEY, JSON.stringify(migrated));
      window.localStorage.removeItem(AUTH_V1_KEY);
      return migrated;
    }
  } catch {
    /* corrupted → start fresh */
  }
  return { ...EMPTY_AUTH };
}

export function writeAdminAuth(auth: AdminAuthV2): void {
  if (!storageAvailable()) return;
  try {
    window.localStorage.setItem(AUTH_V2_KEY, JSON.stringify({ ...auth, v: 2 }));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Update fields of the stored auth state, returning the new value.
 */
export function updateAdminAuth(patch: Partial<AdminAuthV2>): AdminAuthV2 {
  const next = { ...readAdminAuth(), ...patch, v: 2 as const };
  writeAdminAuth(next);
  return next;
}

/**
 * Log out: drop the session (online token + offline flag) but KEEP the
 * synced credential so the same admin can sign back in — even offline —
 * with the same passcode.
 */
export function logoutKeepCredential(): AdminAuthV2 {
  return updateAdminAuth({ sessionToken: null, sessionExpiry: null, offlineSession: false });
}

/** Clock skew tolerance for the session expiry check. */
const SESSION_SKEW_MS = 5 * 60 * 1000;

/** The session token to send to the API, or null when absent/expired. */
export function validSessionToken(auth: AdminAuthV2 = readAdminAuth()): string | null {
  if (!auth.sessionToken) return null;
  if (auth.sessionExpiry) {
    const exp = Date.parse(auth.sessionExpiry);
    if (Number.isFinite(exp) && Date.now() > exp + SESSION_SKEW_MS) return null;
  }
  return auth.sessionToken;
}

/**
 * The credential for the admin Authorization header, in priority order:
 * valid session token (day-to-day) → raw operator token (advanced/setup).
 */
export function currentAuthCredential(): { token: string | null; source: 'session' | 'token' | null } {
  const session = validSessionToken();
  if (session) return { token: session, source: 'session' };
  const raw = readApiToken();
  return raw ? { token: raw, source: 'token' } : { token: null, source: null };
}

// ── Backend sync metadata + operator API token (admin device state only) ───

export function readAdminSyncMeta(): AdminSyncMeta {
  if (!storageAvailable()) return { adminVersion: null, publishedVersion: null, lastSyncAt: null };
  try {
    const raw = window.localStorage.getItem(SYNC_KEY);
    if (!raw) return { adminVersion: null, publishedVersion: null, lastSyncAt: null };
    const m = JSON.parse(raw) as AdminSyncMeta;
    return {
      adminVersion: typeof m.adminVersion === 'number' ? m.adminVersion : null,
      publishedVersion: typeof m.publishedVersion === 'number' ? m.publishedVersion : null,
      lastSyncAt: typeof m.lastSyncAt === 'string' ? m.lastSyncAt : null,
    };
  } catch {
    return { adminVersion: null, publishedVersion: null, lastSyncAt: null };
  }
}

export function writeAdminSyncMeta(meta: AdminSyncMeta): void {
  if (!storageAvailable()) return;
  try {
    window.localStorage.setItem(SYNC_KEY, JSON.stringify(meta));
  } catch {
    /* storage unavailable */
  }
}

/**
 * The operator API token (advanced). Gates FIRST-TIME passcode setup and
 * automation. Day-to-day admin access uses the passcode session, so this is
 * optional for a device that has signed in at least once. Stored locally on
 * the admin's own device only — sent exclusively to the config API.
 */
export function readApiToken(): string | null {
  if (!storageAvailable()) return null;
  try {
    const raw = window.localStorage.getItem(TOKEN_KEY);
    return raw && raw.trim() ? raw.trim() : null;
  } catch {
    return null;
  }
}

export function writeApiToken(token: string | null): void {
  if (!storageAvailable()) return;
  try {
    if (token === null || token.trim() === '') {
      window.localStorage.removeItem(TOKEN_KEY);
    } else {
      window.localStorage.setItem(TOKEN_KEY, token.trim());
    }
  } catch {
    /* storage unavailable */
  }
}

// ── Legacy passcode hashing (v1 offline migration path only) ───────────────

export async function hashPasscode(pass: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(`cgpa-pilot::${pass}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    // Very old/insecure context (no SubtleCrypto): a simple hash fallback.
    let h = 0;
    const s = `cgpa-pilot::${pass}`;
    for (let i = 0; i < s.length; i++) {
      h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    }
    return `fb-${(h >>> 0).toString(16)}`;
  }
}

export function exportAdminBackup(): AdminBackup {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    catalog: readAdminCatalog({ universities: [], curricula: [] }),
    auth: readAdminAuth(),
  };
}

export function importAdminBackup(data: AdminBackup): boolean {
  if (!data || data.version !== 1 || !Array.isArray(data.catalog?.universities) || !Array.isArray(data.catalog?.curricula)) return false;
  writeAdminCatalog(data.catalog);
  if (data.auth) {
    if ('v' in data.auth && (data.auth as AdminAuthV2).v === 2) {
      writeAdminAuth(normalizeV2(data.auth) ?? { ...EMPTY_AUTH });
    } else {
      // Legacy v1 record: migrate it (session + legacy hash, no credential).
      const v1 = data.auth as AdminAuthData;
      writeAdminAuth({
        ...EMPTY_AUTH,
        offlineSession: v1.session === true,
        legacyPassHash: typeof v1.passHash === 'string' ? v1.passHash : null,
      });
    }
  }
  return true;
}
