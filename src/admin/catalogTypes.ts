// ─────────────────────────────────────────────────────────────────────────
// catalogTypes — pure type definitions for the admin catalog.
//
// Kept DOM/storage-free so the Cloudflare Worker (and the shared validation
// layer) can import them without pulling the browser storage module into
// its program. adminStorage re-exports everything here for compatibility.
// ─────────────────────────────────────────────────────────────────────────

import type { AppAppearance, CurriculumVersion, University } from '../config/types';

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

/**
 * v1 (legacy, per-device): SHA-256 of a passcode that only THIS device
 * knew. Kept for reading old backups; retired by v2 below.
 */
export interface AdminAuthData {
  /** SHA-256 of the passcode (never the plaintext). */
  passHash: string;
  /** Persistent local session so the admin isn't logged out on refresh. */
  session: boolean;
}

import type { AdminCredentialParams } from './passcodeCrypto';

/**
 * v2 — the SINGLE admin identity. The passcode is verified by the backend
 * (the only place the authoritative digest lives); what a device stores is:
 *   • the server-signed session token (valid online)
 *   • the PBKDF2 credential params (synced from the backend at sign-in) so
 *     the SAME passcode can verify offline on any signed-in device
 * The plaintext passcode is never stored anywhere.
 */
export interface AdminAuthV2 {
  v: 2;
  /** Server-signed session token (`cps1.<exp>.<hmac>`), or null. */
  sessionToken: string | null;
  /** ISO expiry of the session token, or null. */
  sessionExpiry: string | null;
  /** True while signed in (works offline via the synced credential). */
  offlineSession: boolean;
  /** PBKDF2 credential params for offline verification (never the passcode). */
  credential: AdminCredentialParams | null;
  /** Retired v1 digest, kept ONLY so a pre-existing device can sign in
   *  offline before it ever reaches the backend; dropped at first online
   *  sign-in. */
  legacyPassHash: string | null;
}

export interface AdminBackup {
  version: 1;
  exportedAt: string;
  catalog: AdminCatalog;
  auth: AdminAuthData | AdminAuthV2 | null;
}
