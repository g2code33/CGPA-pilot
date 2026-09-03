// ─────────────────────────────────────────────────────────────────────────
// adminStorage — the ONLY other persistent-storage boundary besides the
// student curriculum cache. It stores ADMIN data only:
//   • the managed configuration catalog (universities/curricula — non-personal)
//   • the administrator's passcode (hashed) and local session flag
// It NEVER stores or uploads student academic data. The admin area is a
// separate application/entry; the student app cannot read admin secrets.
// ─────────────────────────────────────────────────────────────────────────

import type { AppAppearance, CurriculumVersion, University } from '../config/types';

const CFG_KEY = 'cgpa-pilot.admin.config.v1';
const AUTH_KEY = 'cgpa-pilot.admin.auth.v1';

/** What kind of entity a recycled/trashed item was. */
export type TrashKind = 'university' | 'school' | 'programme' | 'curriculum';

/** A soft-deleted item, kept so an administrator can restore or purge it. */
export interface TrashEntry {
  id: string;
  kind: TrashKind;
  /** Human label shown in the recycle bin (name / code etc.). */
  label: string;
  deletedAt: string;
  /** Deep snapshot of the deleted entity (University | School | Programme | CurriculumVersion). */
  data: unknown;
  /** Parent ids needed to restore into the correct place in the tree. */
  parent: { universityId?: string; schoolId?: string; programmeId?: string };
}

export interface AdminCatalog {
  universities: University[];
  curricula: CurriculumVersion[];
  /** Soft-deleted items awaiting restore or permanent deletion. */
  trash?: TrashEntry[];
  /** Optional branding the admin has set for the student app. */
  appearance?: AppAppearance;
}

/** Accessor that treats older catalogs without a trash array as empty. */
export function trashOf(catalog: AdminCatalog): TrashEntry[] {
  return catalog.trash ?? [];
}

export interface AdminAuthData {
  /** SHA-256 of the passcode (never the plaintext). */
  passHash: string;
  /** Persistent local session so the admin isn't logged out on refresh. */
  session: boolean;
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

export function readAdminAuth(): AdminAuthData | null {
  if (!storageAvailable()) return null;
  try {
    const raw = window.localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AdminAuthData;
  } catch {
    return null;
  }
}

export function writeAdminAuth(auth: AdminAuthData): void {
  if (!storageAvailable()) return;
  try {
    window.localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  } catch {
    /* storage unavailable */
  }
}

export function clearAdminSession(): void {
  if (!storageAvailable()) return;
  try {
    const auth = readAdminAuth();
    if (auth) writeAdminAuth({ ...auth, session: false });
  } catch {
    /* ignore */
  }
}

// ── Passcode hashing (WebCrypto SHA-256, with a non-async fallback) ─────────

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

export interface AdminBackup {
  version: 1;
  exportedAt: string;
  catalog: AdminCatalog;
  auth: AdminAuthData | null;
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
  if (data.auth) writeAdminAuth(data.auth);
  return true;
}

/** Factory default passcode. The admin can set their own on first run. */
export const DEFAULT_PASSCODE = 'pilot-admin';
