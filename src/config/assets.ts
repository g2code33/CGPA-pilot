// ─────────────────────────────────────────────────────────────────────────
// assets — where the admin's images live (v1.0.20: R2 asset storage).
//
// Images no longer have to be embedded in the catalog as base64 (which
// blew the ~2 MB database record). When the Worker's R2 bucket is
// configured, uploads are stored in the bucket and the catalog keeps only
// a tiny reference:  asset:<key>
//
// Legacy catalogs (and devices running before the Worker upgrade) keep
// plain data: URLs — the resolver below handles BOTH shapes everywhere an
// image string is turned into an <img src>:
//
//   data:image/…   → as-is (legacy / fallback mode)
//   asset:<key>    → the Worker's public asset endpoint (config API origin)
//   http(s)://…    → as-is (admin-pasted external URLs)
//   anything else  → as-is (relative paths etc.)
// ─────────────────────────────────────────────────────────────────────────

import { configApiUrl } from './apiBase';

/** Prefix for catalog references that point at a bucket-stored asset. */
export const ASSET_REF_PREFIX = 'asset:';

/** True when the value is an R2 asset reference (asset:<key>). */
export function isAssetRef(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith(ASSET_REF_PREFIX) && value.length > ASSET_REF_PREFIX.length;
}

/** The bucket key inside an asset reference (null for other values). */
export function assetKeyOf(value: string | null | undefined): string | null {
  if (!isAssetRef(value)) return null;
  return value.slice(ASSET_REF_PREFIX.length);
}

/** Build a catalog reference for a stored asset key. */
export function assetRef(key: string): string {
  return `${ASSET_REF_PREFIX}${key}`;
}

/**
 * Turn ANY stored image value (data URL, asset reference or external URL)
 * into a URL the browser can load right now. The single chokepoint every
 * renderer uses, so legacy and R2-backed catalogs render identically.
 */
export function resolveAssetUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const key = assetKeyOf(value);
  if (key) return configApiUrl(`/api/assets/${key}`);
  return value; // data URLs, https://, relative paths — as-is
}
