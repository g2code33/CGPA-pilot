// ─────────────────────────────────────────────────────────────────────────
// assets — R2 object storage for admin images (v1.0.20).
//
// Images are stored content-addressed: key = `catalog/<sha256-16>.<ext>`.
// The same image bytes always map to the same key, so re-uploading (or
// migrating the same file twice) is a free no-op — the bucket never grows
// with duplicates. The catalog keeps only `asset:<key>` references.
//
// Testable: everything takes the R2Bucket explicitly, so tests pass a fake.
// ─────────────────────────────────────────────────────────────────────────

import type { R2Bucket } from '@cloudflare/workers-types';
import type { AdminCatalog } from '../../src/admin/catalogTypes';

/** One uploaded image costs at most this much (mirrors the admin UI limit). */
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export interface StoredAsset {
  /** The catalog reference to store: `asset:<key>`. */
  ref: string;
  /** Bucket key. */
  key: string;
  /** Served URL (root-relative; the client resolves it against the API base). */
  url: string;
  bytes: number;
}

async function sha256Hex16(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Store image bytes in the bucket (content-addressed). Returns the catalog
 * reference. Throws on unknown image types or oversize payloads.
 */
export async function storeAsset(bucket: R2Bucket, bytes: Uint8Array, contentType: string): Promise<StoredAsset> {
  const ext = MIME_EXT[contentType.toLowerCase()];
  if (!ext) throw new Error(`unsupported image type: ${contentType || 'unknown'}`);
  if (bytes.byteLength > MAX_ASSET_BYTES) {
    throw new Error(`image is ${(bytes.byteLength / 1_000_000).toFixed(1)} MB — the limit is 2 MB`);
  }
  if (bytes.byteLength === 0) throw new Error('empty image');
  const key = `catalog/${await sha256Hex16(bytes)}.${ext}`;
  await bucket.put(key, bytes, {
    httpMetadata: { contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}` },
  });
  return { ref: `asset:${key}`, key, url: `/api/assets/${key}`, bytes: bytes.byteLength };
}

/** The catalog reference of a stored image (`asset:catalog/<sha16>.png`). */
export const ASSET_REF_PREFIX = 'asset:';

export function isAssetRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(ASSET_REF_PREFIX);
}

export interface ResolvedImage {
  mime: string;
  bytes: Uint8Array;
}

/**
 * Resolve a stored image value into bytes + mime. Published catalogs hold either
 * an `asset:<key>` R2 reference (v1.0.20+) or, for older publishes, the inline
 * `data:image/…` URL. Serving the PWA icon (and hashing it for cache-busting)
 * needs the BYTES, so both shapes are handled here — a value that cannot be
 * resolved (external URL, missing object, no bucket bound) returns null and the
 * caller falls back to the bundled default icon.
 *
 * Note the key is content-addressed (`catalog/<sha16>.<ext>`), so the bytes are
 * immutable: the caller can cache them forever.
 */
export async function readImageValue(
  value: string | null | undefined,
  bucket?: R2Bucket | null
): Promise<ResolvedImage | null> {
  if (!value) return null;
  if (value.startsWith('data:image/')) {
    const semi = value.indexOf(';');
    const comma = value.indexOf(',');
    if (semi === -1 || comma === -1 || comma < semi) return null;
    const mime = value.slice(5, semi);
    if (!/(png|jpeg|webp|gif)$/.test(mime)) return null;
    try {
      const bytes = base64ToBytes(value.slice(comma + 1));
      return bytes.length ? { mime, bytes } : null;
    } catch {
      return null; // malformed base64 — treat as "no logo set"
    }
  }
  if (!isAssetRef(value) || !bucket) return null;
  const key = value.slice(ASSET_REF_PREFIX.length);
  // Only catalog images we stored ourselves: never a traversal or an
  // attacker-chosen bucket key.
  if (!key.startsWith('catalog/') || key.includes('..') || key.includes('\\')) return null;
  try {
    const obj = await bucket.get(key);
    if (!obj) return null;
    const bytes = new Uint8Array(await obj.arrayBuffer());
    if (!bytes.length) return null;
    return { mime: obj.httpMetadata?.contentType || 'image/png', bytes };
  } catch {
    return null;
  }
}

/**
 * Rewrite every embedded data-URL image in a catalog to an R2 reference.
 * Covers the known fields (appearance + institution logos) AND a deep scan
 * of recycle-bin snapshots, so one call moves EVERYTHING. Returns a new
 * catalog object (the input is not mutated).
 */
export async function migrateCatalogAssets(
  bucket: R2Bucket,
  catalog: AdminCatalog
): Promise<{ catalog: AdminCatalog; moved: number; bytesMoved: number }> {
  let moved = 0;
  let bytesMoved = 0;
  const seen = new Map<string, string>(); // data URL → ref (dedup within one migration)

  async function putDataUrl(dataUrl: string): Promise<string> {
    const cached = seen.get(dataUrl);
    if (cached) return cached;
    const comma = dataUrl.indexOf(',');
    const meta = dataUrl.slice(5, comma); // "image/png;base64"
    const mime = meta.split(';')[0];
    const b64 = dataUrl.slice(comma + 1);
    const bytes = base64ToBytes(b64);
    const stored = await storeAsset(bucket, bytes, mime);
    seen.set(dataUrl, stored.ref);
    moved += 1;
    bytesMoved += stored.bytes;
    return stored.ref;
  }

  const c: AdminCatalog = structuredCloneSafe(catalog);
  const a = c.appearance;
  if (a) {
    if (isDataUrl(a.logo)) a.logo = await putDataUrl(a.logo);
    if (a.appIcon && isDataUrl(a.appIcon.image)) a.appIcon.image = await putDataUrl(a.appIcon.image);
    if (a.appImage && isDataUrl(a.appImage)) a.appImage = await putDataUrl(a.appImage);
    if (a.taglineImage && isDataUrl(a.taglineImage)) a.taglineImage = await putDataUrl(a.taglineImage);
    for (const icon of Object.values(a.icons ?? {})) {
      if (icon && isDataUrl(icon.image)) icon.image = await putDataUrl(icon.image);
    }
  }
  for (const u of c.universities) {
    if (isDataUrl(u.logo)) u.logo = await putDataUrl(u.logo);
    for (const s of u.schools ?? []) {
      if (isDataUrl(s.logo)) s.logo = await putDataUrl(s.logo);
    }
  }
  // Recycle-bin snapshots (deep scan — deleted items can carry big logos).
  if (c.trash) {
    for (const t of c.trash) {
      const refs: DataUrlRef[] = [];
      findDataUrls(t.data, refs);
      for (const r of refs) {
        r.holder[r.key] = await putDataUrl(String(r.holder[r.key]));
      }
    }
  }

  return { catalog: c, moved, bytesMoved };
}

function isDataUrl(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith('data:image');
}

/** A data:image string found inside a nested structure, with a live path back to it. */
interface DataUrlRef {
  /** The parent object/array holding the string (mutating holder[key] updates the catalog). */
  holder: Record<string, unknown>;
  /** The property name (or numeric index, as a string) on the holder. */
  key: string;
}

/**
 * Collect every data:image string in a nested value, with the holder + key
 * needed to REPLACE it in place (the old wrapper-object approach never
 * wrote anything back). Cycles are guarded.
 */
function findDataUrls(node: unknown, out: DataUrlRef[], seen: WeakSet<object> = new WeakSet()): void {
  if (!node || typeof node !== 'object') return;
  if (seen.has(node as object)) return;
  seen.add(node as object);
  const entries: [string, unknown][] = Array.isArray(node)
    ? node.map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(node as Record<string, unknown>);
  for (const [k, v] of entries) {
    if (typeof v === 'string' && v.startsWith('data:image')) out.push({ holder: node as Record<string, unknown>, key: k });
    else findDataUrls(v, out, seen);
  }
}

function base64ToBytes(b64: string): Uint8Array {
  // Workers runtime: atob is available; decode manually (handles no-padding).
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Deep clone without structuredClone (worker runtime compatibility). */
function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ── Usage metrics ─────────────────────────────────────────────────────────

export interface BucketUsage {
  payloadBytes: number;
  objectCount: number;
}

/** Total bytes + object count of one bucket (paginated list). */
export async function bucketUsage(bucket: R2Bucket): Promise<BucketUsage> {
  let payloadBytes = 0;
  let objectCount = 0;
  let cursor: string | undefined;
  for (;;) {
    const res = await bucket.list({ limit: 1000, cursor, prefix: 'catalog/' });
    for (const o of res.objects) {
      payloadBytes += o.size;
      objectCount += 1;
    }
    if (!res.truncated || !res.cursor) break;
    cursor = res.cursor;
  }
  return { payloadBytes, objectCount };
}

export interface CfBucketUsage {
  name: string;
  payloadBytes: number;
  objectCount: number;
}

export interface AccountR2Usage {
  buckets: CfBucketUsage[];
  totalBytes: number;
  totalObjects: number;
}

/**
 * R2 usage across the ENTIRE Cloudflare account (every bucket of every
 * project) via the Cloudflare API — this is what "will I exceed my Cloudflare
 * limit" actually means, since R2 free-tier storage is account-wide.
 * Needs a token with R2 read access + the account id (both admin-supplied).
 * `f` is injectable for tests.
 */
export async function getAccountR2Usage(
  token: string,
  accountId: string,
  f: typeof fetch = fetch
): Promise<AccountR2Usage> {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  // per_page=1000 (max): the default is 20, which would silently truncate
  // any account with more than 20 buckets.
  const list = await f(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets?per_page=1000`, { headers });
  const listDoc = (await list.json()) as {
    success?: boolean;
    result?: { name: string }[] | { buckets?: { name: string }[] | null } | null;
    errors?: { code?: number; message?: string }[];
  };
  if (!list.ok || !listDoc.success) {
    throw new Error(cfErrorDetail(listDoc) || `Cloudflare API ${list.status}`);
  }
  // The real API wraps the list: { result: { buckets: [...] } }. A bare-array
  // result is accepted too, but anything else is a loud, actionable error —
  // never an "object is not iterable" crash, never a silently empty list.
  const raw = listDoc.result;
  const names = Array.isArray(raw) ? raw : raw && Array.isArray(raw.buckets) ? raw.buckets : null;
  if (names === null) {
    throw new Error('Cloudflare answered, but the bucket list had an unexpected format. Try saving the credentials again.');
  }
  const buckets: CfBucketUsage[] = [];
  for (const b of names) {
    if (!b?.name) continue;
    try {
      const u = await f(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${encodeURIComponent(b.name)}/usage`, { headers });
      const uDoc = (await u.json()) as { success?: boolean; result?: { payloadSize?: string; objectCount?: string } };
      if (u.ok && uDoc.success && uDoc.result) {
        buckets.push({
          name: b.name,
          payloadBytes: Number(uDoc.result.payloadSize ?? 0) || 0,
          objectCount: Number(uDoc.result.objectCount ?? 0) || 0,
        });
      }
    } catch {
      // One bucket's usage is unavailable — keep the rest.
    }
  }
  buckets.sort((x, y) => y.payloadBytes - x.payloadBytes);
  return {
    buckets,
    totalBytes: buckets.reduce((s, b) => s + b.payloadBytes, 0),
    totalObjects: buckets.reduce((s, b) => s + b.objectCount, 0),
  };
}

function cfErrorDetail(doc: { errors?: { code?: number; message?: string }[] } | undefined): string | null {
  const e = doc?.errors?.[0];
  return e ? `${e.code ?? ''} ${e.message ?? ''}`.trim() : null;
}
