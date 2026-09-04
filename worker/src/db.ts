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
