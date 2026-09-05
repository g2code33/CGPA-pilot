// ─────────────────────────────────────────────────────────────────────────
// adminApi — the admin console's client for the configuration backend
// (Cloudflare Worker + D1). The backend is the AUTHORITATIVE store for the
// admin catalog, the published student configuration, and the SINGLE admin
// passcode credential:
//
//   GET  /api/admin/auth-state — public — is the passcode set yet?
//   POST /api/admin/login      — passcode → server-signed session
//   POST /api/admin/setup      — operator token, one-time passcode creation
//   POST /api/admin/passcode   — change the passcode (session required)
//   GET  /api/admin/status     — auth — versions on the backend
//   GET  /api/admin/catalog    — auth — the stored admin catalog
//   POST /api/admin/publish    — auth — persist catalog + publish student config
//
// Students only ever read the PUBLIC /api/config/* endpoints (see
// services/configSync.ts). This module performs network calls ONLY with
// non-personal configuration data; auth/session state lives in adminStorage.
// ─────────────────────────────────────────────────────────────────────────

import { configApiUrl } from '../config/apiBase';
import {
  currentAuthCredential,
  readAdminAuth,
  readApiToken,
  updateAdminAuth,
  validSessionToken,
  writeAdminSyncMeta,
  type AdminSyncMeta,
} from './adminStorage';
import {
  MAX_PASSCODE_LENGTH,
  MIN_PASSCODE_LENGTH,
  passcodePolicy,
  type AdminCredentialParams,
} from './passcodeCrypto';
import type { AdminCatalog } from './adminStorage';
import type { AiProvider, AiSettings } from './aiSettings';
import { validateAdminCatalogForPublish } from './catalogValidation';

export type BackendState =
  | 'unknown' // not checked yet
  | 'connected' // API reachable + credential OK
  | 'unreachable' // network failure / offline
  | 'not-configured' // API answered but backend is not set up (no D1 / token)
  | 'unauthorized'; // session expired/invalid and no operator token

export interface BackendStatus {
  state: BackendState;
  /** Version of the stored admin catalog on the backend (null = none yet). */
  adminVersion: number | null;
  /** Version of the published student configuration (null = none yet). */
  publishedVersion: number | null;
  updatedAt: string | null;
  message?: string;
}

export interface PublishResult {
  ok: boolean;
  adminVersion?: number;
  publishedVersion?: number;
  updatedAt?: string;
  error?: string;
  issues?: string[];
}

export interface PullResult {
  ok: boolean;
  catalog?: AdminCatalog;
  adminVersion?: number;
  updatedAt?: string;
  error?: string;
  issues?: string[];
}

export interface AuthState {
  /** The Worker is deployed AND configured (ADMIN_TOKEN + D1 present). */
  configured: boolean;
  /** The single admin passcode has been set on the backend. */
  hasCredential: boolean;
  /** Why we can't say (offline / not configured / …). */
  error?: string;
}

export interface AuthResult {
  ok: boolean;
  error?:
    | 'unreachable'
    | 'not-configured'
    | 'no-credential'
    | 'invalid-passcode'
    | 'invalid-current'
    | 'weak-passcode'
    | 'invalid-body'
    | 'credential-exists'
    | 'unauthorized'
    | 'http';
  message?: string;
  /** The server-issued session (login/setup) — stored by this module. */
  sessionToken?: string;
  sessionExpiry?: string;
}

export interface PasscodeChangeResult {
  ok: boolean;
  error?: string;
  message?: string;
}

export interface AdminApiDeps {
  fetchImpl?: typeof fetch;
  tokenOverride?: string | null;
  baseOverride?: string;
}

function baseFrom(deps: AdminApiDeps): string {
  if (typeof deps.baseOverride === 'string') return deps.baseOverride.replace(/\/+$/, '');
  return '';
}

function urlFor(deps: AdminApiDeps, path: string): string {
  const base = baseFrom(deps);
  if (!base) return configApiUrl(path);
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Credential for the Authorization header, in priority order:
 * explicit override (setup uses the raw operator token) → valid session →
 * saved raw operator token.
 */
function currentCredential(deps: AdminApiDeps): string | null {
  if (typeof deps.tokenOverride === 'string') {
    const t = deps.tokenOverride.trim();
    if (t) return t;
  }
  if (deps.tokenOverride === null) return null; // explicit "use nothing"
  return currentAuthCredential().token;
}

function headers(deps: AdminApiDeps): Record<string, string> {
  const token = currentCredential(deps);
  const h: Record<string, string> = { accept: 'application/json' };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Persist a successful online sign-in: store the session token + the
 * backend's credential params (for offline sign-in), and RETIRE the legacy
 * v1 digest (the backend passcode is now the only one that matters).
 */
function adoptServerAuth(doc: {
  session?: unknown;
  expiresAt?: unknown;
  credential?: unknown;
}): void {
  const cred: AdminCredentialParams | null =
    doc.credential &&
    typeof doc.credential === 'object' &&
    typeof (doc.credential as { salt?: unknown }).salt === 'string' &&
    typeof (doc.credential as { hash?: unknown }).hash === 'string' &&
    typeof (doc.credential as { iterations?: unknown }).iterations === 'number'
      ? (doc.credential as AdminCredentialParams)
      : null;
  updateAdminAuth({
    sessionToken: typeof doc.session === 'string' ? doc.session : null,
    sessionExpiry: typeof doc.expiresAt === 'string' ? doc.expiresAt : null,
    offlineSession: true,
    credential: cred,
    legacyPassHash: null,
  });
}

// ── Authentication (the single admin identity) ────────────────────────────

/**
 * Unauthenticated probe for the login screen: is the backend configured,
 * and is the passcode already set? Discloses nothing else.
 */
export async function getAuthState(deps: AdminApiDeps = {}): Promise<AuthState> {
  const f = deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return { configured: false, hasCredential: false, error: 'unreachable' };
  try {
    const res = await f(urlFor(deps, '/api/admin/auth-state'), {
      method: 'GET',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    const doc = (await safeJson(res)) as {
      configured?: boolean;
      hasCredential?: boolean;
    } | null;
    if (res.status === 503) {
      return { configured: false, hasCredential: false, error: 'not-configured' };
    }
    if (!res.ok || !doc) {
      return { configured: false, hasCredential: false, error: `http-${res.status}` };
    }
    return { configured: doc.configured === true, hasCredential: doc.hasCredential === true };
  } catch {
    return { configured: false, hasCredential: false, error: 'unreachable' };
  }
}

/**
 * Sign in with the ONE admin passcode (verified by the backend). On success
 * the session token + credential params are stored on this device.
 * Returns `unreachable` when offline — the caller may fall back to offline
 * verification against the stored credential.
 */
export async function loginPasscode(passcode: string, deps: AdminApiDeps = {}): Promise<AuthResult> {
  const f = deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return { ok: false, error: 'unreachable', message: 'No network available in this environment.' };
  try {
    const res = await f(urlFor(deps, '/api/admin/login'), {
      method: 'POST',
      cache: 'no-store',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ passcode }),
    });
    const doc = (await safeJson(res)) as {
      ok?: boolean;
      error?: string;
      message?: string;
      session?: string;
      expiresAt?: string;
      credential?: unknown;
    } | null;
    if (res.status === 503) {
      return { ok: false, error: 'not-configured', message: doc?.message ?? 'Backend is not configured yet.' };
    }
    if (res.status === 404) {
      return { ok: false, error: 'no-credential', message: doc?.message ?? 'No passcode has been set — use first-time setup.' };
    }
    if (res.status === 401) {
      return { ok: false, error: 'invalid-passcode', message: doc?.message ?? 'Incorrect passcode.' };
    }
    if (!res.ok || !doc || doc.ok !== true) {
      return { ok: false, error: 'http', message: doc?.message ?? `Sign-in failed (HTTP ${res.status}).` };
    }
    adoptServerAuth(doc);
    return {
      ok: true,
      sessionToken: doc.session,
      sessionExpiry: doc.expiresAt,
    };
  } catch {
    return { ok: false, error: 'unreachable', message: 'Backend unreachable (offline, or API not deployed at this URL).' };
  }
}

/**
 * First-time setup: create the single admin passcode. Requires the operator
 * token (ADMIN_TOKEN) — a raw secret known only to the operator, since no
 * passcode session exists yet.
 */
export async function setupPasscode(operatorToken: string, passcode: string, deps: AdminApiDeps = {}): Promise<AuthResult> {
  const f = deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return { ok: false, error: 'unreachable', message: 'No network available in this environment.' };
  const token = operatorToken.trim();
  if (!token) return { ok: false, error: 'invalid-body', message: 'The operator API token is required for first-time setup.' };
  const policy = passcodePolicy(passcode);
  if (policy) return { ok: false, error: 'weak-passcode', message: policy };
  try {
    const res = await f(urlFor(deps, '/api/admin/setup'), {
      method: 'POST',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ passcode }),
    });
    const doc = (await safeJson(res)) as {
      ok?: boolean;
      error?: string;
      message?: string;
      session?: string;
      expiresAt?: string;
      credential?: unknown;
    } | null;
    if (res.status === 401) {
      return { ok: false, error: 'unauthorized', message: doc?.message ?? 'The operator token was rejected.' };
    }
    if (res.status === 409) {
      return { ok: false, error: 'credential-exists', message: doc?.message ?? 'The passcode is already set — sign in instead.' };
    }
    if (res.status === 503) {
      return { ok: false, error: 'not-configured', message: doc?.message ?? 'Backend is not configured yet.' };
    }
    if (!res.ok || !doc || doc.ok !== true) {
      return { ok: false, error: 'http', message: doc?.message ?? `Setup failed (HTTP ${res.status}).` };
    }
    adoptServerAuth(doc);
    return { ok: true, sessionToken: doc.session, sessionExpiry: doc.expiresAt };
  } catch {
    return { ok: false, error: 'unreachable', message: 'Backend unreachable (offline, or API not deployed at this URL).' };
  }
}

/**
 * Change the single admin passcode. Requires the current passcode AND a
 * valid admin session (or operator token). The backend stores only the new
 * salted digest; the session continues to work and the local credential is
 * refreshed.
 */
export async function changePasscode(current: string, next: string, deps: AdminApiDeps = {}): Promise<PasscodeChangeResult> {
  const f = deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return { ok: false, error: 'unreachable', message: 'No network available in this environment.' };
  const policy = passcodePolicy(next);
  if (policy) return { ok: false, error: 'weak-passcode', message: policy };
  try {
    const res = await f(urlFor(deps, '/api/admin/passcode'), {
      method: 'POST',
      cache: 'no-store',
      headers: { ...headers(deps), 'content-type': 'application/json' },
      body: JSON.stringify({ current, next }),
    });
    const doc = (await safeJson(res)) as {
      ok?: boolean;
      error?: string;
      message?: string;
      credential?: unknown;
    } | null;
    if (res.status === 401) {
      const source = validSessionToken(readAdminAuth()) ? 'session' : readApiToken() ? 'token' : null;
      return {
        ok: false,
        error: 'unauthorized',
        message:
          source === 'session'
            ? 'Your admin session has expired. Sign in again, then change the passcode.'
            : source === 'token'
              ? 'The operator token was rejected.'
              : 'Sign in first — the passcode change needs a valid session.',
      };
    }
    if (res.status === 404) {
      return { ok: false, error: 'no-credential', message: doc?.message ?? 'No passcode has been set yet.' };
    }
    if (res.status === 503) {
      return { ok: false, error: 'not-configured', message: doc?.message ?? 'Backend is not configured yet.' };
    }
    if (!res.ok || !doc || doc.ok !== true) {
      return {
        ok: false,
        error: doc?.error === 'invalid-current' ? 'invalid-current' : doc?.error === 'weak-passcode' ? 'weak-passcode' : 'http',
        message: doc?.message ?? `Passcode change failed (HTTP ${res.status}).`,
      };
    }
    if (
      doc.credential &&
      typeof doc.credential === 'object' &&
      typeof (doc.credential as { salt?: unknown }).salt === 'string' &&
      typeof (doc.credential as { hash?: unknown }).hash === 'string' &&
      typeof (doc.credential as { iterations?: unknown }).iterations === 'number'
    ) {
      updateAdminAuth({ credential: doc.credential as AdminCredentialParams });
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'unreachable', message: 'Backend unreachable (offline, or API not deployed at this URL).' };
  }
}

// ── Backend status / catalog / publish ────────────────────────────────────

/**
 * Check the backend: reachable? configured? do we have a stored catalog?
 * Used on admin boot and by the "refresh" action.
 */
export async function getBackendStatus(deps: AdminApiDeps = {}): Promise<BackendStatus> {
  const f = deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  const base: BackendStatus = { adminVersion: null, publishedVersion: null, updatedAt: null, state: 'unknown' };
  if (!f) return { ...base, state: 'unreachable', message: 'No network available in this environment.' };
  try {
    const res = await f(urlFor(deps, '/api/admin/status'), {
      method: 'GET',
      cache: 'no-store',
      headers: headers(deps),
    });
    if (res.status === 401) {
      const source = currentCredential(deps) ? (validSessionToken(readAdminAuth()) ? 'session' : 'token') : null;
      const msg =
        source === 'session'
          ? 'Your admin session has expired (or was invalidated). Sign in again.'
          : source === 'token'
            ? 'The operator API token was rejected. Check it in Advanced settings.'
            : 'Sign in (passcode) — or save the operator API token in Advanced settings — to manage the backend.';
      return { ...base, state: 'unauthorized', message: msg };
    }
    if (res.status === 503) {
      const doc = (await safeJson(res)) as { message?: string } | null;
      return { ...base, state: 'not-configured', message: doc?.message ?? 'Backend is not fully configured (D1 database / admin token).' };
    }
    if (!res.ok) {
      const doc = (await safeJson(res)) as { message?: string } | null;
      // A non-API HTTP response (static host, proxy, dev server) → not configured here.
      return { ...base, state: 'not-configured', message: doc?.message ?? `API answered ${res.status} — is the configuration API deployed at this URL?` }
    }
    const doc = (await safeJson(res)) as {
      format?: string;
      hasCatalog?: boolean;
      adminVersion?: number | null;
      hasPublished?: boolean;
      publishedVersion?: number | null;
      updatedAt?: string | null;
    } | null;
    if (!doc || doc.format !== 'cgpa-pilot-admin-status') {
      return { ...base, state: 'not-configured', message: 'API response was not from the CGPA Pilot configuration API.' };
    }
    return {
      state: 'connected',
      adminVersion: doc.hasCatalog ? (doc.adminVersion ?? null) : null,
      publishedVersion: doc.hasPublished ? (doc.publishedVersion ?? null) : null,
      updatedAt: doc.updatedAt ?? null,
    };
  } catch {
    return { ...base, state: 'unreachable', message: 'Backend unreachable (offline, or API not deployed at this URL).' };
  }
}

/**
 * Client-side pre-flight for a publish: the SAME validation the server runs
 * (structural integrity + per-curriculum publish gate + appearance check).
 * Publishes with blocking errors are prevented BEFORE any network call.
 */
export function preflightPublish(catalog: AdminCatalog): { ok: boolean; issues: string[] } {
  return validateAdminCatalogForPublish(catalog);
}

/**
 * Save the admin catalog AND publish the student configuration in one
 * atomic backend operation. On success the local sync metadata is updated
 * so future boots know this device is current.
 */
export async function publishCatalog(
  catalog: AdminCatalog,
  deps: AdminApiDeps & { note?: string } = {}
): Promise<PublishResult> {
  const pre = preflightPublish(catalog);
  if (!pre.ok) {
    return { ok: false, error: 'Validation failed — fix the issues before publishing.', issues: pre.issues };
  }
  const f = deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return { ok: false, error: 'No network available in this environment.' };
  const credential = currentCredential(deps);
  if (!credential) {
    return { ok: false, error: 'Sign in first (passcode) — or save the operator API token in Advanced settings.' };
  }
  try {
    const res = await f(urlFor(deps, '/api/admin/publish'), {
      method: 'POST',
      cache: 'no-store',
      headers: { ...headers(deps), 'content-type': 'application/json' },
      body: JSON.stringify({ catalog, note: deps.note ?? null }),
    });
    const doc = (await safeJson(res)) as {
      ok?: boolean;
      error?: string;
      issues?: string[];
      adminVersion?: number;
      publishedVersion?: number;
      updatedAt?: string;
      message?: string;
    } | null;
    if (res.status === 401) {
      return { ok: false, error: 'Your admin session has expired (or the token was rejected). Sign in again.' };
    }
    if (res.status === 400 && doc?.issues?.length) {
      return { ok: false, error: 'The backend rejected the catalog (validation).', issues: doc.issues };
    }
    if (!res.ok || !doc || doc.ok !== true) {
      return {
        ok: false,
        error: doc?.message ?? doc?.error ?? `Publish failed (HTTP ${res.status}).`,
        issues: doc?.issues,
      };
    }
    const meta: AdminSyncMeta = {
      adminVersion: doc.adminVersion ?? null,
      publishedVersion: doc.publishedVersion ?? null,
      lastSyncAt: new Date().toISOString(),
      dirty: false, // the backend now holds this exact catalog — nothing left unpublished
    };
    writeAdminSyncMeta(meta);
    return {
      ok: true,
      adminVersion: doc.adminVersion,
      publishedVersion: doc.publishedVersion,
      updatedAt: doc.updatedAt,
    };
  } catch {
    return { ok: false, error: 'Could not reach the backend. Check your connection and try again.' };
  }
}

/** Fetch the authoritative admin catalog from the backend. */
export async function pullBackendCatalog(deps: AdminApiDeps = {}): Promise<PullResult> {
  const f = deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return { ok: false, error: 'No network available in this environment.' };
  try {
    const res = await f(urlFor(deps, '/api/admin/catalog'), {
      method: 'GET',
      cache: 'no-store',
      headers: headers(deps),
    });
    if (res.status === 401) {
      return { ok: false, error: 'Your admin session has expired (or the token was rejected). Sign in again.' };
    }
    if (res.status === 404) {
      return { ok: false, error: 'No catalog has been published to the backend yet.' };
    }
    if (!res.ok) {
      const doc = (await safeJson(res)) as { message?: string } | null;
      return { ok: false, error: doc?.message ?? `Pull failed (HTTP ${res.status}).` };
    }
    const doc = (await safeJson(res)) as {
      format?: string;
      version?: number;
      updatedAt?: string;
      catalog?: unknown;
    } | null;
    if (!doc || doc.format !== 'cgpa-pilot-admin-catalog' || !doc.catalog) {
      return { ok: false, error: 'Backend response was malformed.' };
    }
    const validation = validateAdminCatalogForPublish(doc.catalog);
    if (!validation.ok) {
      return { ok: false, error: 'Backend catalog failed validation (not adopted).', issues: validation.issues as string[] };
    }
    const meta: AdminSyncMeta = {
      adminVersion: doc.version ?? null,
      publishedVersion: null,
      lastSyncAt: new Date().toISOString(),
      dirty: false, // explicitly loading the backend catalog replaces local edits
    };
    writeAdminSyncMeta(meta);
    return {
      ok: true,
      catalog: doc.catalog as AdminCatalog,
      adminVersion: doc.version,
      updatedAt: doc.updatedAt,
    };
  } catch {
    return { ok: false, error: 'Could not reach the backend. Check your connection and try again.' };
  }
}

/**
 * Read-only fetch of the backend's stored admin catalog (the last PUBLISHED
 * working catalog). Unlike pullBackendCatalog this writes NOTHING locally —
 * it exists so the PREVIEW diff has a "what students see today" reference
 * without touching the working catalog or the dirty flag.
 */
export async function fetchBackendCatalog(deps: AdminApiDeps = {}): Promise<{ ok: boolean; catalog?: AdminCatalog; adminVersion?: number | null; updatedAt?: string | null; error?: string; message?: string }> {
  const f = deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return { ok: false, error: 'unreachable', message: 'No network available.' };
  try {
    const res = await f(urlFor(deps, '/api/admin/catalog'), { method: 'GET', cache: 'no-store', headers: headers(deps) });
    if (res.status === 401) return { ok: false, error: 'unauthorized', message: 'Sign in again — your admin session expired.' };
    if (res.status === 404) return { ok: false, error: 'not-found', message: 'Nothing has been published to the backend yet.' };
    if (res.status === 503) return { ok: false, error: 'not-configured', message: 'Backend is not configured yet.' };
    const doc = (await safeJson(res)) as { format?: string; version?: number; updatedAt?: string; catalog?: unknown } | null;
    if (!res.ok || !doc || doc.format !== 'cgpa-pilot-admin-catalog' || !doc.catalog) {
      return { ok: false, error: 'http', message: `Request failed (HTTP ${res.status}).` };
    }
    return { ok: true, catalog: doc.catalog as AdminCatalog, adminVersion: doc.version ?? null, updatedAt: doc.updatedAt ?? null };
  } catch {
    return { ok: false, error: 'unreachable', message: 'Backend unreachable (offline, or API not deployed at this URL).' };
  }
}

// ── AI assistant settings (server-side; keys never reach students) ────────

export interface AiAdminDoc {
  ok: boolean;
  settings?: AiSettings;
  hasStored?: boolean;
  error?: string;
  issues?: string[];
  message?: string;
  version?: number;
  updatedAt?: string;
}

/** Fetch the stored AI settings (including keys — admin-only endpoint). */
export async function getAiSettings(deps: AdminApiDeps = {}): Promise<AiAdminDoc> {
  const f = deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return { ok: false, error: 'unreachable', message: 'No network available.' };
  try {
    const res = await f(urlFor(deps, '/api/admin/ai'), { method: 'GET', cache: 'no-store', headers: headers(deps) });
    if (res.status === 401) return { ok: false, error: 'unauthorized', message: 'Sign in again — your admin session expired.' };
    if (res.status === 503) return { ok: false, error: 'not-configured', message: 'Backend is not configured yet.' };
    const doc = (await safeJson(res)) as AiAdminDoc | null;
    if (!res.ok || !doc) return { ok: false, error: 'http', message: `Request failed (HTTP ${res.status}).` };
    return doc;
  } catch {
    return { ok: false, error: 'unreachable', message: 'Backend unreachable (offline, or API not deployed at this URL).' };
  }
}

/** Save the AI settings (server validates + bumps the version). */
export async function saveAiSettings(settings: AiSettings, deps: AdminApiDeps = {}): Promise<AiAdminDoc> {
  const f = deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return { ok: false, error: 'unreachable', message: 'No network available.' };
  const credential = currentCredential(deps);
  if (!credential) return { ok: false, error: 'unauthorized', message: 'Sign in first — saving AI settings needs a valid session.' };
  try {
    const res = await f(urlFor(deps, '/api/admin/ai'), {
      method: 'POST',
      cache: 'no-store',
      headers: { ...headers(deps), 'content-type': 'application/json' },
      body: JSON.stringify(settings),
    });
    const doc = (await safeJson(res)) as AiAdminDoc | null;
    if (res.status === 401) return { ok: false, error: 'unauthorized', message: 'Sign in again — your admin session expired.' };
    if (res.status === 400 && doc?.issues?.length) return { ok: false, error: 'validation', issues: doc.issues };
    if (!res.ok || !doc || doc.ok !== true) {
      return { ok: false, error: doc?.error ?? 'http', message: doc?.message ?? `Save failed (HTTP ${res.status}).`, issues: doc?.issues };
    }
    return { ok: true, version: doc.version, updatedAt: doc.updatedAt };
  } catch {
    return { ok: false, error: 'unreachable', message: 'Backend unreachable (offline, or API not deployed at this URL).' };
  }
}

// ── Student-facing AI errors + system diagnostics ─────────────────────────

export interface AiErrorEntry {
  id: number;
  ts: string;
  kind: string;
  code: string | null;
  status: number | null;
  provider: string | null;
  model: string | null;
  keyLabel: string | null;
  detail: string | null;
}

export interface AiErrorDoc {
  ok: true;
  format: 'cgpa-pilot-admin-errors';
  total: number;
  errors: AiErrorEntry[];
}

/** The technical error log of what students hit (never their content). */
export async function getAiErrors(deps: AdminApiDeps = {}): Promise<AiErrorDoc | { ok: false; message: string }> {
  const f = deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return { ok: false, message: 'No network available.' };
  const credential = currentCredential(deps);
  if (!credential) return { ok: false, message: 'Sign in first.' };
  try {
    const res = await f(urlFor(deps, '/api/admin/errors?limit=200'), {
      method: 'GET',
      cache: 'no-store',
      headers: headers(deps),
    });
    if (res.status === 401) return { ok: false, message: 'Sign in again — your admin session expired.' };
    const doc = (await safeJson(res)) as AiErrorDoc | null;
    if (!res.ok || !doc || doc.format !== 'cgpa-pilot-admin-errors') {
      return { ok: false, message: `Error log unavailable (HTTP ${res.status}).` };
    }
    return doc;
  } catch {
    return { ok: false, message: 'Backend unreachable.' };
  }
}

export async function clearAiErrors(deps: AdminApiDeps = {}): Promise<{ ok: boolean; message?: string }> {
  const f = deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return { ok: false, message: 'No network available.' };
  const credential = currentCredential(deps);
  if (!credential) return { ok: false, message: 'Sign in first.' };
  try {
    const res = await f(urlFor(deps, '/api/admin/errors/clear'), {
      method: 'POST',
      cache: 'no-store',
      headers: { ...headers(deps), 'content-type': 'application/json' },
      body: '{}',
    });
    if (res.status === 401) return { ok: false, message: 'Sign in again — your admin session expired.' };
    const doc = (await safeJson(res)) as { ok?: boolean } | null;
    if (!res.ok || !doc?.ok) return { ok: false, message: `Could not clear (HTTP ${res.status}).` };
    return { ok: true };
  } catch {
    return { ok: false, message: 'Backend unreachable.' };
  }
}

export interface DiagnosticCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export async function getDiagnostics(deps: AdminApiDeps = {}): Promise<{ ok: true; at: string; checks: DiagnosticCheck[] } | { ok: false; message: string }> {
  const f = deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return { ok: false, message: 'No network available.' };
  const credential = currentCredential(deps);
  if (!credential) return { ok: false, message: 'Sign in first.' };
  try {
    const res = await f(urlFor(deps, '/api/admin/diagnostics'), {
      method: 'GET',
      cache: 'no-store',
      headers: headers(deps),
    });
    if (res.status === 401) return { ok: false, message: 'Sign in again — your admin session expired.' };
    const doc = (await safeJson(res)) as { format?: string; at?: string; checks?: DiagnosticCheck[] } | null;
    if (!res.ok || !doc || doc.format !== 'cgpa-pilot-admin-diagnostics' || !Array.isArray(doc.checks)) {
      return { ok: false, message: `Diagnostics unavailable (HTTP ${res.status}).` };
    }
    return { ok: true, at: doc.at ?? '', checks: doc.checks };
  } catch {
    return { ok: false, message: 'Backend unreachable.' };
  }
}

/** Test one key of one provider (a real, minimal request to the provider). */
export async function testAiKey(
  provider: AiProvider,
  keyValue: string,
  deps: AdminApiDeps = {}
): Promise<{ ok: boolean; message: string; detail?: string; model?: string; ms?: number }> {
  // Sends the provider + key exactly as the admin has them ON SCREEN —
  // testing works before the settings are saved (the Worker sanitizes the
  // same way it does on save).
  const f = deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return { ok: false, message: 'No network available.' };
  const credential = currentCredential(deps);
  if (!credential) return { ok: false, message: 'Sign in first — testing needs a valid session.' };
  try {
    const res = await f(urlFor(deps, '/api/admin/ai/test'), {
      method: 'POST',
      cache: 'no-store',
      headers: { ...headers(deps), 'content-type': 'application/json' },
      body: JSON.stringify({ provider, keyValue }),
    });
    const doc = (await safeJson(res)) as { ok: boolean; message: string; detail?: string; model?: string; ms?: number } | null;
    if (res.status === 401) return { ok: false, message: 'Sign in again — your admin session expired.' };
    return doc ?? { ok: false, message: `Test failed (HTTP ${res.status}).` };
  } catch {
    return { ok: false, message: 'Backend unreachable — cannot run the test.' };
  }
}

// ── Catalog drafts (saved WITHOUT publishing) ─────────────────────────────

export interface DraftMeta {
  id: string;
  name: string;
  note: string | null;
  createdAt: string;
}

export interface DraftDoc extends DraftMeta {
  catalog: AdminCatalog;
}

/** List backend drafts (metadata only, newest first). */
export async function listRemoteDrafts(deps: AdminApiDeps = {}): Promise<{ ok: boolean; drafts?: DraftMeta[]; error?: string; message?: string }> {
  const f = deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return { ok: false, error: 'unreachable', message: 'No network available.' };
  try {
    const res = await f(urlFor(deps, '/api/admin/drafts'), { method: 'GET', cache: 'no-store', headers: headers(deps) });
    if (res.status === 401) return { ok: false, error: 'unauthorized', message: 'Sign in again — your admin session expired.' };
    if (res.status === 503) return { ok: false, error: 'not-configured', message: 'Backend is not configured yet.' };
    const doc = (await safeJson(res)) as { drafts?: DraftMeta[] } | null;
    if (!res.ok || !doc) return { ok: false, error: 'http', message: `Request failed (HTTP ${res.status}).` };
    return { ok: true, drafts: Array.isArray(doc.drafts) ? doc.drafts : [] };
  } catch {
    return { ok: false, error: 'unreachable', message: 'Backend unreachable (offline, or API not deployed at this URL).' };
  }
}

/** Save (or overwrite, by id) a draft on the backend. */
export async function saveRemoteDraft(
  id: string,
  name: string,
  catalog: AdminCatalog,
  note: string | null,
  deps: AdminApiDeps = {}
): Promise<{ ok: boolean; id?: string; error?: string; message?: string }> {
  const f = deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return { ok: false, error: 'unreachable', message: 'No network available.' };
  const credential = currentCredential(deps);
  if (!credential) return { ok: false, error: 'unauthorized', message: 'Sign in first — saving drafts needs a valid session.' };
  try {
    const res = await f(urlFor(deps, '/api/admin/drafts'), {
      method: 'POST',
      cache: 'no-store',
      headers: { ...headers(deps), 'content-type': 'application/json' },
      body: JSON.stringify({ id, name, note, catalog }),
    });
    const doc = (await safeJson(res)) as { ok?: boolean; id?: string; error?: string; message?: string } | null;
    if (res.status === 401) return { ok: false, error: 'unauthorized', message: 'Sign in again — your admin session expired.' };
    if (!res.ok || !doc || doc.ok !== true) return { ok: false, error: doc?.error ?? 'http', message: doc?.message ?? `Save failed (HTTP ${res.status}).` };
    return { ok: true, id: doc.id };
  } catch {
    return { ok: false, error: 'unreachable', message: 'Backend unreachable (offline, or API not deployed at this URL).' };
  }
}

/** Fetch one backend draft (full catalog). */
export async function getRemoteDraft(id: string, deps: AdminApiDeps = {}): Promise<{ ok: boolean; draft?: DraftDoc; error?: string; message?: string }> {
  const f = deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return { ok: false, error: 'unreachable', message: 'No network available.' };
  try {
    const res = await f(urlFor(deps, `/api/admin/drafts/${encodeURIComponent(id)}`), { method: 'GET', cache: 'no-store', headers: headers(deps) });
    if (res.status === 401) return { ok: false, error: 'unauthorized', message: 'Sign in again — your admin session expired.' };
    if (res.status === 404) return { ok: false, error: 'not-found', message: 'Draft not found on the backend.' };
    const doc = (await safeJson(res)) as DraftDoc | null;
    if (!res.ok || !doc || !doc.catalog) return { ok: false, error: 'http', message: `Request failed (HTTP ${res.status}).` };
    return { ok: true, draft: doc };
  } catch {
    return { ok: false, error: 'unreachable', message: 'Backend unreachable (offline, or API not deployed at this URL).' };
  }
}

/** Delete a backend draft. */
export async function deleteRemoteDraft(id: string, deps: AdminApiDeps = {}): Promise<{ ok: boolean; error?: string; message?: string }> {
  const f = deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return { ok: false, error: 'unreachable', message: 'No network available.' };
  try {
    const res = await f(urlFor(deps, `/api/admin/drafts/${encodeURIComponent(id)}`), { method: 'DELETE', cache: 'no-store', headers: headers(deps) });
    if (res.status === 401) return { ok: false, error: 'unauthorized', message: 'Sign in again — your admin session expired.' };
    const doc = (await safeJson(res)) as { ok?: boolean; message?: string } | null;
    if (!res.ok || !doc || doc.ok !== true) return { ok: false, error: 'http', message: doc?.message ?? `Delete failed (HTTP ${res.status}).` };
    return { ok: true };
  } catch {
    return { ok: false, error: 'unreachable', message: 'Backend unreachable (offline, or API not deployed at this URL).' };
  }
}

export { MIN_PASSCODE_LENGTH, MAX_PASSCODE_LENGTH };
