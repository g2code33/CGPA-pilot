// ─────────────────────────────────────────────────────────────────────────
// db — D1 persistence for the authoritative configuration.
//
// Two single-row tables:
//   published_config  — the versioned document STUDENTS receive
//                       (distribution payload: universities + PUBLISHED
//                       curricula + optional non-personal appearance).
//   admin_catalog     — the full admin working catalog (all curriculum
//                       statuses, trash, appearance) that admin devices
//                       sync from (source of truth after migration).
//
// Versions are strictly monotonic integers, assigned atomically per publish
// (read current → +1, both rows written in one D1 transaction via batch).
// ─────────────────────────────────────────────────────────────────────────

import type { D1Database } from '@cloudflare/workers-types';
import type { AdminCatalog } from '../../src/admin/catalogTypes';
import {
  buildDistribution,
  type DistributionPayload,
} from '../../src/admin/catalogPublish';
import type { AdminCredentialParams } from '../../src/admin/passcodeCrypto';

const SELECT_PUBLISHED =
  'SELECT version, updated_at, payload_json, note FROM published_config WHERE id = 1';
const SELECT_ADMIN =
  'SELECT version, updated_at, catalog_json, note FROM admin_catalog WHERE id = 1';
const UPSERT_PUBLISHED =
  'INSERT INTO published_config (id, version, updated_at, payload_json, note) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at, payload_json = excluded.payload_json, note = excluded.note';
const UPSERT_ADMIN =
  'INSERT INTO admin_catalog (id, version, updated_at, catalog_json, note) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at, catalog_json = excluded.catalog_json, note = excluded.note';
const SELECT_AUTH =
  'SELECT salt, hash, iterations, passcode_version, updated_at FROM admin_auth WHERE id = 1';
const INSERT_AUTH =
  'INSERT INTO admin_auth (id, salt, hash, iterations, passcode_version, updated_at) VALUES (1, ?, ?, ?, 1, ?) ON CONFLICT(id) DO NOTHING';
const UPDATE_AUTH =
  'UPDATE admin_auth SET salt = ?, hash = ?, iterations = ?, passcode_version = passcode_version + 1, updated_at = ? WHERE id = 1';

export interface PublishedMeta {
  version: number;
  updatedAt: string;
}

export interface PublishedDoc extends PublishedMeta {
  payload: DistributionPayload;
}

export interface AdminDoc {
  version: number;
  updatedAt: string;
  catalog: AdminCatalog;
  note: string | null;
}

interface PublishedRow {
  version: number;
  updated_at: string;
  payload_json: string;
  note: string | null;
}
interface AdminRow {
  version: number;
  updated_at: string;
  catalog_json: string;
  note: string | null;
}

/** Meta only (cheap version probe for student devices). */
export async function readPublishedMeta(db: D1Database): Promise<PublishedMeta | null> {
  const row = (await db.prepare(SELECT_PUBLISHED).first()) as PublishedRow | null;
  if (!row) return null;
  return { version: row.version, updatedAt: row.updated_at };
}

/** The full published student document. */
export async function readPublished(db: D1Database): Promise<PublishedDoc | null> {
  const row = (await db.prepare(SELECT_PUBLISHED).first()) as PublishedRow | null;
  if (!row) return null;
  return {
    version: row.version,
    updatedAt: row.updated_at,
    payload: JSON.parse(row.payload_json) as DistributionPayload,
  };
}

/** The stored admin catalog (source of truth for admin devices). */
export async function readAdminCatalogDoc(db: D1Database): Promise<AdminDoc | null> {
  const row = (await db.prepare(SELECT_ADMIN).first()) as AdminRow | null;
  if (!row) return null;
  return {
    version: row.version,
    updatedAt: row.updated_at,
    catalog: JSON.parse(row.catalog_json) as AdminCatalog,
    note: row.note ?? null,
  };
}

export interface PublishResult {
  publishedVersion: number;
  adminVersion: number;
  updatedAt: string;
  distribution: DistributionPayload;
}

/**
 * Persist the admin catalog AND publish the derived student configuration in
 * ONE transaction. Versions increment from the currently stored values; the
 * derived distribution is computed here (server-side) so what students
 * receive is always exactly what this publish action produced.
 */
export async function publishAll(
  db: D1Database,
  catalog: AdminCatalog,
  note: string | null
): Promise<PublishResult> {
  const now = new Date().toISOString();
  const [pubRow, admRow] = (await Promise.all([
    db.prepare(SELECT_PUBLISHED).first(),
    db.prepare(SELECT_ADMIN).first(),
  ])) as [PublishedRow | null, AdminRow | null];

  const publishedVersion = (pubRow?.version ?? 0) + 1;
  const adminVersion = (admRow?.version ?? 0) + 1;
  const distribution = buildDistribution(catalog);

  await db.batch([
    db.prepare(UPSERT_PUBLISHED).bind(publishedVersion, now, JSON.stringify(distribution), note),
    db.prepare(UPSERT_ADMIN).bind(adminVersion, now, JSON.stringify(catalog), note),
  ]);

  return { publishedVersion, adminVersion, updatedAt: now, distribution };
}

// ── Admin passcode credential (the ONE admin identity) ────────────────────

interface AuthRow {
  salt: string;
  hash: string;
  iterations: number;
  passcode_version: number;
  updated_at: string;
}

/** The stored passcode credential, or null when not set yet (first run). */
export async function readAdminCredential(db: D1Database): Promise<AdminCredentialParams | null> {
  const row = (await db.prepare(SELECT_AUTH).first()) as AuthRow | null;
  if (!row) return null;
  return {
    salt: row.salt,
    hash: row.hash,
    iterations: row.iterations,
    version: row.passcode_version,
  };
}

/**
 * Create the credential (first run only). Returns true when THIS call
 * stored the credential. Race-safe: the insert is a no-op on conflict, then
 * the stored row is re-read and matched against the params we just wrote —
 * a concurrent setup that won the race has a different salt, so the loser
 * reports false.
 */
export async function createAdminCredential(
  db: D1Database,
  cred: AdminCredentialParams,
  updatedAt: string
): Promise<boolean> {
  await db
    .prepare(INSERT_AUTH)
    .bind(cred.salt, cred.hash, cred.iterations, updatedAt)
    .run();
  const row = (await db.prepare(SELECT_AUTH).first()) as AuthRow | null;
  return !!row && row.salt === cred.salt && row.hash === cred.hash;
}

/** Rotate the credential (passcode change); bumps the credential version. */
export async function rotateAdminCredential(
  db: D1Database,
  cred: AdminCredentialParams,
  updatedAt: string
): Promise<void> {
  await db
    .prepare(UPDATE_AUTH)
    .bind(cred.salt, cred.hash, cred.iterations, updatedAt)
    .run();
}

// ── AI assistant settings (single row; keys live ONLY here — never in the
//    published student config) and admin catalog drafts (multi-row) ─────────

const SELECT_AI = 'SELECT id, settings_json, updated_at FROM ai_settings WHERE id = 1';
const UPSERT_AI =
  'INSERT INTO ai_settings (id, settings_json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at';

const SELECT_DRAFTS = 'SELECT id, name, note, catalog_json, created_at FROM admin_drafts ORDER BY created_at DESC, id DESC LIMIT 50';
const SELECT_DRAFT = 'SELECT id, name, note, catalog_json, created_at FROM admin_drafts WHERE id = ?';
const INSERT_DRAFT =
  'INSERT INTO admin_drafts (id, name, note, catalog_json, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, note = excluded.note, catalog_json = excluded.catalog_json, created_at = excluded.created_at';
const DELETE_DRAFT = 'DELETE FROM admin_drafts WHERE id = ?';

/**
 * Create the AI/draft tables on first use. D1 supports runtime DDL; the
 * IF NOT EXISTS clauses make this a cheap no-op once created. Per-isolate
 * promise cache so the check runs at most once per isolate.
 */
const ensuredTables: Promise<void> | null = null;
export function ensureExtraTables(db: D1Database): Promise<void> {
  // (Module-level cache shared across isolates of the same deployment.)
  if (globalThis.__cgpaEnsureExtra) return globalThis.__cgpaEnsureExtra;
  const p = db
    .batch([
      // One statement per batch entry — D1's exec() is known to fail on
      // multi-line/multi-statement scripts (workers-sdk #9133), which would
      // have silently left these tables missing in production.
      db.prepare('CREATE TABLE IF NOT EXISTS ai_settings (id INTEGER PRIMARY KEY CHECK (id = 1), settings_json TEXT, updated_at TEXT)'),
      db.prepare('CREATE TABLE IF NOT EXISTS admin_drafts (id TEXT PRIMARY KEY, name TEXT, note TEXT, catalog_json TEXT, created_at TEXT)'),
      db.prepare(
        'CREATE TABLE IF NOT EXISTS ai_errors (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, kind TEXT NOT NULL, code TEXT, status INTEGER, provider TEXT, model TEXT, key_label TEXT, detail TEXT)'
      ),
    ])
    .then(() => undefined);
  globalThis.__cgpaEnsureExtra = p.catch(() => {
    // Never cache a failure — retry table creation on the next request.
    globalThis.__cgpaEnsureExtra = undefined;
  });
  return p;
}

declare global {
  // eslint-disable-next-line no-var
  var __cgpaEnsureExtra: Promise<void> | undefined;
}

export interface AiSettingsRow {
  settingsJson: string;
  updatedAt: string;
}

// ── Student-facing AI errors (technical log for the admin) ─────────────────
// Every error a student would have seen (provider failure, timeout, …) is
// recorded here so the admin can diagnose it. PRIVACY: only technical fields
// are stored — never the student's question, tool data, or raw IP address.
export interface AiErrorRow {
  id: number;
  ts: string;
  /** Which surface: 'chat' | 'stream' | 'status'. */
  kind: string;
  /** Stable code: 'provider-error' | 'timeout' | 'no-provider' | 'no-keys' | … */
  code: string | null;
  /** The upstream HTTP status (0 = none, e.g. network failure). */
  status: number | null;
  provider: string | null;
  model: string | null;
  keyLabel: string | null;
  /** The provider's raw error text (truncated) — technical detail only. */
  detail: string | null;
}

const SELECT_AI_ERRORS = 'SELECT id, ts, kind, code, status, provider, model, key_label, detail FROM ai_errors ORDER BY id DESC LIMIT ?';
const COUNT_AI_ERRORS = 'SELECT COUNT(*) AS n FROM ai_errors';
const INSERT_AI_ERROR =
  'INSERT INTO ai_errors (ts, kind, code, status, provider, model, key_label, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';

export async function recordAiError(
  db: D1Database,
  e: { kind: string; code?: string | null; status?: number | null; provider?: string | null; model?: string | null; keyLabel?: string | null; detail?: string | null }
): Promise<void> {
  await db
    .prepare(INSERT_AI_ERROR)
    .bind(
      new Date().toISOString(),
      e.kind,
      e.code ?? null,
      e.status ?? 0,
      e.provider ?? null,
      e.model ?? null,
      e.keyLabel ?? null,
      (e.detail ?? '').slice(0, 500) || null
    )
    .run();
}

export async function listAiErrors(db: D1Database, limit = 100): Promise<AiErrorRow[]> {
  const rows = (await db.prepare(SELECT_AI_ERRORS).bind(Math.max(1, Math.min(limit, 500))).all()).results as {
    id: number;
    ts: string;
    kind: string;
    code: string | null;
    status: number | null;
    provider: string | null;
    model: string | null;
    key_label: string | null;
    detail: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    kind: r.kind,
    code: r.code,
    status: r.status,
    provider: r.provider,
    model: r.model,
    keyLabel: r.key_label,
    detail: r.detail,
  }));
}

export async function countAiErrors(db: D1Database): Promise<number> {
  const row = (await db.prepare(COUNT_AI_ERRORS).first()) as { n: number } | null;
  return row?.n ?? 0;
}

export async function clearAiErrors(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM ai_errors').run();
}

export async function readAiSettingsJson(db: D1Database): Promise<AiSettingsRow | null> {
  const row = (await db.prepare(SELECT_AI).first()) as {
    id: number;
    settings_json: string;
    updated_at: string;
  } | null;
  if (!row) return null;
  return { settingsJson: row.settings_json, updatedAt: row.updated_at };
}

export async function writeAiSettingsJson(db: D1Database, json: string, updatedAt: string): Promise<void> {
  await db.prepare(UPSERT_AI).bind(json, updatedAt).run();
}

// ── Drafts ────────────────────────────────────────────────────────────────

export interface DraftMeta {
  id: string;
  name: string;
  note: string | null;
  createdAt: string;
}

export interface DraftDoc extends DraftMeta {
  catalog: AdminCatalog;
}

export async function listDrafts(db: D1Database): Promise<DraftMeta[]> {
  const rows = (await db.prepare(SELECT_DRAFTS).all()).results as {
    id: string;
    name: string;
    note: string | null;
    created_at: string;
  }[];
  return rows.map((r) => ({ id: r.id, name: r.name, note: r.note, createdAt: r.created_at }));
}

export async function readDraft(db: D1Database, id: string): Promise<DraftDoc | null> {
  const row = (await db.prepare(SELECT_DRAFT).bind(id).first()) as {
    id: string;
    name: string;
    note: string | null;
    catalog_json: string;
    created_at: string;
  } | null;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    note: row.note,
    createdAt: row.created_at,
    catalog: JSON.parse(row.catalog_json) as AdminCatalog,
  };
}

export async function writeDraft(
  db: D1Database,
  id: string,
  name: string,
  note: string | null,
  catalog: AdminCatalog,
  createdAt: string
): Promise<void> {
  await db.prepare(INSERT_DRAFT).bind(id, name, note, JSON.stringify(catalog), createdAt).run();
}

export async function deleteDraft(db: D1Database, id: string): Promise<void> {
  await db.prepare(DELETE_DRAFT).bind(id).run();
}
