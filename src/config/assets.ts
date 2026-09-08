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

/** True when the app is running from a packaged offline runtime (desktop
 *  Electron `file://` or a native Capacitor app) where remote `http(s)` asset
 *  URLs cannot be relied upon and would appear as a broken logo offline. */
export function isOfflineRuntime(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const scheme = window.location?.protocol;
    // `cgpa:` is the desktop renderer scheme served by the Electron main process
    // (electron/rendererPath.ts). It behaves like file:// for us — no same-origin
    // API, offline first — so the packaging must be treated identically here or the
    // desktop would start trusting remote logo URLs it cannot always reach.
    if (scheme === 'file:' || scheme === 'cgpa:') return true;
    if (window.Capacitor?.isNativePlatform?.()) return true;
  } catch {
    /* non-browser / test contexts */
  }
  return false;
}

/** True for absolute remote URLs (not data URLs or relative asset paths). */
export function isRemoteHttpUrl(value: string | undefined): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

/** True when a URL can be loaded from the local app bundle (data / relative).
 *  In an offline desktop/native runtime root-relative `/api/...` and absolute
 *  `http(s)://...` URLs need the network and would appear as broken images. */
function isOfflineLocalUrl(value: string): boolean {
  if (value.startsWith('data:')) return true;
  if (value.startsWith('./') || value.startsWith('../')) return true;
  if (!value.startsWith('/') && !isRemoteHttpUrl(value)) return true;
  return false;
}

/**
 * Pick the first usable display URL for a logo, honouring the current runtime.
 * In an offline desktop/native app remote `http(s)` and root-relative asset
 * refs are skipped so the caller can fall back to the bundled icon
 * (`./icon-512.png`) instead of showing a broken image. Data URLs and relative
 * paths always win.
 */
export function safeLogoUrl(...candidates: (string | null | undefined)[]): string | undefined {
  const offline = isOfflineRuntime();
  for (const c of candidates) {
    const url = resolveAssetUrl(c);
    if (!url) continue;
    if (offline && !isOfflineLocalUrl(url)) continue;
    return url;
  }
  return undefined;
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
